import { AgentCoreIA, type AgentCoreIAOptions } from "./agent-core-ia.js";
import {
  acrescentar,
  criarContexto,
  destinoInexistente,
  type ExecutionContext,
  type HandoffResolver,
  type HandoffResultado,
} from "./handoff.js";
import type { Llm } from "./llm.js";
import { isOrchestrator, type OrchestratorNode } from "./orchestrator-node.js";

export type OrchestratorRouterOptions = AgentCoreIAOptions & {
  subOrchestrators: OrchestratorNode[];
  llm: Llm;
};

export class OrchestratorRouter extends AgentCoreIA {
  readonly isOrchestrator = true as const;
  readonly subOrchestrators: readonly OrchestratorNode[];
  private readonly llm: Llm;

  constructor(options: OrchestratorRouterOptions) {
    super(options);
    if (!options.subOrchestrators.every(isOrchestrator)) {
      throw new Error(
        "A equipe de um roteador deve conter apenas orquestradores, nunca especialistas",
      );
    }
    this.subOrchestrators = options.subOrchestrators;
    this.llm = options.llm;
  }

  override async execute<T>(contexto?: ExecutionContext): Promise<T> {
    const solicitacao = this.humanRequest;
    if (solicitacao === undefined || this.subOrchestrators.length === 0) {
      return super.execute<T>();
    }

    const roles = this.subOrchestrators.map((orquestrador) => orquestrador.role).filter((role) => role !== undefined);
    const resposta = await this.llm.complete(
      [
        this.systemPrompt,
        `Solicitação: ${solicitacao}`,
        `Orquestradores disponíveis: ${roles.join(", ")}`,
        "Responda apenas com o nome do orquestrador mais adequado para executar a tarefa.",
      ].join("\n"),
    );

    const escolhido = this.subOrchestrators.find((orquestrador) => orquestrador.role === resposta.trim());
    if (escolhido === undefined) {
      throw new Error(`O LLM escolheu um orquestrador inexistente: "${resposta.trim()}"`);
    }

    escolhido.setHumanRequest(solicitacao);
    const resultado = await escolhido.execute<Record<string, unknown>>(
      criarContexto(this.subirHandoff(escolhido, contexto)),
    );

    const caminhoDoFilho = Array.isArray(resultado.route) ? resultado.route : [escolhido.role];
    const route = [this.role, ...caminhoDoFilho].filter((role) => role !== undefined);
    return { ...resultado, route } as T;
  }

  // Descida: procura o destino nas subárvores, acrescentando este roteador ao caminho
  async receberHandoff(
    para: string,
    pedido: string,
    caminho: string[],
  ): Promise<HandoffResultado | undefined> {
    const caminhoAqui = acrescentar(caminho, this.role);
    for (const filho of this.subOrchestrators) {
      const resultado = await filho.receberHandoff(para, pedido, caminhoAqui);
      if (resultado !== undefined) {
        return resultado;
      }
    }
    return undefined;
  }

  // Subida: o filho que já procurou na própria subárvore pede ajuda; tenta os irmãos e depois o pai
  private subirHandoff(escolhido: OrchestratorNode, contextoPai?: ExecutionContext): HandoffResolver {
    return async (para, pedido, caminho) => {
      const caminhoAqui = acrescentar(caminho, this.role);
      for (const irmao of this.subOrchestrators) {
        if (irmao === escolhido) {
          continue;
        }
        const resultado = await irmao.receberHandoff(para, pedido, caminhoAqui);
        if (resultado !== undefined) {
          return resultado;
        }
      }
      if (contextoPai?.resolver !== undefined) {
        return contextoPai.resolver(para, pedido, caminhoAqui);
      }
      throw destinoInexistente(para);
    };
  }
}
