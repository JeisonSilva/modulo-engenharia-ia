import { iniciarAgentPeloAmbiente } from "agent-base";
import { AgentDeExemplo } from "./agent-de-exemplo.mjs";

await iniciarAgentPeloAmbiente(
  new AgentDeExemplo({
    role: "triagem",
    goal: "Levantar os sintomas relatados na consulta",
    backstory: "Enfermeiro de triagem com experiência em pronto atendimento",
    response: "Paciente relata febre e tosse há 3 dias.",
    dados: { sintomas: ["febre", "tosse"] },
  }),
);
