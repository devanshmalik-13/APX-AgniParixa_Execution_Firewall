/** Public provider metadata. Credentials and user-supplied URLs never belong here. */
export const modelProviders = [
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-3.5-flash-lite", endpoint: "https://generativelanguage.googleapis.com/v1beta/models/", protocol: "gemini" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5-mini", endpoint: "https://api.openai.com/v1/responses", protocol: "responses" },
  { id: "groq", label: "Groq", defaultModel: "llama-3.3-70b-versatile", endpoint: "https://api.groq.com/openai/v1/chat/completions", protocol: "chat" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "", endpoint: "https://openrouter.ai/api/v1/chat/completions", protocol: "chat" },
] as const;
export type ModelProvider = typeof modelProviders[number]["id"];
export function modelProvider(id: string) { return modelProviders.find((item) => item.id === id); }
export function validModel(provider: ModelProvider, model: string) {
  return (provider === "gemini" || provider === "openai" ? /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/ : /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}$/).test(model);
}
