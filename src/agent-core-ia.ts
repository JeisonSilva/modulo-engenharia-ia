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

  return [
    `Você é ${options.role}. ${options.backstory}`,
    `Seu objetivo pessoal é: ${options.goal}`,
  ].join("\n");
}

export class AgentCoreIA {
  readonly role: string | undefined;
  readonly systemPrompt: string;
  readonly tasks: readonly Task[];
  readonly guardrails: readonly Guardrail[];
  readonly tools: readonly Tool[];
  humanRequest: string | undefined;

  constructor(options: AgentCoreIAOptions) {
    this.role = "role" in options ? options.role : undefined;
    this.systemPrompt = montarSystemPrompt(options);
    this.tasks = options.tasks ?? [];
    this.guardrails = options.guardrails ?? [];
    this.tools = options.tools ?? [];
  }

  setHumanRequest(text: string): void {
    this.humanRequest = text;
  }

  async execute<T>(): Promise<T> {
    return { status: "approve", response: MENSAGEM_PRONTO } as T;
  }
}
