import type { Dados, JsonSchema } from "../core/estrutura.js";

export const TIPO_PEDIDO = "agent.pedido.v1";

export type ErroDeEtapa = {
  etapa: string;
  mensagem: string;
};

// Contrato único do pipeline: é tudo o que os containers compartilham entre si
export type PipelineMessage = {
  tipo: typeof TIPO_PEDIDO;
  id: string;
  // Entrada desta etapa: a response da etapa anterior (ou o pedido, na primeira)
  texto: string;
  pedidoOriginal: string;
  schema: JsonSchema;
  dados: Dados;
  // Presente quando uma etapa falhou; as etapas seguintes só repassam a mensagem
  erro?: ErroDeEtapa;
};

export function validarMensagem(valor: unknown): PipelineMessage {
  const tipo = (valor as { tipo?: unknown } | null)?.tipo;
  if (tipo !== TIPO_PEDIDO) {
    throw new Error(`Tipo de mensagem não suportado: "${String(tipo)}"`);
  }
  return valor as PipelineMessage;
}
