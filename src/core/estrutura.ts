export type JsonSchema = Record<string, unknown>;
export type Dados = Record<string, unknown>;

// A tipagem que o solicitante quer ver preenchida e o que as etapas anteriores já preencheram
export type Estrutura = {
  schema: JsonSchema;
  dados: Dados;
};

// O que viaja na fila até o agent
export type AgentRequest = {
  texto: string;
  estrutura?: Estrutura;
};

function ehObjeto(valor: unknown): valor is Dados {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

// Objetos se fundem campo a campo; qualquer outro valor (incluindo arrays) é substituído pelo mais novo
export function mesclar(base: Dados, patch: Dados | undefined): Dados {
  const resultado: Dados = { ...base };
  for (const [chave, valor] of Object.entries(patch ?? {})) {
    const atual = resultado[chave];
    resultado[chave] = ehObjeto(atual) && ehObjeto(valor) ? mesclar(atual, valor) : valor;
  }
  return resultado;
}
