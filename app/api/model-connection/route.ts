import { env } from "cloudflare:workers";
import { supportIdentity, readSupportBody, supportResponse, supportError } from "../support/_shared";
import { connectionCookie, connectionLifetime, connectionSchema, connectionFromRequest, connectionStatus, openConnection, sealConnection, verifyConnection } from "@/lib/support/model-connection";
import { plannerConfig, PlannerProviderError } from "@/lib/support/provider-config";
import { SupportStoreError } from "@/lib/support/store";
import { z } from "zod";

const probes = new Map<string, number>();
function cookieOptions(request: Request) { return { httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "strict" as const, path: "/", maxAge: connectionLifetime }; }
function protectedTransport(request: Request) {
  const url = new URL(request.url);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new SupportStoreError(403, "Model keys require HTTPS, except on a local loopback preview.");
}

export async function GET(request: Request) {
  try {
    const owner = supportIdentity(request);
    const sealed = connectionFromRequest(request);
    if (sealed) {
      const connection = await openConnection(sealed, owner, env.MODEL_CONNECTION_SECRET);
      return supportResponse({ connection: connectionStatus(connection.config, env.MODEL_CONNECTION_SECRET, connection.expiresAt) });
    }
    return supportResponse({ connection: connectionStatus(plannerConfig(env), env.MODEL_CONNECTION_SECRET) });
  } catch (error) { return supportError(error); }
}

export async function POST(request: Request) {
  let owner: string | undefined;
  try {
    owner = supportIdentity(request, true);
    protectedTransport(request);
    const now = Date.now();
    for (const [id, until] of probes) if (until < now) probes.delete(id);
    if (probes.has(owner) || probes.size >= 512) throw new PlannerProviderError("Please wait 30 seconds before another connection test.");
    probes.set(owner, now + 30_000);
    const input = connectionSchema.parse(await readSupportBody(request, 2400));
    const sealed = await sealConnection(input, owner, env.MODEL_CONNECTION_SECRET, now);
    await verifyConnection(input);
    const response = supportResponse({ connection: connectionStatus(input, env.MODEL_CONNECTION_SECRET, now + connectionLifetime * 1000) });
    response.cookies.set(connectionCookie, sealed, cookieOptions(request));
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return supportResponse({ error: "Invalid model connection. Use a supported provider, valid model ID, and API key; no extra fields are accepted." }, 400);
    return supportError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    supportIdentity(request, true);
    const response = supportResponse({ connection: connectionStatus(plannerConfig(env), env.MODEL_CONNECTION_SECRET) });
    response.cookies.set(connectionCookie, "", { ...cookieOptions(request), maxAge: 0 });
    return response;
  } catch (error) { return supportError(error); }
}
