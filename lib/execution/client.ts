import type { ExternalProposalRequest, SupportPlan } from "../support/types";

export class ExecutionGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "ExecutionGatewayError"; }
}

/** Thin same-origin, session-authenticated client. It has no approve/execute API. */
export function createExecutionClient(options: { origin: string; fetch?: typeof globalThis.fetch }) {
  const url = new URL(options.origin);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Execution client requires an HTTP(S) origin without credentials or a path.");
  const origin = url.origin;
  const transport = options.fetch ?? globalThis.fetch;
  async function read(response: Response): Promise<SupportPlan> {
    let payload: { plan?: SupportPlan; error?: string };
    try {
      const value: unknown = await response.json();
      if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid response envelope");
      payload = value as typeof payload;
    }
    catch { throw new ExecutionGatewayError(response.status, "The execution gateway returned an unreadable response."); }
    if (!response.ok) throw new ExecutionGatewayError(response.status, typeof payload.error === "string" ? payload.error : "The execution gateway rejected this request.");
    if (!payload.plan?.id || !payload.plan.receiptHash) throw new ExecutionGatewayError(502, "The execution gateway returned an incomplete plan.");
    return payload.plan;
  }
  return {
    async propose(proposal: ExternalProposalRequest, signal?: AbortSignal): Promise<SupportPlan> {
      return read(await transport(new URL("/api/execution/plans", origin), {
        method: "POST", credentials: "same-origin", redirect: "error", signal,
        headers: { "content-type": "application/json", origin }, body: JSON.stringify(proposal),
      }));
    },
    async getPlan(id: string, signal?: AbortSignal): Promise<SupportPlan> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Plan id must be a UUID.");
      return read(await transport(new URL(`/api/support/plans/${id}`, origin), {
        credentials: "same-origin", redirect: "error", cache: "no-store", signal,
      }));
    },
  };
}
