import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentCoreIA,
  InMemoryTransport,
  RemoteAgent,
  SequentialAgent,
  mesclar,
  type AgentResponse,
  type Dados,
  type Estrutura,
  type Llm,
  type SequentialStructuredResult,
} from "../../src/index.js";

const ConsultaSchema = z.object({
  sintomas: z.array(z.string()),
  diagnostico: z.object({ hipotese: z.string(), cid: z.string() }),
  conduta: z.string(),
});

// Preenche o trecho que conhece, responde "resposta de <role>" e registra o que recebeu
class Preenche extends AgentCoreIA {
  recebido: { texto: string; estrutura?: Estrutura } = { texto: "" };

  constructor(role: string, private readonly patch: Dados) {
    super({ role, goal: "preencher", backstory: "teste" });
  }

  override async execute<T>(): Promise<T> {
    this.recebido = {
      texto: this.humanRequest ?? "",
      ...(this.estrutura !== undefined ? { estrutura: this.estrutura } : {}),
    };
    return { status: "approve", response: `resposta de ${this.role}`, dados: this.patch } as T;
  }
}

async function montar(patches: Record<string, Dados>, llm?: Llm) {
  const transport = new InMemoryTransport();
  const agentes = Object.entries(patches).map(([role, patch]) => new Preenche(role, patch));
  for (const agente of agentes) {
    await agente.listen(transport);
  }
  const sequencial = new SequentialAgent({
    role: "consulta",
    goal: "preencher",
    backstory: "teste",
    schema: ConsultaSchema,
    subAgents: Object.keys(patches).map((role) => new RemoteAgent({ role, transport })),
    ...(llm !== undefined ? { llm } : {}),
  });
  return { sequencial, agentes, transport };
}

describe("SequentialAgent com schema fixo", () => {
  it("passa a response anterior como texto e acumula os dados validados", async () => {
    const { sequencial, agentes } = await montar({
      triagem: { sintomas: ["febre", "tosse"] },
      medico: { diagnostico: { hipotese: "gripe" } },
      revisor: { diagnostico: { cid: "J11" }, conduta: "repouso" },
    });
    sequencial.setHumanRequest("analise a consulta da Maria");

    const resultado = await sequencial.execute<SequentialStructuredResult>();

    expect(resultado.status).toBe("approve");
    expect(resultado.dados).toEqual({
      sintomas: ["febre", "tosse"],
      diagnostico: { hipotese: "gripe", cid: "J11" },
      conduta: "repouso",
    });
    expect(JSON.parse(resultado.response)).toEqual(resultado.dados);

    const [triagem, medico, revisor] = agentes;
    expect(triagem?.recebido.texto).toBe("analise a consulta da Maria");
    expect(medico?.recebido.texto).toBe("resposta de triagem");
    expect(revisor?.recebido.texto).toBe("resposta de medico");
    expect(revisor?.recebido.estrutura?.pedidoOriginal).toBe("analise a consulta da Maria");
    expect(triagem?.recebido.estrutura?.dados).toEqual({});
    expect(medico?.recebido.estrutura?.dados).toEqual({ sintomas: ["febre", "tosse"] });
    expect(revisor?.recebido.estrutura?.schema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["conduta"]),
    });
  });

  it("devolve review com os campos que faltam", async () => {
    const { sequencial } = await montar({ triagem: { sintomas: ["febre"] } });
    sequencial.setHumanRequest("x");

    const resultado = await sequencial.execute<SequentialStructuredResult>();

    expect(resultado.status).toBe("review");
    expect(resultado.faltando).toEqual(expect.arrayContaining(["diagnostico", "conduta"]));
    expect(resultado.dados).toEqual({ sintomas: ["febre"] });
  });

  it("usa o Llm para escrever a resposta final com o pedido original e o JSON", async () => {
    const prompts: string[] = [];
    const llm: Llm = {
      complete: async (prompt) => {
        prompts.push(prompt);
        return "Maria está com gripe.";
      },
    };
    const { sequencial } = await montar(
      { a: { sintomas: [], diagnostico: { hipotese: "gripe", cid: "J11" }, conduta: "repouso" } },
      llm,
    );
    sequencial.setHumanRequest("analise a Maria");

    const resultado = await sequencial.execute<SequentialStructuredResult>();

    expect(resultado.response).toBe("Maria está com gripe.");
    expect(prompts[0]).toContain("analise a Maria");
    expect(prompts[0]).toContain('"hipotese":"gripe"');
  });

  it("consome a fila do sequencial: pega uma mensagem, percorre os agents e responde", async () => {
    const { sequencial, transport } = await montar({
      triagem: { sintomas: ["febre"] },
      medico: { diagnostico: { hipotese: "gripe", cid: "J11" }, conduta: "repouso" },
    });
    await sequencial.listen(transport);

    const resposta = await transport.request("consulta", { texto: "analise a Maria" });

    expect(resposta.status).toBe("approve");
    expect(resposta.dados).toMatchObject({ conduta: "repouso" });
  });

  it("sem schema e sem estrutura mantém o encadeamento de texto", async () => {
    const transport = new InMemoryTransport();
    const a = new Preenche("a", {});
    const b = new Preenche("b", {});
    await a.listen(transport);
    await b.listen(transport);
    const sequencial = new SequentialAgent({
      role: "s",
      goal: "g",
      backstory: "b",
      subAgents: [new RemoteAgent({ role: "a", transport }), new RemoteAgent({ role: "b", transport })],
    });
    sequencial.setHumanRequest("x");

    const resultado = await sequencial.execute<AgentResponse>();

    expect(resultado).toEqual({ status: "approve", response: "resposta de b", dados: {} });
    expect(b.recebido).toEqual({ texto: "resposta de a" });
  });
});

describe("mesclar", () => {
  it("funde objetos e substitui o resto", () => {
    expect(mesclar({ a: { x: 1 }, l: [1] }, { a: { y: 2 }, l: [2] })).toEqual({ a: { x: 1, y: 2 }, l: [2] });
  });
});
