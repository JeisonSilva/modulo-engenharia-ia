import { describe, expect, it } from "vitest";
import { AgentCoreIA } from "../../src/index.js";

type AgentResponse = {
  status: string;
  response: string;
};

describe("Padrão: Single Agent", () => {
  it("deve ter um agent sozinho, com ferramentas, que executa e retorna um objeto estruturado", async () => {
    // Infra mockada: ferramentas fake, sem acesso a arquivo nem a processo
    const lerArquivo = {
      name: "lerArquivo",
      description: "Lê o conteúdo de um arquivo",
      run: async (_input: string) => "conteúdo do arquivo",
    };
    const rodarTestes = {
      name: "rodarTestes",
      description: "Executa a suite de testes",
      run: async (_input: string) => "todos os testes passaram",
    };

    const agent = new AgentCoreIA({
      role: "Desenvolvedor",
      goal: "Implementar código",
      backstory: "Você escreve código limpo.",
      tools: [lerArquivo, rodarTestes],
    });

    const resultado = await agent.execute<AgentResponse>();

    expect(agent.tools).toEqual([lerArquivo, rodarTestes]);
    expect(resultado).toEqual({
      status: expect.any(String),
      response: expect.any(String),
    });
  });
});
