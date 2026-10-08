import { AgentCoreIA, type AgentCoreIAOptions } from "./agent-core-ia.js";
import type { Llm } from "./llm.js";

export type OrchestratorAgentOptions = AgentCoreIAOptions & {
  subAgents: AgentCoreIA[];
  llm?: Llm;
};

export class OrchestratorAgent extends AgentCoreIA {
  readonly subAgents: readonly AgentCoreIA[];
  private readonly llm: Llm | undefined;

  constructor(options: OrchestratorAgentOptions) {
    super(options);
    this.subAgents = options.subAgents;
    this.llm = options.llm;
  }

  override async execute<T>(): Promise<T> {
    const [task] = this.tasks;
    if (this.llm === undefined || task === undefined) {
      return super.execute<T>();
    }

    const resposta = await this.llm.complete(this.montarPromptDeEscolha(task.description));
    const escolhido = this.subAgents.find((agent) => agent.role === resposta.trim());
    if (escolhido === undefined) {
      throw new Error(`O LLM escolheu um subagent inexistente: "${resposta}"`);
    }

    escolhido.setHumanRequest(task.description);
    return escolhido.execute<T>();
  }

  private montarPromptDeEscolha(descricaoDaTarefa: string): string {
    const roles = this.subAgents.map((agent) => agent.role).filter((role) => role !== undefined);
    return [
      this.systemPrompt,
      `Tarefa: ${descricaoDaTarefa}`,
      `Subagents disponíveis: ${roles.join(", ")}`,
      "Responda apenas com o nome do subagent mais adequado.",
    ].join("\n");
  }
}
