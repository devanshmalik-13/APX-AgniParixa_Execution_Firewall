import { z } from "zod";
import { redactAuditText } from "../security/audit-redaction";
import type { ObserverConfigView, ObserverEvidence, ObserverInputText, ObserverModelKey } from "./types";

export const OBSERVER_MODELS = [
  { key: "prompt-guard-22m", label: "Prompt Guard 2 · 22M", id: "meta-llama/Llama-Prompt-Guard-2-22M", revision: "11614a155199674a0a95e6602d6ab0417b790ed0" },
  { key: "prompt-guard-86m", label: "Prompt Guard 2 · 86M", id: "meta-llama/Llama-Prompt-Guard-2-86M", revision: "a8ded8e697ce7c355e395a0df51f94adb4a2fd27" },
  { key: "piguard", label: "PIGuard", id: "leolee99/PIGuard", revision: "dd78b24e330193a22d2293ac66922dd4f982f563" },
] as const;
const modelKeySchema = z.enum(["prompt-guard-22m", "prompt-guard-86m", "piguard"]);
export const observerRequestSchema = z.object({
  modelKey: modelKeySchema.optional(),
  texts: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), source: z.enum(["customer_context", "proposed_reply"]), text: z.string().min(1).max(6000) }).strict()).min(1).max(8),
}).strict().superRefine((input, context) => {
  if (input.texts.reduce((total, item) => total + item.text.length, 0) > 12000) context.addIssue({ code: z.ZodIssueCode.custom, path: ["texts"], message: "Combined observer text exceeds 12000 characters." });
  if (new Set(input.texts.map((item) => item.id)).size !== input.texts.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["texts"], message: "Observer text identifiers must be unique." });
});
export type ObserverRequest = z.infer<typeof observerRequestSchema>;
const modelSchema = z.object({ key: modelKeySchema, id: z.string().max(120), revision: z.string().regex(/^[a-f0-9]{40}$/), device: z.string().regex(/^(cpu|mps|cuda(?::\d{1,2})?)$/), precision: z.enum(["float32", "bfloat16"]).optional() }).strict().refine((model) => OBSERVER_MODELS.some((entry) => entry.key === model.key && entry.id === model.id && entry.revision === model.revision), "Unrecognized observer model revision.");
const score = z.number().finite().min(0).max(1);
const healthSchema = z.object({ schemaVersion: z.literal(1), status: z.literal("ready"), model: modelSchema, windowTokens: z.literal(512), overlapTokens: z.literal(64), threshold: score }).strict();
const serviceEvidenceSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal("shadow"), status: z.literal("observed"), verdict: z.enum(["benign", "suspicious", "unknown"]), model: modelSchema,
  threshold: score, maxScore: score.nullable(),
  segments: z.array(z.object({ textId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), startToken: z.number().int().min(0), endToken: z.number().int().positive(), score, label: z.enum(["benign", "suspicious"]) }).strict()).max(32),
  coverage: z.object({ complete: z.boolean(), windowTokens: z.literal(512), overlapTokens: z.literal(64), totalTokens: z.number().int().min(0).max(100000), segments: z.number().int().min(0).max(32) }).strict(),
  latencyMs: z.number().finite().min(0).max(300000), reason: z.string().max(500),
}).strict();

export interface ObserverServerConfig {
  url?: string;
  token?: string;
  modelKey?: string;
  /** Explicit local development only. Never enable on a hosted deployment. */
  allowLocal?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export interface ObserverClient {
  getConfig(): Promise<ObserverConfigView>;
  observe(input: ObserverRequest): Promise<ObserverEvidence>;
}
const limitations = [
  "Shadow findings never change grants, policy decisions, mandatory approval, or execution.",
  "Recognizable credentials and email addresses are redacted before service submission; arbitrary confidential text may remain.",
  "512-token windows use 64-token overlap. An incomplete scan is unknown.",
  "Scores are classifier outputs, not calibrated probabilities or proof of safety. Latency and accuracy require evaluation.",
];
export function unavailableObserverEvidence(): ObserverEvidence { return baseEvidence("unavailable"); }
function baseEvidence(status: "not_configured" | "unavailable", latencyMs = 0): ObserverEvidence {
  return { schemaVersion: 1, mode: "shadow", status, verdict: "unknown", model: null, threshold: 0.9, maxScore: null, segments: [], coverage: { complete: false, windowTokens: 512, overlapTokens: 64, totalTokens: 0, segments: 0 }, latencyMs, reason: status === "not_configured" ? "Connect an authenticated observer service to collect model evidence." : "Observer evidence is unavailable or incomplete. Deterministic permissions remain in effect." };
}
/** Send only redacted prose. Never send the grant, owner, customer address, or raw action envelope. */
export function redactObserverText(text: string): string {
  return redactAuditText(text).replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}
function safeServiceUrl(config: ObserverServerConfig): URL {
  const url = new URL(config.url!);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(config.allowLocal && local && url.protocol === "http:")) || (local && !config.allowLocal)) throw new Error("Invalid observer endpoint.");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json") || !response.body) throw new Error("Invalid observer response.");
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 65536)) throw new Error("Oversized observer response.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new Error("Oversized observer response."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } finally { reader.releaseLock(); }
}

export function createObserverClient(config: ObserverServerConfig = {}): ObserverClient {
  const configured = Boolean(config.url && config.token);
  const key = modelKeySchema.safeParse(config.modelKey ?? "piguard");
  const request = async (path: string, payload?: unknown): Promise<unknown> => {
    const endpoint = safeServiceUrl(config);
    if (!key.success || !config.token || /[\r\n]/.test(config.token)) throw new Error("Invalid observer configuration.");
    const controller = new AbortController();
    const timeout = Math.max(500, Math.min(config.timeoutMs ?? 6000, 15000));
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await (config.fetch ?? fetch)(new URL(path, endpoint), { method: payload ? "POST" : "GET", headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}), redirect: "manual", signal: controller.signal });
      return await boundedJson(response);
    } finally { clearTimeout(timer); }
  };
  return {
    async getConfig() {
      let ready = false;
      if (configured && key.success) {
        try { const health = healthSchema.parse(await request("health")); ready = health.model.key === key.data; } catch { /* Never expose remote errors or configuration secrets. */ }
      }
      const serviceStatus = !configured ? "not_configured" : ready ? "ready" : "unavailable";
      return { mode: "shadow", configured, available: ready, activeModel: key.success && configured ? key.data : null, models: OBSERVER_MODELS.map((model) => ({ key: model.key, label: model.label, available: ready && key.success && model.key === key.data, status: !configured ? "not_configured" : !ready ? "unavailable" : model.key === key.data ? "ready" : "not_loaded" })), serviceStatus, limitations: [...limitations] };
    },
    async observe(input) {
      const started = performance.now();
      if (!configured) return baseEvidence("not_configured");
      try {
        const parsed = observerRequestSchema.parse(input);
        if (!key.success || (parsed.modelKey && parsed.modelKey !== key.data)) throw new Error("Model mismatch.");
        const texts = parsed.texts.map((item) => ({ ...item, text: redactObserverText(item.text) }));
        const result = serviceEvidenceSchema.parse(await request("v1/observe", { modelKey: key.data, texts }));
        const textIds = new Set(texts.map((text) => text.id));
        if (result.model.key !== key.data || result.coverage.segments !== result.segments.length || !result.segments.length || result.segments.some((segment) => !textIds.has(segment.textId) || segment.endToken <= segment.startToken || segment.endToken - segment.startToken > 512 || segment.label !== (segment.score >= result.threshold ? "suspicious" : "benign"))) throw new Error("Inconsistent observer evidence.");
        const maxScore = Math.max(...result.segments.map((segment) => segment.score));
        if (result.maxScore === null || Math.abs(result.maxScore - maxScore) > 1e-8 || (result.coverage.complete && texts.some((text) => !result.segments.some((segment) => segment.textId === text.id)))) throw new Error("Incomplete observer coverage.");
        let coveredTokens = 0;
        for (const text of texts) {
          const windows = result.segments.filter((segment) => segment.textId === text.id).sort((a, b) => a.startToken - b.startToken);
          if (windows.length && windows[0].startToken !== 0) throw new Error("Missing initial observer window.");
          for (let index = 1; index < windows.length; index += 1) {
            if (windows[index].startToken !== windows[index - 1].endToken - 64 || windows[index].endToken <= windows[index - 1].endToken) throw new Error("Invalid observer window overlap.");
          }
          coveredTokens += windows.at(-1)?.endToken ?? 0;
        }
        if (coveredTokens > result.coverage.totalTokens || (result.coverage.complete && coveredTokens !== result.coverage.totalTokens)) throw new Error("Inconsistent observer token coverage.");
        const verdict = !result.coverage.complete ? "unknown" : maxScore >= result.threshold ? "suspicious" : "benign";
        if (result.verdict !== verdict) throw new Error("Inconsistent observer verdict.");
        // Remote explanation text is not trusted. Persist an application-owned explanation only.
        return { ...result, verdict, latencyMs: Math.max(0, Math.round(performance.now() - started)), reason: verdict === "unknown" ? "The model scan did not cover every input. Treat its result as unknown." : verdict === "suspicious" ? "At least one scanned segment crossed the classifier threshold. Shadow evidence only; permissions remain unchanged." : "No scanned segment crossed the classifier threshold. This is not permission to execute." };
      } catch { return baseEvidence("unavailable", Math.max(0, Math.round(performance.now() - started))); }
    },
  };
}
