import type { MessageBroker, MessageHandler } from "./broker.js";
import type { PipelineMessage } from "./message.js";

type Fila = {
  mensagens: PipelineMessage[];
  handler?: MessageHandler;
  ocupada: boolean;
};

// Mesma semântica do RabbitMqBroker (fila ligada pela key igual ao seu nome, uma mensagem por vez), sem broker
export class InMemoryBroker implements MessageBroker {
  private readonly filas = new Map<string, Fila>();
  private readonly emAndamento = new Set<Promise<void>>();

  async publish(routingKey: string, mensagem: PipelineMessage): Promise<void> {
    const fila = this.fila(routingKey);
    fila.mensagens.push(structuredClone(mensagem));
    this.drenar(fila);
  }

  async consume(nome: string, handler: MessageHandler): Promise<() => Promise<void>> {
    const fila = this.fila(nome);
    if (fila.handler !== undefined) {
      throw new Error(`A fila "${nome}" já tem um consumidor`);
    }
    fila.handler = handler;
    this.drenar(fila);
    return async () => {
      delete fila.handler;
    };
  }

  // Espera todas as mensagens em trânsito serem processadas (útil em testes)
  async ocioso(): Promise<void> {
    while (this.emAndamento.size > 0) {
      await Promise.all(this.emAndamento);
    }
  }

  pendentes(nome: string): number {
    return this.filas.get(nome)?.mensagens.length ?? 0;
  }

  async close(): Promise<void> {
    this.filas.clear();
  }

  private fila(nome: string): Fila {
    let fila = this.filas.get(nome);
    if (fila === undefined) {
      fila = { mensagens: [], ocupada: false };
      this.filas.set(nome, fila);
    }
    return fila;
  }

  private drenar(fila: Fila): void {
    if (fila.ocupada || fila.handler === undefined || fila.mensagens.length === 0) {
      return;
    }
    fila.ocupada = true;
    const trabalho = (async () => {
      try {
        let mensagem: PipelineMessage | undefined;
        while (fila.handler !== undefined && (mensagem = fila.mensagens.shift()) !== undefined) {
          try {
            await fila.handler(mensagem);
          } catch (erro) {
            console.error("Mensagem descartada:", erro);
          }
        }
      } finally {
        fila.ocupada = false;
      }
    })();
    this.emAndamento.add(trabalho);
    void trabalho.finally(() => this.emAndamento.delete(trabalho));
  }
}
