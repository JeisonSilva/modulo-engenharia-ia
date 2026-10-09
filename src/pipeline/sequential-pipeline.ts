import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Dados } from "../core/estrutura.js";
import type { Llm } from "../core/llm.js";
import type { MessageBroker } from "./broker.js";
import { TIPO_PEDIDO, type ErroDeEtapa, type PipelineMessage } from "./message.js";
import type { ResultStore, Solicitacao, StatusDaSolicitacao } from "./result-store.js";

export type SequentialPipelineOptions = {
  broker: MessageBroker;
  store: ResultStore;
  // Tipagem que o pipeline deve entregar preenchida
  schema: z.ZodType;
  // Routing key da primeira etapa: a única em que o sequencial publica
  keySaida: string;
  // Filas do consolidador: o fim do pipeline e os erros desviados pelos agents
  filaResultado: string;
  filaErro: string;
  // Redige a response e as observações; sem ele, a response é o JSON e as observações são fixas
  llm?: Llm;
};

export type Qualidade = {
  qualidade: number;
  faltando: string[];
  dados: Dados;
};

// Mede o quanto foi preenchido, não se o conteúdo está certo
export function medirQualidade(schema: z.ZodType, dados: Dados): Qualidade {
  const validacao = schema.safeParse(dados);
  if (validacao.success) {
    return { qualidade: 1, faltando: [], dados: validacao.data as Dados };
  }

  const problemas = validacao.error.issues;
  const faltando = [...new Set(problemas.map((problema) => problema.path.join(".")))];
  const obrigatorios = z.toJSONSchema(schema).required ?? [];
  if (obrigatorios.length === 0 || problemas.some((problema) => problema.path.length === 0)) {
    return { qualidade: 0, faltando, dados };
  }

  const invalidos = new Set(problemas.map((problema) => String(problema.path[0])));
  const validos = obrigatorios.filter((campo) => !invalidos.has(campo)).length;
  return { qualidade: Math.round((validos / obrigatorios.length) * 100) / 100, faltando, dados };
}

// O pattern sequencial como serviço: recebe a solicitação, publica na primeira etapa e consolida o resultado
export class SequentialPipeline {
  private readonly broker: MessageBroker;
  private readonly store: ResultStore;
  private readonly schema: z.ZodType;
  private readonly keySaida: string;
  private readonly filaResultado: string;
  private readonly filaErro: string;
  private readonly llm: Llm | undefined;

  constructor(options: SequentialPipelineOptions) {
    this.broker = options.broker;
    this.store = options.store;
    this.schema = options.schema;
    this.keySaida = options.keySaida;
    this.filaResultado = options.filaResultado;
    this.filaErro = options.filaErro;
    this.llm = options.llm;
  }

  // Liga o consolidador às suas duas filas
  async iniciar(): Promise<() => Promise<void>> {
    const pararResultado = await this.broker.consume(this.filaResultado, (mensagem) =>
      this.consolidar(mensagem, "resultado"),
    );
    const pararErro = await this.broker.consume(this.filaErro, (mensagem) => this.consolidar(mensagem, "erro"));
    return async () => {
      await pararResultado();
      await pararErro();
    };
  }

  async solicitar(texto: string): Promise<Solicitacao> {
    const solicitacao: Solicitacao = {
      id: randomUUID(),
      status: "processing",
      pedido: texto,
      criadoEm: new Date().toISOString(),
    };
    // Grava antes de publicar: o resultado nunca chega para uma solicitação desconhecida
    await this.store.salvar(solicitacao);
    await this.broker.publish(this.keySaida, {
      tipo: TIPO_PEDIDO,
      id: solicitacao.id,
      texto,
      pedidoOriginal: texto,
      schema: z.toJSONSchema(this.schema),
      dados: {},
    });
    return solicitacao;
  }

  consultar(id: string): Promise<Solicitacao | undefined> {
    return this.store.buscar(id);
  }

  private async consolidar(mensagem: PipelineMessage, origem: "resultado" | "erro"): Promise<void> {
    const { qualidade, faltando, dados } = medirQualidade(this.schema, mensagem.dados);
    const status: StatusDaSolicitacao =
      origem === "erro" ? "error" : mensagem.erro === undefined && faltando.length === 0 ? "approve" : "review";

    const anterior = await this.store.buscar(mensagem.id);
    const agora = new Date().toISOString();
    const observacoes = await this.escreverObservacoes(mensagem, faltando);

    await this.store.salvar({
      id: mensagem.id,
      status,
      pedido: mensagem.pedidoOriginal,
      criadoEm: anterior?.criadoEm ?? agora,
      concluidoEm: agora,
      response: await this.escreverResposta(mensagem.pedidoOriginal, dados, faltando, mensagem.erro),
      dados,
      qualidade,
      ...(observacoes !== undefined ? { observacoes } : {}),
      ...(faltando.length > 0 ? { faltando } : {}),
      ...(mensagem.erro !== undefined ? { erro: mensagem.erro } : {}),
    });
  }

  private fatos(faltando: string[], erro: ErroDeEtapa | undefined): string[] {
    return [
      ...(erro !== undefined ? [`A etapa "${erro.etapa}" falhou: ${erro.mensagem}.`] : []),
      ...(faltando.length > 0 ? [`Campos ausentes ou inválidos: ${faltando.join(", ")}.`] : []),
    ];
  }

  private async escreverObservacoes(mensagem: PipelineMessage, faltando: string[]): Promise<string | undefined> {
    const fatos = this.fatos(faltando, mensagem.erro);
    if (fatos.length === 0) {
      return undefined;
    }
    if (this.llm === undefined) {
      return fatos.join(" ");
    }
    return this.llm.complete(
      [
        `Solicitação: ${mensagem.pedidoOriginal}`,
        ...fatos,
        "Escreva observações curtas explicando o que ficou incompleto na resposta e por quê.",
      ].join("\n"),
    );
  }

  private async escreverResposta(
    pedido: string,
    dados: Dados,
    faltando: string[],
    erro: ErroDeEtapa | undefined,
  ): Promise<string> {
    if (this.llm === undefined) {
      return JSON.stringify(dados);
    }
    return this.llm.complete(
      [
        `Solicitação: ${pedido}`,
        `Dados preenchidos (JSON): ${JSON.stringify(dados)}`,
        ...this.fatos(faltando, erro),
        "Escreva uma resposta coerente com a solicitação usando apenas esses dados.",
      ].join("\n"),
    );
  }
}
