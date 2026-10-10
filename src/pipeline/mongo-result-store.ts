import { MongoClient, type Collection } from "mongodb";
import type { ResultStore, Solicitacao } from "./result-store.js";

export type MongoResultStoreOptions = {
  database?: string;
  collection?: string;
};

type Documento = Omit<Solicitacao, "id"> & { _id: string };

// Um documento por solicitação; o id da solicitação é o _id
export class MongoResultStore implements ResultStore {
  private constructor(
    private readonly cliente: MongoClient,
    private readonly colecao: Collection<Documento>,
  ) {}

  static async connect(url: string, options: MongoResultStoreOptions = {}): Promise<MongoResultStore> {
    const cliente = await MongoClient.connect(url);
    const colecao = cliente
      .db(options.database ?? "agents")
      .collection<Documento>(options.collection ?? "solicitacoes");
    return new MongoResultStore(cliente, colecao);
  }

  async salvar(solicitacao: Solicitacao): Promise<void> {
    const { id, ...resto } = solicitacao;
    await this.colecao.replaceOne({ _id: id }, resto, { upsert: true });
  }

  async buscar(id: string): Promise<Solicitacao | undefined> {
    const documento = await this.colecao.findOne({ _id: id });
    if (documento === null) {
      return undefined;
    }
    const { _id, ...resto } = documento;
    return { id: _id, ...resto };
  }

  async close(): Promise<void> {
    await this.cliente.close();
  }
}
