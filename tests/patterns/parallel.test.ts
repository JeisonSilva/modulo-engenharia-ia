import { describe, expect, it, vi } from "vitest";
import { AgentCoreIA, ParallelAgent } from "../../src/index.js";

type AgentResponse = {
  status: string;
  response: string;
};

function adiar<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

const aguardarMicrotarefas = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Padrão: Paralelo", () => {
  it("deve executar A, B e C ao mesmo tempo e entregar o consolidado com o resultado de cada um", async () => {
    const agentA = new AgentCoreIA({
      role: "Analista de segurança",
      goal: "Avaliar riscos de segurança",
      backstory: "Você encontra vulnerabilidades.",
    });
    const agentB = new AgentCoreIA({
      role: "Analista de desempenho",
      goal: "Avaliar gargalos de desempenho",
      backstory: "Você mede e otimiza.",
    });
    const agentC = new AgentCoreIA({
      role: "Analista de manutenção",
      goal: "Avaliar a facilidade de manutenção",
      backstory: "Você valoriza código simples.",
    });

    // Infra mockada: cada execute fica pendente até o teste liberar,
    // o que permite provar que os três começaram antes de qualquer um terminar
    const execucaoA = adiar<AgentResponse>();
    const execucaoB = adiar<AgentResponse>();
    const execucaoC = adiar<AgentResponse>();
    const executeA = vi.spyOn(agentA, "execute").mockReturnValue(execucaoA.promessa);
    const executeB = vi.spyOn(agentB, "execute").mockReturnValue(execucaoB.promessa);
    const executeC = vi.spyOn(agentC, "execute").mockReturnValue(execucaoC.promessa);
    const setHumanRequestA = vi.spyOn(agentA, "setHumanRequest");
    const setHumanRequestB = vi.spyOn(agentB, "setHumanRequest");
    const setHumanRequestC = vi.spyOn(agentC, "setHumanRequest");

    const resultadoDeA = { status: "approve", response: "resultado de A" };
    const resultadoDeB = { status: "approve", response: "resultado de B" };
    const resultadoDeC = { status: "approve", response: "resultado de C" };
    const resultadoConsolidado = { status: "approve", response: "resultado consolidado" };
    const consolidar = vi.fn((_resultados: AgentResponse[]) => resultadoConsolidado);

    const paralelo = new ParallelAgent({
      systemPrompt: "Você executa os agents ao mesmo tempo.",
      subAgents: [agentA, agentB, agentC],
      consolidator: consolidar,
    });
    paralelo.setHumanRequest("Avalie o módulo de pagamentos");

    const execucao = paralelo.execute();

    // Os três começam antes de qualquer um terminar
    await vi.waitFor(() => {
      expect(executeA).toHaveBeenCalledTimes(1);
      expect(executeB).toHaveBeenCalledTimes(1);
      expect(executeC).toHaveBeenCalledTimes(1);
    });
    expect(setHumanRequestA).toHaveBeenCalledWith("Avalie o módulo de pagamentos");
    expect(setHumanRequestB).toHaveBeenCalledWith("Avalie o módulo de pagamentos");
    expect(setHumanRequestC).toHaveBeenCalledWith("Avalie o módulo de pagamentos");
    expect(consolidar).not.toHaveBeenCalled();

    // Terminam fora de ordem; o consolidador espera pelos três
    execucaoB.resolver(resultadoDeB);
    execucaoC.resolver(resultadoDeC);
    await aguardarMicrotarefas();
    expect(consolidar).not.toHaveBeenCalled();

    execucaoA.resolver(resultadoDeA);
    const resultado = await execucao;

    // O consolidador recebe os resultados na ordem dos agents
    expect(consolidar).toHaveBeenCalledTimes(1);
    expect(consolidar).toHaveBeenCalledWith([resultadoDeA, resultadoDeB, resultadoDeC]);
    expect(resultado).toEqual({
      consolidado: resultadoConsolidado,
      resultados: [resultadoDeA, resultadoDeB, resultadoDeC],
    });
  });
});
