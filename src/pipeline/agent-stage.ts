import type { AgentCoreIA } from "../core/agent-core-ia.js";
import { mesclar } from "../core/estrutura.js";
import { extrairResponse, type AgentResponse } from "../core/response.js";
import type { MessageBroker } from "./broker.js";
import type { PipelineMessage } from "./message.js";

export type AgentStageConfig = {
  // Fila que o agent consome
  filaEntrada: string;
  // Routing key da próxima etapa
  keySaida: string;
  // Routing key da fila de erro; só é usada quando `filaErroHabilitada` é true
  keyErro?: string;
  filaErroHabilitada?: boolean;
};

// Liga o agent ao pipeline: consome a fila de entrada, processa e publica na exchange
export async function ligarAgent(
  agent: AgentCoreIA,
  broker: MessageBroker,
  config: AgentStageConfig,
): Promise<() => Promise<void>> {
  const desviaErro = config.filaErroHabilitada === true;
  if (desviaErro && config.keyErro === undefined) {
    throw new Error("A fila de erro está habilitada, mas a routing key de erro não foi configurada");
  }
  const etapa = agent.role ?? config.filaEntrada;

  return broker.consume(config.filaEntrada, async (mensagem) => {
    // Uma etapa anterior falhou e não desviou o erro: só repassa até o consolidador
    if (mensagem.erro !== undefined) {
      await broker.publish(config.keySaida, mensagem);
      return;
    }

    let saida: PipelineMessage;
    try {
      agent.setHumanRequest(mensagem.texto, {
        schema: mensagem.schema,
        dados: mensagem.dados,
        pedidoOriginal: mensagem.pedidoOriginal,
      });
      const resultado = await agent.execute<AgentResponse>();
      saida = {
        ...mensagem,
        texto: extrairResponse(resultado) ?? mensagem.texto,
        dados: mesclar(mensagem.dados, resultado.dados),
      };
    } catch (erro) {
      const comErro: PipelineMessage = {
        ...mensagem,
        erro: { etapa, mensagem: erro instanceof Error ? erro.message : String(erro) },
      };
      // Com fila de erro o processamento termina aqui; sem ela o erro segue com os dados parciais
      await broker.publish(desviaErro ? (config.keyErro as string) : config.keySaida, comErro);
      return;
    }
    await broker.publish(config.keySaida, saida);
  });
}
