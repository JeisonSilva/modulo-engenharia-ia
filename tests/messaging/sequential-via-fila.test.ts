import { describe, expect, it } from "vitest";
import {
  AgentCoreIA,
  InMemoryTransport,
  RemoteAgent,
  SequentialAgent,
  type AgentResponse,
} from "../../src/index.js";

class Eco extends AgentCoreIA {
  readonly recebidos: string[] = [];

  constructor(role: string, private readonly sufixo: string) {
    super({ role, goal: "ecoar", backstory: "teste" });
  }

  override async execute<T>(): Promise<T> {
    this.recebidos.push(this.humanRequest ?? "");
    return { status: "approve", response: `${this.humanRequest}${this.sufixo}` } as T;
  }
}

describe("SequentialAgent com agents atendendo por fila", () => {
  it("encadeia as respostas passando pela fila de cada agent", async () => {
    const transport = new InMemoryTransport();
    await new Eco("a", "-A").listen(transport);
    await new Eco("b", "-B").listen(transport);

    const sequencial = new SequentialAgent({
      role: "pipeline",
      goal: "encadear",
      backstory: "teste",
      subAgents: [
        new RemoteAgent({ role: "a", transport }),
        new RemoteAgent({ role: "b", transport }),
      ],
    });
    sequencial.setHumanRequest("x");

    const resultado = await sequencial.execute<AgentResponse>();

    expect(resultado.response).toBe("x-A-B");
  });

  it("dois patterns usam o mesmo agent pela mesma fila", async () => {
    const transport = new InMemoryTransport();
    const analisador = new Eco("analisador", "!");
    await analisador.listen(transport);

    const montar = () =>
      new SequentialAgent({
        role: "p",
        goal: "g",
        backstory: "b",
        subAgents: [new RemoteAgent({ role: "analisador", transport })],
      });
    const [p1, p2] = [montar(), montar()];
    p1.setHumanRequest("um");
    p2.setHumanRequest("dois");

    const [r1, r2] = await Promise.all([p1.execute<AgentResponse>(), p2.execute<AgentResponse>()]);

    expect(r1.response).toBe("um!");
    expect(r2.response).toBe("dois!");
    expect(analisador.recebidos).toEqual(["um", "dois"]);
  });

  it("atende uma mensagem por vez", async () => {
    const transport = new InMemoryTransport();
    let simultaneas = 0;
    let maximo = 0;
    const lento = new Eco("lento", "");
    lento.execute = async <T,>() => {
      simultaneas++;
      maximo = Math.max(maximo, simultaneas);
      await new Promise((r) => setTimeout(r, 10));
      simultaneas--;
      return { status: "approve", response: "ok" } as T;
    };
    await lento.listen(transport);

    await Promise.all([transport.request("lento", { texto: "1" }), transport.request("lento", { texto: "2" }), transport.request("lento", { texto: "3" })]);

    expect(maximo).toBe(1);
  });

  it("propaga o erro do agent a quem pediu", async () => {
    const transport = new InMemoryTransport();
    const falho = new Eco("falho", "");
    falho.execute = async () => {
      throw new Error("quebrou");
    };
    await falho.listen(transport);

    await expect(transport.request("falho", { texto: "x" })).rejects.toThrow("quebrou");
  });

  it("recusa escutar sem role", async () => {
    const semRole = new AgentCoreIA({ systemPrompt: "x" });
    await expect(semRole.listen(new InMemoryTransport())).rejects.toThrow("role");
  });
});
