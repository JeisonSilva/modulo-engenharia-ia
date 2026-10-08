import { AgentCoreIA, type AgentCoreIAOptions } from "../core/agent-core-ia.js";
import {
  acrescentar,
  contextoSemHandoff,
  destinoInexistente,
  type ExecutionContext,
  type HandoffRegistro,
  type HandoffResultado,
} from "../handoff/handoff.js";
import type { Llm } from "../core/llm.js";
import { isOrchestrator } from "../handoff/orchestrator-node.js";
import { extrairResponse, type AgentResponse } from "../core/response.js";

export type IntelligentOrchestratorOptions = AgentCoreIAOptions & {
  subAgents: AgentCoreIA[];
  llm: Llm;
  maxRounds: number;
};

export type IntelligentOrchestratorResult = {
  status: "approve" | "review";
  response: string;
  confidence: number;
  rounds: number;
  observations?: string;
  resultados: AgentResponse[][];
  handoffs?: HandoffRegistro[];
};

const CERTEZA_MINIMA = 0.95;

export class IntelligentOrchestrator extends AgentCoreIA {
  readonly isOrchestrator = true as const;
  readonly subAgents: readonly AgentCoreIA[];
  private readonly llm: Llm;
  private readonly maxRounds: number;

  constructor(options: IntelligentOrchestratorOptions) {
    super(options);
    if (!Number.isInteger(options.maxRounds) || options.maxRounds < 1) {
      throw new Error("maxRounds deve ser um inteiro maior ou igual a 1");
    }
    if (options.subAgents.some(isOrchestrator)) {
      throw new Error(
        "A equipe de um orquestrador com especialistas deve conter apenas especialistas, nunca orquestradores",
      );
    }
    this.subAgents = options.subAgents;
    this.llm = options.llm;
    this.maxRounds = options.maxRounds;
  }

  override async execute<T>(contexto?: ExecutionContext): Promise<T> {
    const solicitacao = this.humanRequest;
    if (solicitacao === undefined || this.subAgents.length === 0) {
      return super.execute<T>();
    }

    const resultadosPorRodada: AgentResponse[][] = [];
    const handoffs: HandoffRegistro[] = [];
    let pedido = solicitacao;
    let consolidado = "";
    let certeza = 0;

    for (let rodada = 1; rodada <= this.maxRounds; rodada++) {
      const escolhidos = await this.escolherEspecialistas(pedido);
      const resultados = await Promise.all(
        escolhidos.map((agent) => {
          agent.setHumanRequest(pedido);
          return agent.execute<AgentResponse>(this.contextoDoEspecialista(agent, contexto, handoffs));
        }),
      );
      resultadosPorRodada.push(resultados);

      consolidado = await this.consolidar(solicitacao, escolhidos, resultados);
      certeza = await this.avaliarCerteza(solicitacao, consolidado);

      if (certeza >= CERTEZA_MINIMA) {
        return {
          status: "approve",
          response: consolidado,
          confidence: certeza,
          rounds: rodada,
          resultados: resultadosPorRodada,
          ...(handoffs.length > 0 ? { handoffs } : {}),
        } satisfies IntelligentOrchestratorResult as T;
      }

      pedido = `${solicitacao}\n\nConsolidação anterior:\n${consolidado}`;
    }

    const observations = await this.llm.complete(
      [
        `Solicitação: ${solicitacao}`,
        `Resposta consolidada: ${consolidado}`,
        `A certeza chegou a ${certeza} após ${this.maxRounds} rodadas, abaixo de ${CERTEZA_MINIMA}.`,
        "Escreva observações explicando o que impediu a certeza de atingir o mínimo.",
      ].join("\n"),
    );

    return {
      status: "review",
      response: consolidado,
      confidence: certeza,
      rounds: this.maxRounds,
      observations,
      resultados: resultadosPorRodada,
      ...(handoffs.length > 0 ? { handoffs } : {}),
    } satisfies IntelligentOrchestratorResult as T;
  }

  // Descida: atende um handoff vindo de fora se o destino for um especialista desta equipe
  async receberHandoff(
    para: string,
    pedido: string,
    caminho: string[],
  ): Promise<HandoffResultado | undefined> {
    const destino = this.subAgents.find((agent) => agent.role === para);
    if (destino === undefined) {
      return undefined;
    }
    destino.setHumanRequest(pedido);
    const resposta = await destino.execute<AgentResponse>(contextoSemHandoff());
    return { resposta, caminho: acrescentar(caminho, this.role) };
  }

  // Contexto de um especialista: o handoff procura primeiro na própria equipe e depois sobe a árvore
  private contextoDoEspecialista(
    agent: AgentCoreIA,
    contextoPai: ExecutionContext | undefined,
    handoffs: HandoffRegistro[],
  ): ExecutionContext {
    const resolver = async (
      para: string,
      pedido: string,
      caminho: string[],
    ): Promise<HandoffResultado> => {
      const caminhoAqui = acrescentar(caminho, this.role);
      const irmao = this.subAgents.find((candidato) => candidato !== agent && candidato.role === para);
      if (irmao !== undefined) {
        irmao.setHumanRequest(pedido);
        const resposta = await irmao.execute<AgentResponse>(contextoSemHandoff());
        return { resposta, caminho: caminhoAqui };
      }
      if (contextoPai?.resolver !== undefined) {
        return contextoPai.resolver(para, pedido, caminhoAqui);
      }
      throw destinoInexistente(para);
    };

    return {
      resolver,
      handoff: async (para, pedido) => {
        const resultado = await resolver(para, pedido, []);
        handoffs.push({ de: agent.role ?? "(sem role)", para, caminho: resultado.caminho });
        return resultado.resposta;
      },
    };
  }

  private async escolherEspecialistas(pedido: string): Promise<AgentCoreIA[]> {
    const roles = this.subAgents.map((agent) => agent.role).filter((role) => role !== undefined);
    const resposta = await this.llm.complete(
      [
        this.systemPrompt,
        `Solicitação: ${pedido}`,
        `Subagents disponíveis: ${roles.join(", ")}`,
        "Responda apenas com os nomes dos especialistas mais adequados, separados por vírgula.",
      ].join("\n"),
    );

    return resposta.split(",").map((nome) => {
      const escolhido = this.subAgents.find((agent) => agent.role === nome.trim());
      if (escolhido === undefined) {
        throw new Error(`O LLM escolheu um subagent inexistente: "${nome.trim()}"`);
      }
      return escolhido;
    });
  }

  private consolidar(
    solicitacao: string,
    escolhidos: AgentCoreIA[],
    resultados: AgentResponse[],
  ): Promise<string> {
    const linhas = resultados.map(
      (resultado, indice) => `${escolhidos[indice]?.role}: ${extrairResponse(resultado) ?? ""}`,
    );
    return this.llm.complete(
      [
        `Solicitação: ${solicitacao}`,
        "Consolide os resultados dos especialistas em uma única resposta:",
        ...linhas,
      ].join("\n"),
    );
  }

  private async avaliarCerteza(solicitacao: string, consolidado: string): Promise<number> {
    const resposta = await this.llm.complete(
      [
        `Solicitação: ${solicitacao}`,
        `Resposta consolidada: ${consolidado}`,
        "Avalie a certeza de que a resposta atende à solicitação.",
        "Responda apenas com um número de 0 a 1.",
      ].join("\n"),
    );

    const certeza = Number(resposta.trim().replace(",", "."));
    if (Number.isNaN(certeza) || certeza < 0 || certeza > 1) {
      throw new Error(`O LLM devolveu uma certeza inválida: "${resposta}"`);
    }
    return certeza;
  }
}
