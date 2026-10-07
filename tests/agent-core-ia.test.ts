import { describe, expect, it } from "vitest";
import { AgentCoreIA } from "../src/index.js";

type AgentResponse = {
  status: string;
  response: string;
};

describe("AgentCoreIA", () => {
  it("deve responder que está pronto ao ser iniciado com um system prompt", async () => {
    const systemPrompt =
      "Você é um agente especialista em engenharia de software. " +
      "Responda sempre de forma objetiva.";

    const agent = new AgentCoreIA({ systemPrompt });

    const result = await agent.execute<AgentResponse>();

    expect(result.status).toBe("approve");
    expect(result.response).toBe("estou pronto para receber sua solicitação");
  });

  it("deve definir a solicitação do humano", () => {
    const agent = new AgentCoreIA({ systemPrompt: "Você é um agente especialista." });

    agent.setHumanRequest("Crie uma API de cadastro de clientes");

    expect(agent.humanRequest).toBe("Crie uma API de cadastro de clientes");
  });

  it("deve montar o system prompt a partir de role, goal e backstory", () => {
    const agent = new AgentCoreIA({
      role: "Engenheiro de software sênior",
      goal: "Projetar soluções simples e testáveis",
      backstory: "Você tem 15 anos de experiência em arquitetura de sistemas.",
    });

    expect(agent.systemPrompt).toContain("Engenheiro de software sênior");
    expect(agent.systemPrompt).toContain("Projetar soluções simples e testáveis");
    expect(agent.systemPrompt).toContain(
      "Você tem 15 anos de experiência em arquitetura de sistemas.",
    );
  });

  it("deve receber a configuração completa no construtor", () => {
    const agent = new AgentCoreIA({
      role: "Engenheiro de software sênior",
      goal: "Projetar soluções simples e testáveis",
      backstory: "Você tem 15 anos de experiência em arquitetura de sistemas.",
      tasks: [
        {
          description: "Criar uma API de cadastro de clientes",
          expectedOutput: "Endpoints REST documentados e com testes",
        },
      ],
    });

    expect(agent.systemPrompt).toContain("Engenheiro de software sênior");
    expect(agent.systemPrompt).toContain("Projetar soluções simples e testáveis");
    expect(agent.systemPrompt).toContain(
      "Você tem 15 anos de experiência em arquitetura de sistemas.",
    );
    expect(agent.tasks).toEqual([
      {
        description: "Criar uma API de cadastro de clientes",
        expectedOutput: "Endpoints REST documentados e com testes",
      },
    ]);
  });

  it("deve receber os guardrails no construtor", () => {
    const semResposta = (output: string) =>
      output.trim().length > 0
        ? { valid: true }
        : { valid: false, message: "A resposta não pode ser vazia" };

    const agent = new AgentCoreIA({
      systemPrompt: "Você é um agente especialista.",
      guardrails: [semResposta],
    });

    expect(agent.guardrails).toEqual([semResposta]);
  });
});
