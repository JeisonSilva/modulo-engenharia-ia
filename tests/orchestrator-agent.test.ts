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

  it("deve receber a configuração completa do agent junto com os subagents", () => {
    const semResposta = (output: string) =>
      output.trim().length > 0
        ? { valid: true }
        : { valid: false, message: "A resposta não pode ser vazia" };

    const desenvolvedor = new AgentCoreIA({
      role: "Desenvolvedor",
      goal: "Implementar código",
      backstory: "Você escreve código limpo.",
    });

    const orquestrador = new OrchestratorAgent({
      role: "Líder técnico",
      goal: "Coordenar a equipe para entregar com qualidade",
      backstory: "Você lidera times de engenharia há 10 anos.",
      tasks: [
        {
          description: "Entregar uma API de cadastro de clientes",
          expectedOutput: "Endpoints REST documentados e com testes",
        },
      ],
      guardrails: [semResposta],
      subAgents: [desenvolvedor],
    });

    expect(orquestrador.systemPrompt).toContain("Líder técnico");
    expect(orquestrador.systemPrompt).toContain(
      "Coordenar a equipe para entregar com qualidade",
    );
    expect(orquestrador.systemPrompt).toContain(
      "Você lidera times de engenharia há 10 anos.",
    );
    expect(orquestrador.tasks).toEqual([
      {
        description: "Entregar uma API de cadastro de clientes",
        expectedOutput: "Endpoints REST documentados e com testes",
      },
    ]);
    expect(orquestrador.guardrails).toEqual([semResposta]);
    expect(orquestrador.subAgents).toEqual([desenvolvedor]);
  });
});
