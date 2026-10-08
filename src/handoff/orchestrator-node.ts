import type { AgentCoreIA } from "../core/agent-core-ia.js";
import type { HandoffResultado } from "./handoff.js";

export type OrchestratorNode = AgentCoreIA & {
  readonly isOrchestrator: true;
  // Tenta atender um handoff dentro da subárvore deste orquestrador; undefined se o destino não está nela
  receberHandoff(
    para: string,
    pedido: string,
    caminho: string[],
  ): Promise<HandoffResultado | undefined>;
};

export function isOrchestrator(agent: AgentCoreIA): agent is OrchestratorNode {
  return (agent as { isOrchestrator?: unknown }).isOrchestrator === true;
}
