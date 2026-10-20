import { env } from "cloudflare:workers";
import { supportContext, supportIdentity, readSupportBody, supportResponse, supportError } from "../support/_shared";
import { fetchWebEvidence, TinyFishError } from "@/lib/tinyfish/client";
import { reserveWebFetch, saveWebEvidence } from "@/lib/tinyfish/store";
import { webFetchSchema, webSources } from "@/lib/tinyfish/types";
import { z } from "zod";

export async function GET(request: Request) {
  try { supportIdentity(request); return supportResponse({ configured: Boolean(env.TINYFISH_API_KEY), sources: webSources }); }
  catch (error) { return supportError(error); }
}
export async function POST(request: Request) {
  try {
    const { owner, store } = supportContext(request, true);
    const url = new URL(request.url);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return supportResponse({ error: "TinyFish keys require HTTPS outside the local preview." }, 403);
    const input = webFetchSchema.parse(await readSupportBody(request, 1800));
    const key = input.apiKey || env.TINYFISH_API_KEY;
    if (!key) throw new TinyFishError(503, "Enter your TinyFish key below. It is separate from your model-provider key.");
    const dashboard = await store.dashboard(owner);
    if (!dashboard.tickets.some(ticket => ticket.id === input.ticketId)) return supportResponse({error: "Select an assigned support ticket first."}, 404);
    await reserveWebFetch(env.DB!, owner);
    const evidence = await fetchWebEvidence(input.sourceId, key, fetch, Date.now(), [env.GEMINI_API_KEY, env.OPENAI_API_KEY, env.MODEL_CONNECTION_SECRET].filter((value): value is string => !!value));
    await saveWebEvidence(env.DB!, owner, input.ticketId, evidence);
    return supportResponse({ evidence }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) return supportResponse({ error: "Choose a supported reference and a valid TinyFish key. Custom URLs and extra fields are not accepted." }, 400);
    if (error instanceof TinyFishError) return supportResponse({error:error.message}, error.status);
    return supportError(error);
  }
}
