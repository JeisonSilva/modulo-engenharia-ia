import type { Estrutura } from "./estrutura.js";
import type { ExecutionContext } from "../handoff/handoff.js";
import type { AgentResponse } from "./response.js";
import { systemPromptSchema } from "./system-prompt.js";
import type { AgentTransport } from "./transport.js";

export type Task = {
  description: string;
  expectedOutput: string;
};

export type GuardrailResult = {
  valid: boolean;
  message?: string;
};

export type Guardrail = (output: string) => GuardrailResult;

export type Tool = {
  name: string;
  description: string;
  run(input: string): Promise<string>;
};

type AgentCoreIAOptionsBase = {
  tasks?: Task[];
  guardrails?: Guardrail[];
  tools?: Tool[];
};

export type AgentCoreIAOptionsComSystemPrompt = AgentCoreIAOptionsBase & {
  systemPrompt: string;
};

export type AgentCoreIAOptionsComPersona = AgentCoreIAOptionsBase & {
  role: string;
  goal: string;
  backstory: string;
};

export type AgentCoreIAOptions =
  | AgentCoreIAOptionsComSystemPrompt
  | AgentCoreIAOptionsComPersona;

const MENSAGEM_PRONTO = "estou pronto para receber sua solicitação";

function montarSystemPrompt(options: AgentCoreIAOptions): string {
  if ("systemPrompt" in options) {
    return options.systemPrompt;
  }

  const prompt = systemPromptSchema.parse({
    papel: options.role,
    objetivo: options.goal,
    contexto: options.backstory,
  });
  return JSON.stringify(prompt, null, 2);
}

export class AgentCoreIA {
  readonly role: string | undefined;
  readonly systemPrompt: string;
  readonly tasks: readonly Task[];
  readonly guardrails: readonly Guardrail[];
  readonly tools: readonly Tool[];
  humanRequest: string | undefined;
  estrutura: Estrutura | undefined;

  constructor(options: AgentCoreIAOptions) {
    this.role = "role" in options ? options.role : undefined;
    this.systemPrompt = montarSystemPrompt(options);
    this.tasks = options.tasks ?? [];
    this.guardrails = options.guardrails ?? [];
    this.tools = options.tools ?? [];
  }

  // A estrutura vale só para este pedido: sem ela, a anterior é descartada
  setHumanRequest(text: string, estrutura?: Estrutura): void {
    this.humanRequest = text;
    this.estrutura = estrutura;
  }

  // Passa a consumir a fila da role, uma mensagem por vez; o handoff entre árvores segue em memória
  async listen(transport: AgentTransport): Promise<() => Promise<void>> {
    const role = this.role;
    if (role === undefined) {
      throw new Error("Só um agent com role pode escutar uma fila");
    }
    return transport.serve(role, async (pedido) => {
      this.setHumanRequest(pedido.texto, pedido.estrutura);
      return this.execute<AgentResponse>();
    });
  }

  async execute<T>(_contexto?: ExecutionContext): Promise<T> {
    return { status: "approve", response: MENSAGEM_PRONTO } as T;
  }
}
