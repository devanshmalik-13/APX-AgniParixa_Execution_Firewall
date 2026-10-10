import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupportStore, SupportStoreError } from "@/lib/support/store";

export const planRequestSchema = z.object({
  ticketId: z.string().min(1).max(100), mode: z.enum(["replay", "live"]),
  scenario: z.enum(["normal", "injection", "over-refund", "cross-tenant", "duplicate-refund"]),
  profile: z.enum(["standard", "strict"]), note: z.string().max(2000).optional(),
}).strict();
export const operationSchema = z.object({
  operation: z.enum(["execute", "reject", "recover"]), receiptHash: z.string().regex(/^[a-f0-9]{64}$/),
  approve: z.boolean(),
}).strict();

export function supportContext(request: Request, mutation = false) {
  const owner = request.headers.get("oai-authenticated-user-id");
  if (!owner || owner.length > 200 || /[\u0000-\u001f\u007f]/.test(owner)) throw new SupportStoreError(401, "An authenticated visitor is required.");
  if (mutation) {
    const origin = request.headers.get("origin");
    const expectedOrigin = new URL(request.url).origin;
    if (!origin || origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") throw new SupportStoreError(403, "Support mutations require a request from this site's origin.");
  }
  if (!env.DB) throw new SupportStoreError(503, "The support database is unavailable.");
  return { owner, store: createSupportStore(env.DB, { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || "gpt-5-mini" }) };
}

/** Bound the stream itself, including chunked requests without Content-Length. */
export async function readSupportBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new SupportStoreError(400, "Request body must use application/json.");
  const maxBytes = 12_000;
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new SupportStoreError(400, "Request body exceeds the 12 KB limit.");
  if (!request.body) throw new SupportStoreError(400, "Request body must be valid JSON.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new SupportStoreError(400, "Request body exceeds the 12 KB limit."); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof SupportStoreError) throw error;
    throw new SupportStoreError(400, "Request body must be valid UTF-8 JSON.");
  } finally { reader.releaseLock(); }
}
export function supportResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store, private", Vary: "oai-authenticated-user-id" } });
}
export function supportError(error: unknown) {
  if (error instanceof z.ZodError) return supportResponse({ error: "Invalid support request. Only documented fields are accepted.", issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, 400);
  if (error instanceof SupportStoreError) return supportResponse({ error: error.message }, error.status);
  // Provider bodies, database diagnostics and credentials never reach clients.
  return supportResponse({ error: "The support workflow is temporarily unavailable. Verify the database schema and server configuration." }, 503);
}
export function validatePlanId(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new SupportStoreError(400, "Plan id must be a UUID.");
}
