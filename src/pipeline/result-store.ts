import type { Dados } from "../core/estrutura.js";
import type { ErroDeEtapa } from "./message.js";

export type StatusDaSolicitacao = "processing" | "approve" | "review" | "error";

export type Solicitacao = {
  id: string;
  status: StatusDaSolicitacao;
  pedido: string;
  criadoEm: string;
  concluidoEm?: string;
  response?: string;
  dados?: Dados;
  // Fração dos campos obrigatórios do schema que chegaram válidos, de 0 a 1
  qualidade?: number;
  observacoes?: string;
  faltando?: string[];
  erro?: ErroDeEtapa;
};

export type ResultStore = {
  salvar(solicitacao: Solicitacao): Promise<void>;
  buscar(id: string): Promise<Solicitacao | undefined>;
  close(): Promise<void>;
};

export class InMemoryResultStore implements ResultStore {
  private readonly solicitacoes = new Map<string, Solicitacao>();

  async salvar(solicitacao: Solicitacao): Promise<void> {
    this.solicitacoes.set(solicitacao.id, structuredClone(solicitacao));
  }

  async buscar(id: string): Promise<Solicitacao | undefined> {
    const solicitacao = this.solicitacoes.get(id);
    return solicitacao === undefined ? undefined : structuredClone(solicitacao);
  }

  async close(): Promise<void> {}
}
