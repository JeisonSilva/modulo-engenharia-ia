import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentCoreIA,
  InMemoryTransport,
  RemoteAgent,
  SequentialAgent,
  mesclar,
  type Dados,
  type Llm,
  type SequentialStructuredResult,
} from "../../src/index.js";

const ConsultaSchema = z.object({
  sintomas: z.array(z.string()),
  diagnostico: z.object({ hipotese: z.string(), cid: z.string() }),
  conduta: z.string(),
});

// Preenche o trecho que conhece e registra o que recebeu
class Preenche extends AgentCoreIA {
  recebido: { texto?: string; schema?: unknown; dados?: Dados } = {};

  constructor(role: string, private readonly patch: Dados) {
    super({ role, goal: "preencher", backstory: "teste" });
  }

  override async execute<T>(): Promise<T> {
    this.recebido = {
      texto: this.humanRequest ?? "",
      ...(this.estrutura !== undefined ? { schema: this.estrutura.schema, dados: this.estrutura.dados } : {}),
    };
    return { status: "approve", response: "ok", dados: this.patch } as T;
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
    subAgents: Object.keys(patches).map((role) => new RemoteAgent({ role, transport })),
    ...(llm !== undefined ? { llm } : {}),
  });
  return { sequencial, agentes };
}

describe("SequentialAgent com estrutura", () => {
  it("cada agent recebe o schema e o que já foi preenchido, e o JSON final é validado", async () => {
    const { sequencial, agentes } = await montar({
      triagem: { sintomas: ["febre", "tosse"] },
      medico: { diagnostico: { hipotese: "gripe" } },
      revisor: { diagnostico: { cid: "J11" }, conduta: "repouso" },
    });
    sequencial.setStructuredRequest("analise a consulta da Maria", ConsultaSchema);

    const resultado = await sequencial.execute<SequentialStructuredResult>();

    expect(resultado.status).toBe("approve");
    expect(resultado.dados).toEqual({
      sintomas: ["febre", "tosse"],
      diagnostico: { hipotese: "gripe", cid: "J11" },
      conduta: "repouso",
    });
    expect(JSON.parse(resultado.response)).toEqual(resultado.dados);

    const [triagem, medico, revisor] = agentes;
    expect(triagem?.recebido.dados).toEqual({});
    expect(medico?.recebido.dados).toEqual({ sintomas: ["febre", "tosse"] });
    expect(revisor?.recebido.dados).toEqual({
      sintomas: ["febre", "tosse"],
      diagnostico: { hipotese: "gripe" },
    });
    expect(revisor?.recebido.texto).toBe("analise a consulta da Maria");
    expect(revisor?.recebido.schema).toMatchObject({ type: "object", required: expect.arrayContaining(["conduta"]) });
  });

  it("devolve review com os campos que faltam", async () => {
    const { sequencial } = await montar({ triagem: { sintomas: ["febre"] } });
    sequencial.setStructuredRequest("x", ConsultaSchema);

    const resultado = await sequencial.execute<SequentialStructuredResult>();

    expect(resultado.status).toBe("review");
    expect(resultado.faltando).toEqual(expect.arrayContaining(["diagnostico", "conduta"]));
    expect(resultado.dados).toEqual({ sintomas: ["febre"] });
  });

  it("usa o Llm para escrever a resposta final a partir do JSON", async () => {
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
    sequencial.setStructuredRequest("analise a Maria", ConsultaSchema);

    const resultado = await sequencial.execute<SequentialStructuredResult>();

    expect(resultado.response).toBe("Maria está com gripe.");
    expect(prompts[0]).toContain('"hipotese":"gripe"');
  });

  it("sem estrutura mantém o encadeamento de texto", async () => {
    const { sequencial } = await montar({ a: {} });
    sequencial.setHumanRequest("x");
    sequencial.setStructuredRequest("y", ConsultaSchema);
    sequencial.setHumanRequest("z");

    expect(sequencial.estrutura).toBeUndefined();
  });
});

describe("mesclar", () => {
  it("funde objetos e substitui o resto", () => {
    expect(mesclar({ a: { x: 1 }, l: [1] }, { a: { y: 2 }, l: [2] })).toEqual({ a: { x: 1, y: 2 }, l: [2] });
  });
});
