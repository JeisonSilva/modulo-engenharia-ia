import { z } from "zod";
import { AgentCoreIA, type AgentCoreIAOptions } from "../core/agent-core-ia.js";
import { mesclar, type Dados, type Estrutura } from "../core/estrutura.js";
import type { Llm } from "../core/llm.js";
import { extrairResponse, type AgentResponse } from "../core/response.js";

export type SequentialAgentOptions = AgentCoreIAOptions & {
  subAgents: AgentCoreIA[];
  // Tipagem fixa do que este sequencial entrega: ele a envia aos agents como JSON Schema e valida o resultado final
  schema?: z.ZodType;
  // Escreve a resposta final a partir do JSON preenchido; sem ele, a resposta é o próprio JSON
  llm?: Llm;
};

export type SequentialStructuredResult = AgentResponse & {
  dados: Dados;
  // Caminhos dos campos ausentes ou inválidos quando o status é "review"
  faltando?: string[];
};

export class SequentialAgent extends AgentCoreIA {
  readonly subAgents: readonly AgentCoreIA[];
  private readonly llm: Llm | undefined;
  private readonly schema: z.ZodType | undefined;

  constructor(options: SequentialAgentOptions) {
    super(options);
    this.subAgents = options.subAgents;
    this.llm = options.llm;
    this.schema = options.schema;
  }

  override async execute<T>(): Promise<T> {
    if (this.subAgents.length === 0) {
      return super.execute<T>();
    }
    const estrutura = this.estruturaDoPedido();
    if (estrutura !== undefined) {
      return (await this.executarEstruturado(estrutura)) as T;
    }

    let entrada = this.humanRequest;
    let resultado!: T;

    for (const agent of this.subAgents) {
      if (entrada !== undefined) {
        agent.setHumanRequest(entrada);
      }
      resultado = await agent.execute<T>();
      entrada = extrairResponse(resultado);
    }

    return resultado;
  }

  // O schema próprio vence o que vier no pedido; sem nenhum dos dois o pedido é só texto
  private estruturaDoPedido(): Estrutura | undefined {
    const pedidoOriginal = this.estrutura?.pedidoOriginal ?? this.humanRequest ?? "";
    if (this.schema !== undefined) {
      return { schema: z.toJSONSchema(this.schema), dados: this.estrutura?.dados ?? {}, pedidoOriginal };
    }
    return this.estrutura;
  }

  // O estado fica aqui: cada agent recebe a resposta da etapa anterior como texto, o schema e o que já
  // foi preenchido, e devolve só o seu trecho
  private async executarEstruturado(estrutura: Estrutura): Promise<SequentialStructuredResult> {
    const texto = this.humanRequest ?? "";
    let entrada = texto;
    let dados = estrutura.dados;

    for (const agent of this.subAgents) {
      agent.setHumanRequest(entrada, {
        schema: estrutura.schema,
        dados: structuredClone(dados),
        pedidoOriginal: estrutura.pedidoOriginal,
      });
      const resultado = await agent.execute<AgentResponse>();
      dados = mesclar(dados, resultado.dados);
      entrada = extrairResponse(resultado) ?? entrada;
    }

    let faltando: string[] = [];
    if (this.schema !== undefined) {
      const validacao = this.schema.safeParse(dados);
      if (validacao.success) {
        dados = validacao.data as Dados;
      } else {
        faltando = validacao.error.issues.map((problema) => problema.path.join("."));
      }
    }

    return {
      status: faltando.length === 0 ? "approve" : "review",
      response: await this.escreverResposta(estrutura.pedidoOriginal, dados, faltando),
      dados,
      ...(faltando.length > 0 ? { faltando } : {}),
    };
  }

  private async escreverResposta(pedido: string, dados: Dados, faltando: string[]): Promise<string> {
    if (this.llm === undefined) {
      return JSON.stringify(dados);
    }
    return this.llm.complete(
      [
        `Solicitação: ${pedido}`,
        `Dados preenchidos (JSON): ${JSON.stringify(dados)}`,
        ...(faltando.length > 0 ? [`Campos ausentes ou inválidos: ${faltando.join(", ")}`] : []),
        "Escreva uma resposta coerente com a solicitação usando apenas esses dados.",
      ].join("\n"),
    );
  }
}
