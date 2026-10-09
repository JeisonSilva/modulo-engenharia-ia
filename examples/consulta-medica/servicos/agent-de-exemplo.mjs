import { AgentCoreIA } from "agent-base";

// Agent sem LLM: devolve uma resposta fixa e preenche o seu trecho da estrutura.
// Para simular uma falha, inclua "erro:<role>" no texto da solicitação (ex.: "erro:medico").
export class AgentDeExemplo extends AgentCoreIA {
  constructor({ response, dados, ...persona }) {
    super(persona);
    this.response = response;
    this.dados = dados;
  }

  async execute() {
    if (this.estrutura?.pedidoOriginal.includes(`erro:${this.role}`)) {
      throw new Error(`falha simulada no agent "${this.role}"`);
    }
    console.log(`[${this.role}] recebeu: ${this.humanRequest}`);
    return { status: "approve", response: this.response, dados: this.dados };
  }
}
