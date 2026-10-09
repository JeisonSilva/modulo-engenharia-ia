import amqp, { type Channel, type ChannelModel, type ConsumeMessage } from "amqplib";
import type { MessageBroker, MessageHandler } from "./broker.js";
import { validarMensagem, type PipelineMessage } from "./message.js";

export type RabbitMqBrokerOptions = {
  exchange?: string;
};

const EXCHANGE_PADRAO = "agents";

// Exchange direct; cada fila é ligada a ela com a routing key igual ao próprio nome
export class RabbitMqBroker implements MessageBroker {
  private canalDePublicacao: Promise<Channel> | undefined;
  private readonly filasDeclaradas = new Map<string, Promise<void>>();

  private constructor(
    private readonly conexao: ChannelModel,
    private readonly exchange: string,
  ) {}

  static async connect(url: string, options: RabbitMqBrokerOptions = {}): Promise<RabbitMqBroker> {
    return new RabbitMqBroker(await amqp.connect(url), options.exchange ?? EXCHANGE_PADRAO);
  }

  async publish(routingKey: string, mensagem: PipelineMessage): Promise<void> {
    this.canalDePublicacao ??= this.conexao.createChannel();
    const canal = await this.canalDePublicacao;
    // Declara a fila de destino para a mensagem não se perder se o consumidor ainda não subiu
    await this.declarar(canal, routingKey);
    canal.publish(this.exchange, routingKey, Buffer.from(JSON.stringify(mensagem)), {
      persistent: true,
      correlationId: mensagem.id,
      type: mensagem.tipo,
    });
  }

  async consume(fila: string, handler: MessageHandler): Promise<() => Promise<void>> {
    const canal = await this.conexao.createChannel();
    await this.declarar(canal, fila);
    // Uma mensagem por vez: a próxima só chega depois do ack da atual
    await canal.prefetch(1);
    const { consumerTag } = await canal.consume(fila, (mensagem) => {
      if (mensagem !== null) {
        void this.entregar(canal, mensagem, handler);
      }
    });
    return async () => {
      await canal.cancel(consumerTag);
    };
  }

  async close(): Promise<void> {
    await this.conexao.close();
  }

  private declarar(canal: Channel, fila: string): Promise<void> {
    let declarada = this.filasDeclaradas.get(fila);
    if (declarada === undefined) {
      declarada = (async () => {
        await canal.assertExchange(this.exchange, "direct", { durable: true });
        await canal.assertQueue(fila, { durable: true });
        await canal.bindQueue(fila, this.exchange, fila);
      })();
      this.filasDeclaradas.set(fila, declarada);
    }
    return declarada;
  }

  private async entregar(canal: Channel, mensagem: ConsumeMessage, handler: MessageHandler): Promise<void> {
    try {
      await handler(validarMensagem(JSON.parse(mensagem.content.toString())));
      canal.ack(mensagem);
    } catch (erro) {
      // Falha de infraestrutura (o erro do agent é tratado antes): tenta mais uma vez e depois descarta
      console.error("Falha ao processar a mensagem:", erro);
      canal.nack(mensagem, false, !mensagem.fields.redelivered);
    }
  }
}
