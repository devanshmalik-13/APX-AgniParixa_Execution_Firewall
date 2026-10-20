import { z } from "zod";
import { validModel } from "./model-providers";
import { modelConversation } from "./model-conversation";
import { PlannerProviderError, type PlannerConfig } from "./provider-config";

export const connectionCookie = "apx_model_connection";
export const connectionLifetime = 3600;
export const connectionSchema = z.object({
  provider: z.enum(["gemini", "openai", "groq", "openrouter"]),
  model: z.string().trim().min(1).max(150),
  apiKey: z.string().trim().min(10).max(512).regex(/^[\x21-\x7e]+$/),
}).strict().refine((value) => validModel(value.provider, value.model), { message: "Invalid model identifier.", path: ["model"] });
const sealedSchema = z.object({ owner: z.string(), expiresAt: z.number(), config: connectionSchema }).strict();
export type ConnectionInput = z.infer<typeof connectionSchema>;
export interface ConnectionStatus {
  source: "session" | "server" | "none"; connected: boolean; provider: string; model: string;
  expiresAt?: string; canConnect: boolean;
}

function base64(value: Uint8Array) { return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function unbase64(value: string) { return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0)); }
async function cipherKey(secret?: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new PlannerProviderError("Model connections need a server encryption secret. The configured demo model remains available.");
  return crypto.subtle.importKey("raw", Uint8Array.from(secret.match(/../g)!, (byte) => parseInt(byte, 16)), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypted, authenticated, owner-bound, one-hour cookie. No plaintext credential persistence. */
export async function sealConnection(input: ConnectionInput, owner: string, secret?: string, now = Date.now()) {
  const config = connectionSchema.parse(input);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify({ owner, expiresAt: now + connectionLifetime * 1000, config }));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${connectionCookie}:${owner}`) }, await cipherKey(secret), body);
  return `v1.${base64(iv)}.${base64(new Uint8Array(encrypted))}`;
}

export async function openConnection(value: string, owner: string, secret?: string, now = Date.now()) {
  try {
    if (value.length > 2200 || !/^v1\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value)) throw new Error("invalid");
    const [, nonce, payload] = value.split(".");
    const iv = unbase64(nonce);
    if (iv.length !== 12) throw new Error("invalid");
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${connectionCookie}:${owner}`) }, await cipherKey(secret), unbase64(payload));
    const record = sealedSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decrypted)));
    if (record.owner !== owner || record.expiresAt <= now || record.expiresAt > now + connectionLifetime * 1000) throw new Error("expired");
    return record;
  } catch { throw new PlannerProviderError("Your model connection expired or could not be verified. Disconnect it or connect again. No model request was sent."); }
}

export function connectionFromRequest(request: Request) {
  return request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${connectionCookie}=`))?.slice(connectionCookie.length + 1);
}

/** A capability probe uses synthetic data, never customer data, and executes no tool. */
export async function verifyConnection(config: ConnectionInput, fetcher: typeof fetch = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const conversation = modelConversation(config, "This is a synthetic APX connection check. Call apx_connection_check with ready=true. Do not return text or use any other tool.", "Confirm support for function calling.", [
      { type: "function", name: "apx_connection_check", description: "A synthetic connection probe. No actions or customer data.", parameters: { type: "object", properties: { ready: { type: "boolean" } }, required: ["ready"], additionalProperties: false } } as Parameters<typeof modelConversation>[3][number],
    ]);
    const result = await conversation.next(fetcher, controller.signal);
    if (result.calls.length !== 1 || result.calls[0].name !== "apx_connection_check" || !z.object({ ready: z.literal(true) }).strict().safeParse(JSON.parse(result.calls[0].arguments)).success) {
      throw new PlannerProviderError("This model did not return the required tool call. Choose a model with function-calling support.");
    }
  } catch (error) {
    if (error instanceof PlannerProviderError) throw error;
    throw new PlannerProviderError("Connection check failed or timed out. No tool executed. Check the provider, model, and key.");
  } finally { clearTimeout(timer); }
}

export function connectionStatus(config: PlannerConfig, secret?: string, expiresAt?: number): ConnectionStatus {
  return { source: expiresAt ? "session" : config.apiKey ? "server" : "none", connected: Boolean(config.apiKey), provider: config.provider ?? "openai", model: config.model,
    ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}), canConnect: !!secret && /^[a-f0-9]{64}$/i.test(secret) };
}
