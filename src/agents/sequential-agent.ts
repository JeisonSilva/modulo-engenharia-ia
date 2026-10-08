import { AgentCoreIA, type AgentCoreIAOptions } from "../core/agent-core-ia.js";
import { extrairResponse } from "../core/response.js";

export type SequentialAgentOptions = AgentCoreIAOptions & {
  subAgents: AgentCoreIA[];
};

export class SequentialAgent extends AgentCoreIA {
  readonly subAgents: readonly AgentCoreIA[];

  constructor(options: SequentialAgentOptions) {
    super(options);
    this.subAgents = options.subAgents;
  }

  override async execute<T>(): Promise<T> {
    if (this.subAgents.length === 0) {
      return super.execute<T>();
    }

    let entrada = this.humanRequest;
    let resultado!: T;

    for (const agent of this.subAgents) {
      if (entrada !== undefined) {
        agent.setHumanRequest(entrada);
      }
      resultado = await agent.execute<T>();
      entrada = extrairResponse(resultado);
    }

    return resultado;
  }
}
