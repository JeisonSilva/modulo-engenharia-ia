import type { Dados } from "./estrutura.js";

export type AgentResponse = {
  status: string;
  response: string;
  // Só os campos que este agent preencheu, quando o pedido trouxe uma estrutura
  dados?: Dados;
};

export function extrairResponse(resultado: unknown): string | undefined {
  const response = (resultado as { response?: unknown } | null)?.response;
  return typeof response === "string" ? response : undefined;
}
