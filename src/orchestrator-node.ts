import type { AgentCoreIA } from "./agent-core-ia.js";

export type OrchestratorNode = AgentCoreIA & { readonly isOrchestrator: true };

export function isOrchestrator(agent: AgentCoreIA): agent is OrchestratorNode {
  return (agent as { isOrchestrator?: unknown }).isOrchestrator === true;
}
