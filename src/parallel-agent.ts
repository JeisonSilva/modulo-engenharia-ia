import { AgentCoreIA, type AgentCoreIAOptions } from "./agent-core-ia.js";
import { extrairResponse, type AgentResponse } from "./response.js";

export type ParallelAgentOptions = AgentCoreIAOptions & {
  subAgents: AgentCoreIA[];
  consolidator: AgentCoreIA;
};

export type ParallelResult = {
  consolidado: unknown;
  resultados: AgentResponse[];
};

export class ParallelAgent extends AgentCoreIA {
  readonly subAgents: readonly AgentCoreIA[];
  private readonly consolidator: AgentCoreIA;

  constructor(options: ParallelAgentOptions) {
    super(options);
    this.subAgents = options.subAgents;
    this.consolidator = options.consolidator;
  }

  override async execute<T>(): Promise<T> {
    if (this.subAgents.length === 0) {
      return super.execute<T>();
    }

    const resultados = await Promise.all(
      this.subAgents.map((agent) => {
        if (this.humanRequest !== undefined) {
          agent.setHumanRequest(this.humanRequest);
        }
        return agent.execute<AgentResponse>();
      }),
    );

    const pedido = resultados
      .map(extrairResponse)
      .filter((response) => response !== undefined)
      .join("\n");
    this.consolidator.setHumanRequest(pedido);
    const consolidado = await this.consolidator.execute<unknown>();

    return { consolidado, resultados } satisfies ParallelResult as T;
  }
}
