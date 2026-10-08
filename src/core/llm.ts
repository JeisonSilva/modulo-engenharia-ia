export type Llm = {
  complete(prompt: string): Promise<string>;
};
