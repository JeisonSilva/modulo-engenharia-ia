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

// Árvore: raiz -> Backend -> API [REST, Banco]  e  raiz -> Qualidade [Testes, Segurança].
// A raiz escolhe o Backend, o Backend escolhe a API e a API escolhe só o REST.
function montarArvore() {
  const rest = criarEspecialista("Especialista REST");
  const banco = criarEspecialista("Especialista de banco de dados");
  const testes = criarEspecialista("Especialista de testes");
  const seguranca = criarEspecialista("Especialista de segurança");

  const llmQualidade = criarLlm([]);
  const api = new IntelligentOrchestrator({
    role: "Orquestrador de API",
    goal: "Entregar APIs completas",
    backstory: "Você coordena especialistas de API.",
    subAgents: [rest, banco],
    llm: criarLlm(["Especialista REST", "consolidado da API", "0.97"]),
    maxRounds: 3,
  });
  const qualidade = new IntelligentOrchestrator({
    role: "Orquestrador de Qualidade",
    goal: "Garantir a qualidade",
    backstory: "Você coordena especialistas de qualidade.",
    subAgents: [testes, seguranca],
    llm: llmQualidade,
    maxRounds: 3,
  });
  const backend = new OrchestratorRouter({
    role: "Orquestrador de Backend",
    goal: "Encaminhar o trabalho de backend",
    backstory: "Você conhece as equipes de backend.",
    subOrchestrators: [api],
    llm: criarLlm(["Orquestrador de API"]),
  });
  const raiz = new OrchestratorRouter({
    role: "Orquestrador raiz",
    goal: "Encaminhar cada solicitação ao orquestrador certo",
    backstory: "Você conhece todas as equipes.",
    subOrchestrators: [backend, qualidade],
    llm: criarLlm(["Orquestrador de Backend"]),
  });

  return { rest, banco, testes, seguranca, raiz, llmQualidade };
}

describe("Padrão: Handoff", () => {
  it("deve subir o pedido pela árvore, processar no especialista pedido e devolver o resultado a quem pausou", async () => {
    const arvore = montarArvore();

    // O REST pausa no meio da execução e pede a avaliação de segurança
    vi.spyOn(arvore.rest, "execute").mockImplementation(async (contexto) => {
      const avaliacao = await contexto!.handoff(
        "Especialista de segurança",
        "Avalie o endpoint POST /clientes",
      );
      return {
        status: "approve",
        response: `REST: endpoint criado, com a avaliação: ${avaliacao.response}`,
      };
    });
    const executeSeguranca = vi
      .spyOn(arvore.seguranca, "execute")
      .mockResolvedValue({ status: "approve", response: "Segurança: sem vulnerabilidades" });
    const setHumanRequestSeguranca = vi.spyOn(arvore.seguranca, "setHumanRequest");
    const executeTestes = vi.spyOn(arvore.testes, "execute");
    const executeBanco = vi.spyOn(arvore.banco, "execute");

    arvore.raiz.setHumanRequest(SOLICITACAO);
    const resultado = await arvore.raiz.execute();

    // O pedido chega só ao especialista pedido, uma vez
    expect(setHumanRequestSeguranca).toHaveBeenCalledWith("Avalie o endpoint POST /clientes");
    expect(executeSeguranca).toHaveBeenCalledTimes(1);
    expect(executeTestes).not.toHaveBeenCalled();
    expect(executeBanco).not.toHaveBeenCalled();

    // O orquestrador de destino só repassa: não consolida nem chama o próprio LLM
    expect(arvore.llmQualidade.complete).not.toHaveBeenCalled();

    // O REST continuou de onde parou, com a avaliação, e o handoff fica registrado para auditoria
    expect(resultado).toMatchObject({
      response: "consolidado da API",
      resultados: [
        [
          {
            status: "approve",
            response: "REST: endpoint criado, com a avaliação: Segurança: sem vulnerabilidades",
          },
        ],
      ],
      handoffs: [
        {
          de: "Especialista REST",
          para: "Especialista de segurança",
          caminho: [
            "Orquestrador de API",
            "Orquestrador de Backend",
            "Orquestrador raiz",
            "Orquestrador de Qualidade",
          ],
        },
      ],
    });
  });

  it("deve devolver um erro ao especialista que pediu handoff para quem não existe na árvore", async () => {
    const arvore = montarArvore();

    let erroRecebido: unknown;
    vi.spyOn(arvore.rest, "execute").mockImplementation(async (contexto) => {
      try {
        await contexto!.handoff("Especialista inexistente", "Avalie o endpoint");
      } catch (erro) {
        erroRecebido = erro;
      }
      return { status: "approve", response: "REST: endpoint criado sem a avaliação" };
    });

    arvore.raiz.setHumanRequest(SOLICITACAO);
    const resultado = await arvore.raiz.execute();

    // O erro chega a quem pediu, que decide seguir; o processo não é interrompido
    expect(erroRecebido).toBeInstanceOf(Error);
    expect((erroRecebido as Error).message).toMatch(/Especialista inexistente/);
    expect(resultado).toMatchObject({ response: "consolidado da API" });
  });
});
