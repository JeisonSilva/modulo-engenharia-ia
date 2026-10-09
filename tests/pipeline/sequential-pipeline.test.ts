import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentCoreIA,
  InMemoryBroker,
  InMemoryResultStore,
  SequentialPipeline,
  criarServidorHttp,
  ligarAgent,
  medirQualidade,
  type AgentStageConfig,
  type Dados,
  type Llm,
} from "../../src/index.js";

const ConsultaSchema = z.object({
  sintomas: z.array(z.string()),
  diagnostico: z.string(),
  conduta: z.string(),
});

// Preenche o seu trecho e responde "resposta de <role>"; falha se o pedido original citar "erro:<role>"
class Etapa extends AgentCoreIA {
  readonly textos: string[] = [];

  constructor(role: string, private readonly patch: Dados) {
    super({ role, goal: "preencher", backstory: "teste" });
  }

  override async execute<T>(): Promise<T> {
    this.textos.push(this.humanRequest ?? "");
    if (this.estrutura?.pedidoOriginal.includes(`erro:${this.role}`)) {
      throw new Error("indisponível");
    }
    return { status: "approve", response: `resposta de ${this.role}`, dados: this.patch } as T;
  }
}

type Desvio = Pick<AgentStageConfig, "filaErroHabilitada">;

async function montar(desvio: { triagem?: Desvio; medico?: Desvio; revisor?: Desvio } = {}, llm?: Llm) {
  const broker = new InMemoryBroker();
  const store = new InMemoryResultStore();
  const triagem = new Etapa("triagem", { sintomas: ["febre"] });
  const medico = new Etapa("medico", { diagnostico: "gripe" });
  const revisor = new Etapa("revisor", { conduta: "repouso" });

  const ligar = (agent: Etapa, filaEntrada: string, keySaida: string, config: Desvio = {}) =>
    ligarAgent(agent, broker, { filaEntrada, keySaida, keyErro: "consulta.erro", ...config });
  await ligar(triagem, "triagem", "medico", desvio.triagem);
  await ligar(medico, "medico", "revisor", desvio.medico);
  await ligar(revisor, "revisor", "consulta.resultado", desvio.revisor);

  const pipeline = new SequentialPipeline({
    broker,
    store,
    schema: ConsultaSchema,
    keySaida: "triagem",
    filaResultado: "consulta.resultado",
    filaErro: "consulta.erro",
    ...(llm !== undefined ? { llm } : {}),
  });
  await pipeline.iniciar();
  return { broker, pipeline, triagem, medico, revisor };
}

describe("SequentialPipeline", () => {
  it("publica só na primeira etapa e cada agent repassa para a próxima", async () => {
    const { broker, pipeline, triagem, medico, revisor } = await montar();

    const { id, status } = await pipeline.solicitar("analise a Maria");
    expect(status).toBe("processing");
    await broker.ocioso();

    const final = await pipeline.consultar(id);
    expect(final).toMatchObject({
      status: "approve",
      pedido: "analise a Maria",
      qualidade: 1,
      dados: { sintomas: ["febre"], diagnostico: "gripe", conduta: "repouso" },
    });
    expect(final?.observacoes).toBeUndefined();
    expect(final?.concluidoEm).toBeDefined();
    expect(triagem.textos).toEqual(["analise a Maria"]);
    expect(medico.textos).toEqual(["resposta de triagem"]);
    expect(revisor.textos).toEqual(["resposta de medico"]);
  });

  it("com fila de erro habilitada o erro vai para ela e a próxima etapa não roda", async () => {
    const { broker, pipeline, revisor } = await montar({ medico: { filaErroHabilitada: true } });

    const { id } = await pipeline.solicitar("analise erro:medico");
    await broker.ocioso();

    const final = await pipeline.consultar(id);
    expect(final).toMatchObject({
      status: "error",
      dados: { sintomas: ["febre"] },
      qualidade: 0.33,
      erro: { etapa: "medico", mensagem: "indisponível" },
      faltando: ["diagnostico", "conduta"],
    });
    expect(final?.observacoes).toContain('A etapa "medico" falhou');
    expect(revisor.textos).toEqual([]);
  });

  it("sem fila de erro o erro segue pela saída e as etapas seguintes só repassam", async () => {
    const { broker, pipeline, revisor } = await montar();

    const { id } = await pipeline.solicitar("analise erro:medico");
    await broker.ocioso();

    const final = await pipeline.consultar(id);
    expect(final).toMatchObject({
      status: "review",
      dados: { sintomas: ["febre"] },
      qualidade: 0.33,
      erro: { etapa: "medico" },
    });
    expect(revisor.textos).toEqual([]);
    expect(broker.pendentes("consulta.erro")).toBe(0);
  });

  it("recusa habilitar a fila de erro sem a routing key", async () => {
    const agent = new Etapa("x", {});
    await expect(
      ligarAgent(agent, new InMemoryBroker(), { filaEntrada: "x", keySaida: "y", filaErroHabilitada: true }),
    ).rejects.toThrow("routing key de erro");
  });

  it("usa o Llm para redigir a response e as observações", async () => {
    const prompts: string[] = [];
    const llm: Llm = {
      complete: async (prompt) => {
        prompts.push(prompt);
        return prompt.includes("observações") ? "Faltou o diagnóstico." : "Maria tem febre.";
      },
    };
    const { broker, pipeline } = await montar({ medico: { filaErroHabilitada: true } }, llm);

    const { id } = await pipeline.solicitar("analise erro:medico");
    await broker.ocioso();

    const final = await pipeline.consultar(id);
    expect(final?.response).toBe("Maria tem febre.");
    expect(final?.observacoes).toBe("Faltou o diagnóstico.");
    expect(prompts.join("\n")).toContain('A etapa "medico" falhou');
  });
});

describe("medirQualidade", () => {
  it("é a fração dos campos obrigatórios válidos", () => {
    expect(medirQualidade(ConsultaSchema, {}).qualidade).toBe(0);
    expect(medirQualidade(ConsultaSchema, { sintomas: [], diagnostico: "x" })).toMatchObject({
      qualidade: 0.67,
      faltando: ["conduta"],
    });
    expect(medirQualidade(ConsultaSchema, { sintomas: "errado", diagnostico: "x", conduta: "y" }).qualidade).toBe(0.67);
    expect(medirQualidade(ConsultaSchema, { sintomas: [], diagnostico: "x", conduta: "y" }).qualidade).toBe(1);
  });
});

describe("API HTTP do sequencial", () => {
  const servidores: ReturnType<typeof criarServidorHttp>[] = [];
  afterEach(() => {
    for (const servidor of servidores.splice(0)) {
      servidor.close();
    }
  });

  async function subir() {
    const { broker, pipeline } = await montar();
    const servidor = criarServidorHttp(pipeline).listen(0);
    servidores.push(servidor);
    const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    return { broker, base };
  }

  it("POST devolve 202 com o id e GET devolve o resultado depois", async () => {
    const { broker, base } = await subir();

    const post = await fetch(`${base}/solicitacoes`, {
      method: "POST",
      body: JSON.stringify({ texto: "analise a Maria" }),
    });
    const aceito = (await post.json()) as { id: string; status: string; consulta: string };
    expect(post.status).toBe(202);
    expect(aceito.status).toBe("processing");

    await broker.ocioso();
    const get = await fetch(`${base}${aceito.consulta}`);
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ id: aceito.id, status: "approve", qualidade: 1 });
  });

  it("recusa corpo inválido e id desconhecido", async () => {
    const { base } = await subir();

    expect((await fetch(`${base}/solicitacoes`, { method: "POST", body: "{}" })).status).toBe(400);
    expect((await fetch(`${base}/solicitacoes`, { method: "POST", body: "não é json" })).status).toBe(400);
    expect((await fetch(`${base}/solicitacoes/nao-existe`)).status).toBe(404);
  });
});
