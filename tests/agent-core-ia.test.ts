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
});
