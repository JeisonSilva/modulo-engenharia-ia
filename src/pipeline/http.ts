import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { SequentialPipeline } from "./sequential-pipeline.js";

const ROTA = "/solicitacoes";
const LIMITE_DO_CORPO = 1_000_000;

function responder(resposta: ServerResponse, status: number, corpo: unknown): void {
  resposta.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  resposta.end(JSON.stringify(corpo));
}

async function lerTexto(requisicao: IncomingMessage): Promise<string | undefined> {
  let corpo = "";
  for await (const pedaco of requisicao) {
    corpo += pedaco;
    if (corpo.length > LIMITE_DO_CORPO) {
      return undefined;
    }
  }
  try {
    const texto = (JSON.parse(corpo) as { texto?: unknown } | null)?.texto;
    return typeof texto === "string" && texto.trim() !== "" ? texto : undefined;
  } catch {
    return undefined;
  }
}

// POST /solicitacoes { texto } -> 202 { id }; GET /solicitacoes/{id} -> a solicitação
export function criarServidorHttp(pipeline: SequentialPipeline): Server {
  return createServer((requisicao, resposta) => {
    void (async () => {
      const caminho = new URL(requisicao.url ?? "/", "http://localhost").pathname;

      if (requisicao.method === "POST" && caminho === ROTA) {
        const texto = await lerTexto(requisicao);
        if (texto === undefined) {
          responder(resposta, 400, { erro: 'Envie um JSON com o campo "texto"' });
          return;
        }
        const solicitacao = await pipeline.solicitar(texto);
        responder(resposta, 202, {
          id: solicitacao.id,
          status: solicitacao.status,
          consulta: `${ROTA}/${solicitacao.id}`,
        });
        return;
      }

      if (requisicao.method === "GET" && caminho.startsWith(`${ROTA}/`)) {
        const solicitacao = await pipeline.consultar(decodeURIComponent(caminho.slice(ROTA.length + 1)));
        if (solicitacao === undefined) {
          responder(resposta, 404, { erro: "Solicitação não encontrada" });
          return;
        }
        responder(resposta, 200, solicitacao);
        return;
      }

      responder(resposta, 404, { erro: "Rota não encontrada" });
    })().catch((erro: unknown) => {
      console.error("Falha ao atender a requisição:", erro);
      if (!resposta.headersSent) {
        responder(resposta, 500, { erro: "Erro interno" });
      }
    });
  });
}
