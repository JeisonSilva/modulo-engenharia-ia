import type { AgentRequest } from "./estrutura.js";
import type { AgentResponse } from "./response.js";

// Atende um pedido: recebe o texto e devolve a resposta do agent
export type RequestHandler = (pedido: AgentRequest) => Promise<AgentResponse>;

export type AgentTransport = {
  // Envia o pedido ao agent da `role` e espera a resposta
  request(role: string, pedido: AgentRequest): Promise<AgentResponse>;
  // Passa a atender os pedidos da `role`, uma mensagem por vez; devolve a função que para o consumo
  serve(role: string, handler: RequestHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
};
