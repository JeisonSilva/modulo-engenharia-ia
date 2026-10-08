import { describe, expect, it, vi } from "vitest";
import { AgentCoreIA, SequentialAgent } from "../../src/index.js";

describe("Padrão: Sequencial", () => {
  it("deve repassar o resultado de cada agent para o próximo, na ordem A, B, C", async () => {
    const agentA = new AgentCoreIA({
      role: "Analista",
      goal: "Levantar os requisitos",
      backstory: "Você transforma pedidos em requisitos claros.",
    });
    const agentB = new AgentCoreIA({
      role: "Desenvolvedor",
      goal: "Implementar código",
      backstory: "Você escreve código limpo.",
    });
    const agentC = new AgentCoreIA({
      role: "Revisor",
      goal: "Revisar código",
      backstory: "Você encontra falhas de design.",
    });

    // Infra mockada: cada agent devolve um resultado fixo, sem LLM
    const executeA = vi
      .spyOn(agentA, "execute")
      .mockResolvedValue({ status: "approve", response: "resultado de A" });
    const executeB = vi
      .spyOn(agentB, "execute")
      .mockResolvedValue({ status: "approve", response: "resultado de B" });
    const resultadoDeC = { status: "approve", response: "resultado de C" };
    const executeC = vi.spyOn(agentC, "execute").mockResolvedValue(resultadoDeC);

    const setHumanRequestA = vi.spyOn(agentA, "setHumanRequest");
    const setHumanRequestB = vi.spyOn(agentB, "setHumanRequest");
    const setHumanRequestC = vi.spyOn(agentC, "setHumanRequest");

    const sequencia = new SequentialAgent({
      systemPrompt: "Você executa os agents em sequência.",
      subAgents: [agentA, agentB, agentC],
    });
    sequencia.setHumanRequest("Crie uma API de cadastro de clientes");

    const resultado = await sequencia.execute();

    expect(setHumanRequestA).toHaveBeenCalledWith("Crie uma API de cadastro de clientes");
    expect(setHumanRequestB).toHaveBeenCalledWith("resultado de A");
    expect(setHumanRequestC).toHaveBeenCalledWith("resultado de B");

    const [ordemA] = executeA.mock.invocationCallOrder;
    const [ordemB] = executeB.mock.invocationCallOrder;
    const [ordemC] = executeC.mock.invocationCallOrder;
    expect(ordemA).toBeLessThan(ordemB!);
    expect(ordemB).toBeLessThan(ordemC!);

    expect(resultado).toEqual(resultadoDeC);
  });
});
