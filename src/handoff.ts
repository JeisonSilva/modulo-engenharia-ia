import type { AgentResponse } from "./response.js";

export type HandoffResultado = {
  resposta: AgentResponse;
  caminho: string[];
};

// Procura o destino a partir de um nó da árvore; `caminho` acumula os orquestradores percorridos
export type HandoffResolver = (
  para: string,
  pedido: string,
  caminho: string[],
) => Promise<HandoffResultado>;

export type ExecutionContext = {
  handoff(para: string, pedido: string): Promise<AgentResponse>;
  // Preenchido pelos orquestradores: é o que permite ao pedido subir a árvore
  readonly resolver?: HandoffResolver;
};

export type HandoffRegistro = {
  de: string;
  para: string;
  caminho: string[];
};

export function acrescentar(caminho: string[], role: string | undefined): string[] {
  return role === undefined ? caminho : [...caminho, role];
}

export function destinoInexistente(para: string): Error {
  return new Error(`Handoff sem destino: "${para}" não existe na árvore`);
}

export function criarContexto(
  resolver: HandoffResolver,
  aoConcluir?: (para: string, resultado: HandoffResultado) => void,
): ExecutionContext {
  return {
    resolver,
    handoff: async (para, pedido) => {
      const resultado = await resolver(para, pedido, []);
      aoConcluir?.(para, resultado);
      return resultado.resposta;
    },
  };
}

// Contexto do especialista que atende um handoff: ele não pode pedir outro handoff
export function contextoSemHandoff(): ExecutionContext {
  return {
    handoff: async () => {
      throw new Error(
        "Handoff encadeado não é suportado: o especialista que atende um handoff não pode pedir outro",
      );
    },
  };
}
