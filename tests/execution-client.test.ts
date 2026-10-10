import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionClient, ExecutionGatewayError } from "../lib/execution/client";

test("proposal client keeps authority out of the wire envelope and never executes", async () => {
  let request: Request | undefined;
  const client = createExecutionClient({ origin: "https://example.test", fetch: async (input, init) => {
    request = new Request(input, init);
    return Response.json({ plan: { id: "synthetic", receiptHash: "a".repeat(64), status: "staged" } }, { status: 201 });
  } });
  const proposal = { ticketId: "tkt-1042", actions: [{ id: "r1", type: "refund" as const, invoiceId: "inv-1042", amountCents: 2500 }] };
  await client.propose(proposal);
  assert.equal(request?.url, "https://example.test/api/execution/plans");
  assert.equal(request?.method, "POST");
  assert.equal(request?.credentials, "same-origin");
  assert.equal(request?.redirect, "error");
  assert.deepEqual(await request?.json(), proposal);
  assert.ok(!("execute" in client) && !("approve" in client));
});

test("gateway client reports authorization errors and refuses credential-bearing origins", async () => {
  const client = createExecutionClient({ origin: "https://example.test", fetch: async () => Response.json({ error: "An authenticated visitor is required." }, { status: 401 }) });
  await assert.rejects(client.getPlan("00000000-0000-4000-8000-000000000000"), (error: unknown) => error instanceof ExecutionGatewayError && error.status === 401);
  for (const origin of ["https://user:pass@example.test", "https://example.test/path", "file:///tmp", "https://example.test?token=secret"]) assert.throws(() => createExecutionClient({ origin }));
  await assert.rejects(client.getPlan("../../attack"), /UUID/);
});

test("gateway client does not mistake HTML or incomplete responses for staged plans", async () => {
  for (const response of [new Response("<html>sign in</html>"), Response.json({}), Response.json(null), Response.json("unexpected"), Response.json([]), Response.json(null, { status: 400 })]) {
    const client = createExecutionClient({ origin: "https://example.test", fetch: async () => response });
    await assert.rejects(client.getPlan("00000000-0000-4000-8000-000000000000"), (error: unknown) => error instanceof ExecutionGatewayError && (response.ok || error.status === response.status));
  }
});
