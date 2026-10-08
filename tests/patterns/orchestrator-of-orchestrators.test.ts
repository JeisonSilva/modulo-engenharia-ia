import { describe, expect, it, vi } from "vitest";
import { AgentCoreIA, IntelligentOrchestrator, OrchestratorRouter } from "../../src/index.js";

const SOLICITACAO = "Crie o endpoint de cadastro de clientes";

function criarEspecialista(role: string) {
  return new AgentCoreIA({
    role,
    goal: `Executar o trabalho de ${role}`,
    backstory: `Você é ${role}.`,
  });
}

// Infra mockada: o LLM de cada orquestrador responde na ordem das chamadas
function criarLlm(respostas: string[]) {
  const complete = vi.fn<(prompt: string) => Promise<string>>();
  for (const resposta of respostas) {
    complete.mockResolvedValueOnce(resposta);
  }
  return { complete };
}

describe("Padrão: Orquestrador de orquestradores", () => {
  it("deve rotear pela árvore até o orquestrador com especialistas e subir o resultado intacto", async () => {
    // Folhas: orquestradores cuja equipe é só de especialistas
    const rest = criarEspecialista("Especialista REST");
    const banco = criarEspecialista("Especialista de banco de dados");
    const testes = criarEspecialista("Especialista de testes");
    const seguranca = criarEspecialista("Especialista de segurança");

    const resultadoRest = { status: "approve", response: "REST: endpoint criado" };
    const resultadoBanco = { status: "approve", response: "Banco: tabela criada" };
    const executeRest = vi.spyOn(rest, "execute").mockResolvedValue(resultadoRest);
    const executeBanco = vi.spyOn(banco, "execute").mockResolvedValue(resultadoBanco);
    const executeTestes = vi.spyOn(testes, "execute");
    const executeSeguranca = vi.spyOn(seguranca, "execute");

    // Protocolo da folha: escolher especialistas, consolidar, avaliar a certeza (0 a 1)
    const llmApi = criarLlm([
      "Especialista REST, Especialista de banco de dados",
      "consolidado da API",
      "0.97",
    ]);
    const api = new IntelligentOrchestrator({
      role: "Orquestrador de API",
      goal: "Entregar APIs completas",
      backstory: "Você coordena especialistas de API.",
      subAgents: [rest, banco],
      llm: llmApi,
      maxRounds: 3,
    });
    const llmQualidade = criarLlm([]);
    const qualidade = new IntelligentOrchestrator({
      role: "Orquestrador de Qualidade",
      goal: "Garantir a qualidade",
      backstory: "Você coordena especialistas de qualidade.",
      subAgents: [testes, seguranca],
      llm: llmQualidade,
      maxRounds: 3,
    });

    // Intermediário e raiz: equipe só de orquestradores, apenas escolhem um
    const llmBackend = criarLlm(["Orquestrador de API"]);
    const backend = new OrchestratorRouter({
      role: "Orquestrador de Backend",
      goal: "Encaminhar o trabalho de backend",
      backstory: "Você conhece as equipes de backend.",
      subOrchestrators: [api],
      llm: llmBackend,
    });
    const llmRaiz = criarLlm(["Orquestrador de Backend"]);
    const raiz = new OrchestratorRouter({
      role: "Orquestrador raiz",
      goal: "Encaminhar cada solicitação ao orquestrador certo",
      backstory: "Você conhece todas as equipes.",
      subOrchestrators: [backend, qualidade],
      llm: llmRaiz,
    });

    const setHumanRequestBackend = vi.spyOn(backend, "setHumanRequest");
    const setHumanRequestApi = vi.spyOn(api, "setHumanRequest");
    const executeBackend = vi.spyOn(backend, "execute");
    const executeApi = vi.spyOn(api, "execute");
    const executeQualidade = vi.spyOn(qualidade, "execute");

    raiz.setHumanRequest(SOLICITACAO);
    const resultado = await raiz.execute();

    // A solicitação desce pelo caminho escolhido: raiz -> Backend -> API
    expect(setHumanRequestBackend).toHaveBeenCalledWith(SOLICITACAO);
    expect(setHumanRequestApi).toHaveBeenCalledWith(SOLICITACAO);
    expect(executeBackend).toHaveBeenCalledTimes(1);
    expect(executeApi).toHaveBeenCalledTimes(1);

    // O ramo não escolhido nunca roda
    expect(executeQualidade).not.toHaveBeenCalled();
    expect(llmQualidade.complete).not.toHaveBeenCalled();
    expect(executeTestes).not.toHaveBeenCalled();
    expect(executeSeguranca).not.toHaveBeenCalled();

    // Roteadores só escolhem (uma chamada ao LLM cada); só a folha delega a especialistas
    expect(llmRaiz.complete).toHaveBeenCalledTimes(1);
    expect(llmBackend.complete).toHaveBeenCalledTimes(1);
    expect(llmApi.complete).toHaveBeenCalledTimes(3);
    expect(executeRest).toHaveBeenCalledTimes(1);
    expect(executeBanco).toHaveBeenCalledTimes(1);

    // O resultado consolidado pela folha sobe até a raiz sem alteração
    expect(resultado).toEqual({
      status: "approve",
      response: "consolidado da API",
      confidence: 0.97,
      rounds: 1,
      resultados: [[resultadoRest, resultadoBanco]],
    });
  });

  it("deve rejeitar uma equipe que mistura orquestradores e especialistas", () => {
    const especialista = criarEspecialista("Especialista REST");
    const outroEspecialista = criarEspecialista("Especialista de banco de dados");
    const folha = new IntelligentOrchestrator({
      role: "Orquestrador de API",
      goal: "Entregar APIs completas",
      backstory: "Você coordena especialistas de API.",
      subAgents: [outroEspecialista],
      llm: criarLlm([]),
      maxRounds: 3,
    });

    // Quem chama especialistas não pode chamar orquestradores
    expect(
      () =>
        new IntelligentOrchestrator({
          role: "Orquestrador misto",
          goal: "Misturar equipes",
          backstory: "Você mistura tipos.",
          subAgents: [especialista, folha],
          llm: criarLlm([]),
          maxRounds: 3,
        }),
    ).toThrow(/especialistas/);

    // Quem chama orquestradores não pode chamar especialistas
    expect(
      () =>
        new OrchestratorRouter({
          role: "Roteador misto",
          goal: "Misturar equipes",
          backstory: "Você mistura tipos.",
          // @ts-expect-error: um especialista não é um orquestrador; a regra também vale em tempo de execução
          subOrchestrators: [folha, especialista],
          llm: criarLlm([]),
        }),
    ).toThrow(/orquestradores/);
  });
});
