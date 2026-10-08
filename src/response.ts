export type AgentResponse = {
  status: string;
  response: string;
};

export function extrairResponse(resultado: unknown): string | undefined {
  const response = (resultado as { response?: unknown } | null)?.response;
  return typeof response === "string" ? response : undefined;
}
