import type { PipelineMessage } from "./message.js";

export type MessageHandler = (mensagem: PipelineMessage) => Promise<void>;

// Consome de uma fila, publica na exchange com uma routing key
export type MessageBroker = {
  publish(routingKey: string, mensagem: PipelineMessage): Promise<void>;
  // Uma mensagem por vez; devolve a função que para o consumo
  consume(fila: string, handler: MessageHandler): Promise<() => Promise<void>>;
  close(): Promise<void>;
};
