import { iniciarAgentPeloAmbiente } from "agent-base";
import { AgentDeExemplo } from "./agent-de-exemplo.mjs";

await iniciarAgentPeloAmbiente(
  new AgentDeExemplo({
    role: "medico",
    goal: "Formular a hipótese diagnóstica a partir da triagem",
    backstory: "Clínico geral",
    response: "Quadro compatível com gripe (CID J11).",
    dados: { diagnostico: { hipotese: "gripe", cid: "J11" } },
  }),
);
