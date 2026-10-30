// Talks to one model. The OpenAI SDK gets handed in already pointed at Together, so tests can swap in a fake and
// another provider only means a different SDK client.
export class AiClient
  {
    constructor({ sdk, model })
      {
        this.sdk = sdk;
        this.model = model;
      }

    // Asks the model once and hands back its reply plus the tokens it used. No tools means a plain chat, so the tools
    // field is left off instead of sent empty, which some models refuse. The signal lets the run's deadline cut off a
    // reply that's still on its way.
    async complete(messages, tools = [], signal)
      {
        const response = await this.sdk.chat.completions.create({ model: this.model.id, messages, ...(tools.length && { tools }) }, { signal });
        const tokens = { input: response.usage?.prompt_tokens || 0, output: response.usage?.completion_tokens || 0 };
        return { message: response.choices[0].message, tokens };
      }
  }
