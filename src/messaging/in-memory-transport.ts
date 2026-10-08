import type { AgentRequest } from "../core/estrutura.js";
import type { AgentResponse } from "../core/response.js";
import type { AgentTransport, RequestHandler } from "../core/transport.js";

type Pendente = {
  pedido: AgentRequest;
  resolve: (resposta: AgentResponse) => void;
  reject: (erro: unknown) => void;
};

type Fila = {
  mensagens: Pendente[];
  handler?: RequestHandler;
  ocupada: boolean;
};

// Mesma semântica da fila do RabbitMQ (uma fila por role, um consumidor, uma mensagem por vez), sem broker
export class InMemoryTransport implements AgentTransport {
  private readonly filas = new Map<string, Fila>();

  request(role: string, pedido: AgentRequest): Promise<AgentResponse> {
    return new Promise((resolve, reject) => {
      const fila = this.fila(role);
      fila.mensagens.push({ pedido, resolve, reject });
      void this.drenar(fila);
    });
  }

  async serve(role: string, handler: RequestHandler): Promise<() => Promise<void>> {
    const fila = this.fila(role);
    if (fila.handler !== undefined) {
      throw new Error(`A fila "${role}" já tem um consumidor`);
    }
    fila.handler = handler;
    void this.drenar(fila);
    return async () => {
      delete fila.handler;
    };
  }

  async close(): Promise<void> {
    this.filas.clear();
  }

  private fila(role: string): Fila {
    let fila = this.filas.get(role);
    if (fila === undefined) {
      fila = { mensagens: [], ocupada: false };
      this.filas.set(role, fila);
    }
    return fila;
  }

  private async drenar(fila: Fila): Promise<void> {
    if (fila.ocupada) {
      return;
    }
    fila.ocupada = true;
    try {
      let mensagem: Pendente | undefined;
      while (fila.handler !== undefined && (mensagem = fila.mensagens.shift()) !== undefined) {
        try {
          mensagem.resolve(await fila.handler(mensagem.pedido));
        } catch (erro) {
          mensagem.reject(erro);
        }
      }
    } finally {
      fila.ocupada = false;
    }
  }
}
