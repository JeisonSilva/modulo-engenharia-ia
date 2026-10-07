namespace AgentBase.Tests;

public class AgentCoreIATests
{
    [Fact]
    public void Deve_confirmar_o_entendimento_ao_receber_o_system_prompt()
    {
        const string systemPrompt =
            "Você é um agente especialista em engenharia de software. " +
            "Responda sempre de forma objetiva.";

        var agent = new AgentCoreIA(systemPrompt);

        var resposta = agent.Start();

        Assert.Equal("Eu entendi! Qual a sua solicitação?", resposta);
    }
}
