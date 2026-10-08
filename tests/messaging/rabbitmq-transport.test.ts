import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentCoreIA,
  RabbitMqTransport,
  RemoteAgent,
  SequentialAgent,
  type AgentResponse,
} from "../../src/index.js";

// Precisa de um broker: docker compose up -d && RABBITMQ_URL=amqp://localhost npm test
const url = process.env["RABBITMQ_URL"];

class Eco extends AgentCoreIA {
  constructor(role: string, private readonly sufixo: string) {
    super({ role, goal: "ecoar", backstory: "teste" });
  }

  override async execute<T>(): Promise<T> {
    return { status: "approve", response: `${this.humanRequest}${this.sufixo}` } as T;
  }
}

describe.skipIf(url === undefined)("RabbitMqTransport", () => {
  const abertos: RabbitMqTransport[] = [];
  const conectar = async (exchange: string) => {
    const transport = await RabbitMqTransport.connect(url as string, { exchange, requestTimeoutMs: 5000 });
    abertos.push(transport);
    return transport;
  };

  afterEach(async () => {
    await Promise.all(abertos.splice(0).map((t) => t.close()));
  });

  it("encadeia agents que escutam filas em conexões diferentes", async () => {
    const sufixo = Date.now().toString(36);
    const a = `a-${sufixo}`;
    const b = `b-${sufixo}`;
    const exchange = `agents-test-${sufixo}`;

    await new Eco(a, "-A").listen(await conectar(exchange));
    await new Eco(b, "-B").listen(await conectar(exchange));

    const produtor = await conectar(exchange);
    const sequencial = new SequentialAgent({
      role: "pipeline",
      goal: "encadear",
      backstory: "teste",
      subAgents: [
        new RemoteAgent({ role: a, transport: produtor }),
        new RemoteAgent({ role: b, transport: produtor }),
      ],
    });
    sequencial.setHumanRequest("x");

    expect((await sequencial.execute<AgentResponse>()).response).toBe("x-A-B");
  });

  it("leva o schema e os dados pela fila e devolve o patch preenchido", async () => {
    const role = `estruturado-${Date.now().toString(36)}`;
    const exchange = `agents-test-${role}`;
    class Preenche extends AgentCoreIA {
      override async execute<T>(): Promise<T> {
        const antes = Object.keys(this.estrutura?.dados ?? {});
        return { status: "approve", response: "ok", dados: { campo: "valor", antes } } as T;
      }
    }
    await new Preenche({ role, goal: "g", backstory: "b" }).listen(await conectar(exchange));

    const remoto = new RemoteAgent({ role, transport: await conectar(exchange) });
    remoto.setHumanRequest("x", { schema: { type: "object" }, dados: { ja: 1 }, pedidoOriginal: "x" });

    const resposta = await remoto.execute<AgentResponse>();

    expect(resposta.dados).toEqual({ campo: "valor", antes: ["ja"] });
  });

  it("o sequencial consome a própria fila e percorre os agents pelas filas", async () => {
    const sufixo = Date.now().toString(36);
    const exchange = `agents-test-seq-${sufixo}`;
    const [a, b, seq] = [`a-${sufixo}`, `b-${sufixo}`, `seq-${sufixo}`];
    class Preenche extends AgentCoreIA {
      constructor(role: string, private readonly patch: Record<string, unknown>) {
        super({ role, goal: "g", backstory: "b" });
      }
      override async execute<T>(): Promise<T> {
        return { status: "approve", response: `${this.humanRequest}>${this.role}`, dados: this.patch } as T;
      }
    }
    await new Preenche(a, { nome: "Maria" }).listen(await conectar(exchange));
    await new Preenche(b, { idade: 30 }).listen(await conectar(exchange));

    const interno = await conectar(exchange);
    const sequencial = new SequentialAgent({
      role: seq,
      goal: "g",
      backstory: "b",
      schema: z.object({ nome: z.string(), idade: z.number() }),
      subAgents: [new RemoteAgent({ role: a, transport: interno }), new RemoteAgent({ role: b, transport: interno })],
    });
    await sequencial.listen(interno);

    const resposta = await (await conectar(exchange)).request(seq, { texto: "x" });

    expect(resposta.status).toBe("approve");
    expect(resposta.dados).toEqual({ nome: "Maria", idade: 30 });
  });

  it("propaga o erro do agent a quem pediu", async () => {
    const role = `falho-${Date.now().toString(36)}`;
    const exchange = `agents-test-${role}`;
    const falho = new Eco(role, "");
    falho.execute = async () => {
      throw new Error("quebrou");
    };
    await falho.listen(await conectar(exchange));

    await expect((await conectar(exchange)).request(role, { texto: "x" })).rejects.toThrow("quebrou");
  });
});
