import { AgentCoreIA, type AgentCoreIAOptions } from "./agent-core-ia.js";

export type OrchestratorAgentOptions = AgentCoreIAOptions & {
  subAgents: AgentCoreIA[];
};

export class OrchestratorAgent extends AgentCoreIA {
  readonly subAgents: readonly AgentCoreIA[];

  constructor(options: OrchestratorAgentOptions) {
    super(options);
    this.subAgents = options.subAgents;
  }
}
