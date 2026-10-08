import { describe, expect, it, vi } from "vitest";
import { AgentCoreIA, IntelligentOrchestrator } from "../../src/index.js";

const SOLICITACAO = "Avalie o módulo de pagamentos";

function criarEspecialistas() {
  const seguranca = new AgentCoreIA({
    role: "Especialista de segurança",
    goal: "Avaliar riscos de segurança",
    backstory: "Você encontra vulnerabilidades.",
  });
  const desempenho = new AgentCoreIA({
    role: "Especialista de desempenho",
    goal: "Avaliar gargalos de desempenho",
    backstory: "Você mede e otimiza.",
  });
  const manutencao = new AgentCoreIA({
    role: "Especialista de manutenção",
    goal: "Avaliar a facilidade de manutenção",
    backstory: "Você valoriza código simples.",
  });

  // Infra mockada: cada especialista devolve um resultado diferente por rodada
  const resultados = {
    segurancaR1: { status: "approve", response: "segurança: risco R1" },
    desempenhoR1: { status: "approve", response: "desempenho: gargalo R1" },
    segurancaR2: { status: "approve", response: "segurança: risco R2" },
    desempenhoR2: { status: "approve", response: "desempenho: gargalo R2" },
  };
  const executeSeguranca = vi
    .spyOn(seguranca, "execute")
    .mockResolvedValueOnce(resultados.segurancaR1)
    .mockResolvedValueOnce(resultados.segurancaR2);
  const executeDesempenho = vi
    .spyOn(desempenho, "execute")
    .mockResolvedValueOnce(resultados.desempenhoR1)
    .mockResolvedValueOnce(resultados.desempenhoR2);
  const executeManutencao = vi.spyOn(manutencao, "execute");
  const setHumanRequestSeguranca = vi.spyOn(seguranca, "setHumanRequest");
  const setHumanRequestDesempenho = vi.spyOn(desempenho, "setHumanRequest");

  return {
    seguranca,
    desempenho,
    manutencao,
    resultados,
    executeSeguranca,
    executeDesempenho,
    executeManutencao,
    setHumanRequestSeguranca,
    setHumanRequestDesempenho,
  };
}

// Infra mockada: o LLM responde na ordem. Protocolo por rodada, três chamadas:
// 1) escolher os especialistas, 2) consolidar, 3) avaliar a certeza (0 a 1).
// Ao estourar o limite de rodadas, uma chamada extra gera as observações.
function criarLlm(respostas: string[]) {
  const complete = vi.fn<(prompt: string) => Promise<string>>();
  for (const resposta of respostas) {
    complete.mockResolvedValueOnce(resposta);
  }
  return { complete };
}

const ESCOLHA = "Especialista de segurança, Especialista de desempenho";

describe("Padrão: Orquestrador", () => {
  it("deve delegar, consolidar e validar, repetindo a rodada até atingir 95% de certeza", async () => {
    const especialistas = criarEspecialistas();
    const llm = criarLlm([
      ESCOLHA, "consolidado v1", "0.8", // rodada 1: abaixo de 95%
      ESCOLHA, "consolidado v2", "0.96", // rodada 2: atinge a certeza
    ]);

    const orquestrador = new IntelligentOrchestrator({
      systemPrompt: "Você orquestra especialistas até chegar a uma resposta confiável.",
      subAgents: [especialistas.seguranca, especialistas.desempenho, especialistas.manutencao],
      llm,
      maxRounds: 5,
    });
    orquestrador.setHumanRequest(SOLICITACAO);

    const resultado = await orquestrador.execute();

    // Só os especialistas escolhidos rodam, uma vez por rodada
    expect(especialistas.executeSeguranca).toHaveBeenCalledTimes(2);
    expect(especialistas.executeDesempenho).toHaveBeenCalledTimes(2);
    expect(especialistas.executeManutencao).not.toHaveBeenCalled();

    // Rodada 1 recebe a solicitação original; rodada 2 recebe também a consolidação anterior
    const pedidosDaSeguranca = especialistas.setHumanRequestSeguranca.mock.calls.map(([pedido]) => pedido);
    expect(pedidosDaSeguranca[0]).toBe(SOLICITACAO);
    expect(pedidosDaSeguranca[1]).toContain(SOLICITACAO);
    expect(pedidosDaSeguranca[1]).toContain("consolidado v1");

    // Três chamadas ao LLM por rodada, sem chamada extra de observações
    expect(llm.complete).toHaveBeenCalledTimes(6);
    expect(resultado).toMatchObject({
      status: "approve",
      response: "consolidado v2",
      confidence: 0.96,
      rounds: 2,
    });
  });

  it("deve entregar os resultados com observações ao atingir o limite de rodadas sem 95% de certeza", async () => {
    const especialistas = criarEspecialistas();
    const llm = criarLlm([
      ESCOLHA, "consolidado v1", "0.8", // rodada 1
      ESCOLHA, "consolidado v2", "0.9", // rodada 2: limite atingido, ainda abaixo de 95%
      "os especialistas divergem sobre o desempenho", // observações
    ]);

    const orquestrador = new IntelligentOrchestrator({
      systemPrompt: "Você orquestra especialistas até chegar a uma resposta confiável.",
      subAgents: [especialistas.seguranca, especialistas.desempenho, especialistas.manutencao],
      llm,
      maxRounds: 2,
    });
    orquestrador.setHumanRequest(SOLICITACAO);

    const resultado = await orquestrador.execute();

    // Parou na segunda rodada: nenhuma terceira rodada, só a chamada extra de observações
    expect(especialistas.executeSeguranca).toHaveBeenCalledTimes(2);
    expect(especialistas.executeDesempenho).toHaveBeenCalledTimes(2);
    expect(llm.complete).toHaveBeenCalledTimes(7);

    // Entrega a última consolidação com observações e os brutos de cada rodada, para auditoria
    expect(resultado).toEqual({
      status: "review",
      response: "consolidado v2",
      confidence: 0.9,
      rounds: 2,
      observations: "os especialistas divergem sobre o desempenho",
      resultados: [
        [especialistas.resultados.segurancaR1, especialistas.resultados.desempenhoR1],
        [especialistas.resultados.segurancaR2, especialistas.resultados.desempenhoR2],
      ],
    });
  });
});
