import { AgentCoreIA } from "../core/agent-core-ia.js";
import type { AgentTransport } from "../core/transport.js";

export type RemoteAgentOptions = {
  role: string;
  transport: AgentTransport;
};

// Representa na árvore de agents um agent que atende por fila; os patterns o tratam como qualquer subagent
export class RemoteAgent extends AgentCoreIA {
  private readonly transport: AgentTransport;

  constructor(options: RemoteAgentOptions) {
    super({
      role: options.role,
      goal: "Encaminhar pedidos ao agent que atende pela fila",
      backstory: `Representa o agent "${options.role}", que roda em outro processo`,
    });
    this.transport = options.transport;
  }

  override async execute<T>(): Promise<T> {
    if (this.humanRequest === undefined || this.role === undefined) {
      return super.execute<T>();
    }
    const pedido = { texto: this.humanRequest, ...(this.estrutura !== undefined ? { estrutura: this.estrutura } : {}) };
    return (await this.transport.request(this.role, pedido)) as T;
  }
}
