import { iniciarAgentPeloAmbiente } from "agent-base";
import { AgentDeExemplo } from "./agent-de-exemplo.mjs";

await iniciarAgentPeloAmbiente(
  new AgentDeExemplo({
    role: "revisor",
    goal: "Definir a conduta a partir do diagnóstico",
    backstory: "Médico revisor",
    response: "Conduta: repouso, hidratação e retorno em 5 dias se a febre persistir.",
    dados: { conduta: "repouso e hidratação" },
  }),
);
