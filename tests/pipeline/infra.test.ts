import { afterEach, describe, expect, it } from "vitest";
import {
  MongoResultStore,
  RabbitMqBroker,
  TIPO_PEDIDO,
  type PipelineMessage,
  type Solicitacao,
} from "../../src/index.js";

// Precisam de infraestrutura: docker compose up -d
//   RABBITMQ_URL=amqp://localhost MONGODB_URL=mongodb://localhost npm test
const rabbit = process.env["RABBITMQ_URL"];
const mongo = process.env["MONGODB_URL"];
const sufixo = Date.now().toString(36);

describe.skipIf(rabbit === undefined)("RabbitMqBroker", () => {
  const abertos: RabbitMqBroker[] = [];
  const conectar = async () => {
    const broker = await RabbitMqBroker.connect(rabbit as string, { exchange: `pipeline-test-${sufixo}` });
    abertos.push(broker);
    return broker;
  };
  afterEach(async () => {
    await Promise.all(abertos.splice(0).map((broker) => broker.close()));
  });

  const mensagem = (id: string): PipelineMessage => ({
    tipo: TIPO_PEDIDO,
    id,
    texto: "x",
    pedidoOriginal: "x",
    schema: { type: "object" },
    dados: { a: 1 },
  });

  it("entrega pela routing key, uma por vez, mesmo publicando antes de o consumidor subir", async () => {
    const fila = `fila-${sufixo}`;
    const produtor = await conectar();
    await produtor.publish(fila, mensagem("1"));
    await produtor.publish(fila, mensagem("2"));

    const recebidas: string[] = [];
    let simultaneas = 0;
    let maximo = 0;
    const fim = new Promise<void>((resolve) => {
      void conectar().then((consumidor) =>
        consumidor.consume(fila, async (recebida) => {
          maximo = Math.max(maximo, ++simultaneas);
          await new Promise((r) => setTimeout(r, 20));
          simultaneas--;
          recebidas.push(recebida.id);
          if (recebidas.length === 2) {
            resolve();
          }
        }),
      );
    });
    await fim;

    expect(recebidas).toEqual(["1", "2"]);
    expect(maximo).toBe(1);
  });
});

describe.skipIf(mongo === undefined)("MongoResultStore", () => {
  it("grava, substitui e busca a solicitação pelo id", async () => {
    const store = await MongoResultStore.connect(mongo as string, { database: `pipeline_test_${sufixo}` });
    try {
      const inicial: Solicitacao = { id: "abc", status: "processing", pedido: "x", criadoEm: "2026-01-01T00:00:00.000Z" };
      await store.salvar(inicial);
      expect(await store.buscar("abc")).toEqual(inicial);

      const final: Solicitacao = { ...inicial, status: "approve", qualidade: 1, dados: { a: 1 }, response: "ok" };
      await store.salvar(final);
      expect(await store.buscar("abc")).toEqual(final);
      expect(await store.buscar("nao-existe")).toBeUndefined();
    } finally {
      await store.close();
    }
  });
});
