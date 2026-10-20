import type { ModelProvider } from "./model-providers";
export type PlannerProvider = ModelProvider;
export interface PlannerConfig { provider?: PlannerProvider; apiKey?: string; model: string }
interface ProviderEnvironment {
  PLANNER_PROVIDER?: string; GEMINI_API_KEY?: string; GEMINI_MODEL?: string;
  OPENAI_API_KEY?: string; OPENAI_MODEL?: string;
}

/** Server-owned selection: explicit choices never fall back to another provider. */
export function plannerConfig(env: ProviderEnvironment): PlannerConfig {
  const selected = env.PLANNER_PROVIDER || (env.GEMINI_API_KEY ? "gemini" : "openai");
  if (selected !== "gemini" && selected !== "openai") throw new Error("Unsupported planner provider configuration.");
  return selected === "gemini"
    ? { provider: selected, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || "gemini-3.5-flash-lite" }
    : { provider: selected, apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || "gpt-5-mini" };
}

export class PlannerProviderError extends Error {
  constructor(message: string) { super(message); this.name = "PlannerProviderError"; }
}
