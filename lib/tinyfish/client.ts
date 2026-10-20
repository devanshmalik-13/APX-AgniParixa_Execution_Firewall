import { redactAuditText } from "../security/audit-redaction";
import { sourceMatches, webSource, type WebEvidence } from "./types";
import { z } from "zod";

export class TinyFishError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "TinyFishError"; }
}
export async function contentHash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
const responseSchema = z.object({ results: z.array(z.object({ url: z.string(), final_url: z.string().nullish(), title: z.string().nullish(), text: z.string().min(1), format: z.literal("markdown") })).max(1), errors: z.array(z.unknown()) });

/** Public, catalogued URLs only. No customer data or model keys are sent to TinyFish. */
export async function fetchWebEvidence(sourceId: string, apiKey: string | undefined, fetcher: typeof fetch = fetch, now = Date.now(), otherSecrets: string[] = []): Promise<WebEvidence> {
  const source = webSource(sourceId);
  if (!source) throw new TinyFishError(400, "Choose a reference from the supported source catalogue.");
  if (!apiKey || !/^[\x21-\x7e]{10,512}$/.test(apiKey)) throw new TinyFishError(503, "Enter a TinyFish API key, or configure TINYFISH_API_KEY on the server.");
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 35000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetcher("https://api.fetch.tinyfish.ai", { method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "content-type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ urls: [source.url], format: "markdown", ttl: 0, per_url_timeout_ms: 25000,
        purpose: "Read public refund or credit-note reference material for a synthetic support reply. Extract reference content only; do not submit forms or change any account." }) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new TinyFishError(response.status === 401 || response.status === 403 ? 401 : 502,
        response.status === 401 || response.status === 403 ? "TinyFish rejected the API key. Check the key in your TinyFish dashboard." : response.status === 402 || response.status === 429 ? "TinyFish quota or rate limit reached. Check your TinyFish allowance before retrying." : "TinyFish could not fetch the reference. No reference was attached.");
    }
    if (!response.body) throw new Error("empty response");
    reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 512000) throw new TinyFishError(502, "TinyFish returned an oversized document. No reference was attached.");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = responseSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (body.errors.length || body.results.length !== 1) throw new TinyFishError(502, "TinyFish reported a page-level fetch failure. No reference was attached.");
    const page = body.results[0], finalUrl = page.final_url || page.url;
    if (!sourceMatches(sourceId, page.url) || !sourceMatches(sourceId, finalUrl)) throw new TinyFishError(502, "The reference redirected outside its approved source. No reference was attached.");
    const safe = redactAuditText(page.text, [apiKey, ...otherSecrets]).trim();
    if (!safe) throw new Error("empty text");
    const text = safe.slice(0, 8000);
    return { id: crypto.randomUUID(), provider: "tinyfish", api: "fetch", trust: "untrusted_web", sourceId: source.id,
      url: source.url, finalUrl: source.url, title: redactAuditText(page.title || source.title, [apiKey, ...otherSecrets]).slice(0, 180), text,
      fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 15 * 60000).toISOString(), sha256: await contentHash(text), truncated: safe.length > text.length };
  } catch (error) {
    if (error instanceof TinyFishError) throw error;
    throw new TinyFishError(502, controller.signal.aborted ? "TinyFish timed out. No reference was attached." : "TinyFish returned an invalid response or could not be reached. No reference was attached.");
  } finally { clearTimeout(timeout); try { await reader?.cancel(); } catch { /* Discard diagnostics. */ } }
}
