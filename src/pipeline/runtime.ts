import type { Server } from "node:http";
import type { z } from "zod";
import type { AgentCoreIA } from "../core/agent-core-ia.js";
import type { Llm } from "../core/llm.js";
import { ligarAgent } from "./agent-stage.js";
import { criarServidorHttp } from "./http.js";
import { MongoResultStore } from "./mongo-result-store.js";
import { RabbitMqBroker } from "./rabbitmq-broker.js";
import { SequentialPipeline } from "./sequential-pipeline.js";

type Ambiente = Record<string, string | undefined>;

function obrigatoria(ambiente: Ambiente, nome: string): string {
  const valor = ambiente[nome];
  if (valor === undefined || valor === "") {
    throw new Error(`A variável de ambiente ${nome} é obrigatória`);
  }
  return valor;
}

function conectarBroker(ambiente: Ambiente): Promise<RabbitMqBroker> {
  const exchange = ambiente["EXCHANGE"];
  return RabbitMqBroker.connect(
    obrigatoria(ambiente, "RABBITMQ_URL"),
    exchange !== undefined && exchange !== "" ? { exchange } : {},
  );
}

function aoEncerrar(fechar: () => Promise<void>): void {
  for (const sinal of ["SIGTERM", "SIGINT"] as const) {
    process.once(sinal, () => {
      void fechar().finally(() => process.exit(0));
    });
  }
}

// Entrypoint do container de um agent.
// Variáveis: RABBITMQ_URL, EXCHANGE, FILA_ENTRADA, KEY_SAIDA, KEY_ERRO, FILA_ERRO_HABILITADA
export async function iniciarAgentPeloAmbiente(agent: AgentCoreIA, ambiente: Ambiente = process.env): Promise<void> {
  const keyErro = ambiente["KEY_ERRO"];
  const config = {
    filaEntrada: obrigatoria(ambiente, "FILA_ENTRADA"),
    keySaida: obrigatoria(ambiente, "KEY_SAIDA"),
    filaErroHabilitada: ambiente["FILA_ERRO_HABILITADA"] === "true",
    ...(keyErro !== undefined && keyErro !== "" ? { keyErro } : {}),
  };
  const broker = await conectarBroker(ambiente);
  await ligarAgent(agent, broker, config);
  aoEncerrar(() => broker.close());
  console.log(`Agent "${agent.role ?? config.filaEntrada}" consumindo a fila "${config.filaEntrada}"`);
}

export type SequencialPeloAmbienteOptions = {
  schema: z.ZodType;
  llm?: Llm;
};

// Entrypoint do container do sequencial (API + consolidador).
// Variáveis: RABBITMQ_URL, EXCHANGE, KEY_SAIDA, FILA_RESULTADO, FILA_ERRO, MONGODB_URL, MONGODB_DB, PORT
export async function iniciarSequencialPeloAmbiente(
  options: SequencialPeloAmbienteOptions,
  ambiente: Ambiente = process.env,
): Promise<Server> {
  const database = ambiente["MONGODB_DB"];
  const broker = await conectarBroker(ambiente);
  const store = await MongoResultStore.connect(
    obrigatoria(ambiente, "MONGODB_URL"),
    database !== undefined && database !== "" ? { database } : {},
  );
  const pipeline = new SequentialPipeline({
    broker,
    store,
    schema: options.schema,
    keySaida: obrigatoria(ambiente, "KEY_SAIDA"),
    filaResultado: obrigatoria(ambiente, "FILA_RESULTADO"),
    filaErro: obrigatoria(ambiente, "FILA_ERRO"),
    ...(options.llm !== undefined ? { llm: options.llm } : {}),
  });
  await pipeline.iniciar();

  const porta = Number(ambiente["PORT"] ?? 8080);
  const servidor = criarServidorHttp(pipeline).listen(porta);
  aoEncerrar(async () => {
    servidor.close();
    await broker.close();
    await store.close();
  });
  console.log(`Sequencial ouvindo na porta ${porta}`);
  return servidor;
}
