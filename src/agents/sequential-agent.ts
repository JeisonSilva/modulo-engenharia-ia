import { z } from "zod";
import { AgentCoreIA, type AgentCoreIAOptions } from "../core/agent-core-ia.js";
import { mesclar, type Dados, type Estrutura } from "../core/estrutura.js";
import type { Llm } from "../core/llm.js";
import { extrairResponse, type AgentResponse } from "../core/response.js";

export type SequentialAgentOptions = AgentCoreIAOptions & {
  subAgents: AgentCoreIA[];
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
  private validador: z.ZodType | undefined;

  constructor(options: SequentialAgentOptions) {
    super(options);
    this.subAgents = options.subAgents;
    this.llm = options.llm;
  }

  override setHumanRequest(text: string, estrutura?: Estrutura): void {
    super.setHumanRequest(text, estrutura);
    this.validador = undefined;
  }

  // O schema Zod valida o resultado final aqui; na fila ele viaja como JSON Schema
  setStructuredRequest(text: string, schema: z.ZodType, dados: Dados = {}): void {
    this.setHumanRequest(text, { schema: z.toJSONSchema(schema), dados });
    this.validador = schema;
  }

  override async execute<T>(): Promise<T> {
    if (this.subAgents.length === 0) {
      return super.execute<T>();
    }
    if (this.estrutura !== undefined) {
      return (await this.executarEstruturado(this.estrutura)) as T;
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

  // O estado fica aqui: cada agent recebe o schema e o que já foi preenchido, e devolve só o seu trecho
  private async executarEstruturado(estrutura: Estrutura): Promise<SequentialStructuredResult> {
    const texto = this.humanRequest ?? "";
    let dados = estrutura.dados;

    for (const agent of this.subAgents) {
      agent.setHumanRequest(texto, { schema: estrutura.schema, dados: structuredClone(dados) });
      const resultado = await agent.execute<AgentResponse>();
      dados = mesclar(dados, resultado.dados);
    }

    let faltando: string[] = [];
    if (this.validador !== undefined) {
      const validacao = this.validador.safeParse(dados);
      if (validacao.success) {
        dados = validacao.data as Dados;
      } else {
        faltando = validacao.error.issues.map((problema) => problema.path.join("."));
      }
    }

    return {
      status: faltando.length === 0 ? "approve" : "review",
      response: await this.escreverResposta(texto, dados, faltando),
      dados,
      ...(faltando.length > 0 ? { faltando } : {}),
    };
  }

  private async escreverResposta(texto: string, dados: Dados, faltando: string[]): Promise<string> {
    if (this.llm === undefined) {
      return JSON.stringify(dados);
    }
    return this.llm.complete(
      [
        `Solicitação: ${texto}`,
        `Dados preenchidos (JSON): ${JSON.stringify(dados)}`,
        ...(faltando.length > 0 ? [`Campos ausentes ou inválidos: ${faltando.join(", ")}`] : []),
        "Escreva uma resposta coerente com a solicitação usando apenas esses dados.",
      ].join("\n"),
    );
  }
}
