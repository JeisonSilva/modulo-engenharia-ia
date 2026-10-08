import { AgentCoreIA, type AgentCoreIAOptions } from "./agent-core-ia.js";
import type { Llm } from "./llm.js";
import { isOrchestrator } from "./orchestrator-node.js";
import { extrairResponse, type AgentResponse } from "./response.js";

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

  override async execute<T>(): Promise<T> {
    const solicitacao = this.humanRequest;
    if (solicitacao === undefined || this.subAgents.length === 0) {
      return super.execute<T>();
    }

    const resultadosPorRodada: AgentResponse[][] = [];
    let pedido = solicitacao;
    let consolidado = "";
    let certeza = 0;

    for (let rodada = 1; rodada <= this.maxRounds; rodada++) {
      const escolhidos = await this.escolherEspecialistas(pedido);
      const resultados = await Promise.all(
        escolhidos.map((agent) => {
          agent.setHumanRequest(pedido);
          return agent.execute<AgentResponse>();
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
    } satisfies IntelligentOrchestratorResult as T;
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
