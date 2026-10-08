import { randomUUID } from "node:crypto";
import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import type { AgentRequest } from "../core/estrutura.js";
import type { AgentResponse } from "../core/response.js";
import type { AgentTransport, RequestHandler } from "../core/transport.js";

export type RabbitMqTransportOptions = {
  exchange?: string;
  requestTimeoutMs?: number;
};

type Aguardando = {
  resolve: (resposta: AgentResponse) => void;
  reject: (erro: Error) => void;
  timer: NodeJS.Timeout;
};

type Corpo = { resposta: AgentResponse } | { erro: string };

const EXCHANGE_PADRAO = "agents";
const TIMEOUT_PADRAO_MS = 60_000;

// Uma exchange direct; cada role tem uma fila ligada a ela pela routing key = role
export class RabbitMqTransport implements AgentTransport {
  private readonly aguardando = new Map<string, Aguardando>();
  private respostas: Promise<{ canal: Channel; fila: string }> | undefined;
  private readonly canaisDeConsumo: Channel[] = [];

  private constructor(
    private readonly conexao: ChannelModel,
    private readonly exchange: string,
    private readonly requestTimeoutMs: number,
  ) {}

  static async connect(url: string, options: RabbitMqTransportOptions = {}): Promise<RabbitMqTransport> {
    const conexao = await amqp.connect(url);
    return new RabbitMqTransport(
      conexao,
      options.exchange ?? EXCHANGE_PADRAO,
      options.requestTimeoutMs ?? TIMEOUT_PADRAO_MS,
    );
  }

  async request(role: string, pedido: AgentRequest): Promise<AgentResponse> {
    const { canal, fila } = await this.prepararRespostas();
    const correlationId = randomUUID();

    return new Promise<AgentResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.aguardando.delete(correlationId);
        reject(new Error(`Sem resposta do agent "${role}" em ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.aguardando.set(correlationId, { resolve, reject, timer });

      canal.publish(this.exchange, role, Buffer.from(JSON.stringify(pedido)), {
        correlationId,
        replyTo: fila,
        persistent: true,
      });
    });
  }

  async serve(role: string, handler: RequestHandler): Promise<() => Promise<void>> {
    const canal = await this.conexao.createChannel();
    this.canaisDeConsumo.push(canal);
    await canal.assertExchange(this.exchange, "direct", { durable: true });
    await canal.assertQueue(role, { durable: true });
    await canal.bindQueue(role, this.exchange, role);
    // Uma mensagem por vez: a próxima só chega depois do ack da atual
    await canal.prefetch(1);

    const { consumerTag } = await canal.consume(role, (mensagem) => {
      if (mensagem !== null) {
        void this.atender(canal, mensagem, handler);
      }
    });

    return async () => {
      await canal.cancel(consumerTag);
    };
  }

  async close(): Promise<void> {
    for (const { reject, timer } of this.aguardando.values()) {
      clearTimeout(timer);
      reject(new Error("Transporte fechado"));
    }
    this.aguardando.clear();
    await this.conexao.close();
  }

  private async atender(canal: Channel, mensagem: ConsumeMessage, handler: RequestHandler): Promise<void> {
    let corpo: Corpo;
    try {
      corpo = { resposta: await handler(JSON.parse(mensagem.content.toString()) as AgentRequest) };
    } catch (erro) {
      corpo = { erro: erro instanceof Error ? erro.message : String(erro) };
    }

    const { replyTo, correlationId } = mensagem.properties;
    if (typeof replyTo === "string") {
      canal.sendToQueue(replyTo, Buffer.from(JSON.stringify(corpo)), { correlationId });
    }
    canal.ack(mensagem);
  }

  // Guarda a promise, não o resultado, para pedidos concorrentes não criarem duas filas de resposta
  private prepararRespostas(): Promise<{ canal: Channel; fila: string }> {
    this.respostas ??= this.criarRespostas();
    return this.respostas;
  }

  private async criarRespostas(): Promise<{ canal: Channel; fila: string }> {
    const canal = await this.conexao.createChannel();
    await canal.assertExchange(this.exchange, "direct", { durable: true });
    // Fila exclusiva deste produtor: some quando a conexão fecha
    const { queue } = await canal.assertQueue("", { exclusive: true });
    await canal.consume(
      queue,
      (mensagem) => {
        const correlationId = mensagem?.properties.correlationId;
        const espera = typeof correlationId === "string" ? this.aguardando.get(correlationId) : undefined;
        if (mensagem === null || espera === undefined) {
          return;
        }
        this.aguardando.delete(correlationId as string);
        clearTimeout(espera.timer);
        const corpo = JSON.parse(mensagem.content.toString()) as Corpo;
        if ("erro" in corpo) {
          espera.reject(new Error(corpo.erro));
        } else {
          espera.resolve(corpo.resposta);
        }
      },
      { noAck: true },
    );
    return { canal, fila: queue };
  }
}
