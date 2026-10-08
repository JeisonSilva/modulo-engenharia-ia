import { describe, expect, it } from "vitest";
import { AgentCoreIA, OrchestratorAgent } from "../src/index.js";

describe("OrchestratorAgent", () => {
  it("deve receber os subagents no construtor", () => {
    const desenvolvedor = new AgentCoreIA({
      role: "Desenvolvedor",
      goal: "Implementar código",
      backstory: "Você escreve código limpo.",
    });
    const revisor = new AgentCoreIA({
      role: "Revisor",
      goal: "Revisar código",
      backstory: "Você encontra falhas de design.",
    });

    const orquestrador = new OrchestratorAgent({
      systemPrompt: "Você coordena a equipe e delega as tarefas.",
      subAgents: [desenvolvedor, revisor],
    });

    expect(orquestrador).toBeInstanceOf(AgentCoreIA);
    expect(orquestrador.subAgents).toEqual([desenvolvedor, revisor]);
  });
});
