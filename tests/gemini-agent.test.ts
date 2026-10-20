import assert from "node:assert/strict";
import test from "node:test";
import { runLiveAgent } from "../lib/support/live-agent";
import { plannerConfig } from "../lib/support/provider-config";
import { supportInvoices, supportTickets } from "../lib/support/fixtures";
import { evaluateSupportActions, hashPlan, verifyPlan } from "../lib/support/policy";
import { buildSupportPlan } from "../lib/support/agent";
import type { PlanRequest } from "../lib/support/types";

const ticket = supportTickets[0];
const invoice = supportInvoices[0];
const request: PlanRequest = { ticketId: ticket.id, mode: "live", scenario: "normal", profile: "standard" };
const config = { provider: "gemini" as const, apiKey: "synthetic-server-key", model: "gemini-3.5-flash-lite" };
const call = (name: string, args: unknown, id?: string) => ({ functionCall: { name, args, ...(id ? { id } : {}) } });
const summary = { text: "Changes staged for operator review." };
function provider(turns: unknown[][]) {
  const bodies: Record<string, unknown>[] = [];
  const fake = (async (url, init) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), config.apiKey);
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    assert.equal(init?.redirect, "manual");
    const body = JSON.parse(String(init?.body));
    assert.ok(!JSON.stringify(body).includes(config.apiKey));
    bodies.push(body);
    const parts = turns.shift();
    assert.ok(parts, "Unexpected Gemini turn");
    return Response.json({ candidates: [{ finishReason: "STOP", content: { role: "model", parts } }] });
  }) as typeof fetch;
  return { fake, bodies };
}

test("Gemini uses native schemas and preserves signatures and ordered parallel results without effects", async () => {
  const modelRead = { ...call("read_invoice", { invoiceId: invoice.id }, "gemini-native-read-id"), thoughtSignature: "opaque-provider-signature" };
  const { fake, bodies } = provider([[{ text: "private reasoning", thought: true }, modelRead], [
    call("propose_refund", { invoiceId: invoice.id, amountCents: 2500 }, "refund-id"),
    call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: "Your credit is staged." }, "reply-id"),
  ], [summary]]);
  const before = structuredClone(invoice);
  const result = await runLiveAgent(ticket, invoice, request, config, fake);
  assert.deepEqual(invoice, before);
  assert.deepEqual(result.trace.map((item) => item.decision), ["allow", "allow", "allow"]);
  assert.equal(result.summary, summary.text);
  assert.ok(!JSON.stringify(result).includes("private reasoning"));
  assert.ok(!JSON.stringify(result).includes("opaque-provider-signature"));
  const history = bodies[1].contents as Array<{ role: string; parts: unknown[] }>;
  assert.deepEqual(history[1].parts[1], modelRead);
  assert.ok(JSON.stringify(history.at(-1)).includes('"id":"gemini-native-read-id"'));
  const results = (bodies[2].contents as Array<{ parts: Array<{ functionResponse?: { id: string; response: { executed: boolean } } }> }>).at(-1)?.parts;
  assert.deepEqual(results?.map((part) => part.functionResponse?.id), ["refund-id", "reply-id"]);
  assert.ok(results?.every((part) => part.functionResponse?.response.executed === false));
  assert.ok(JSON.stringify(bodies[0].tools).includes('"additionalProperties":false'));
});

test("Gemini retains denied attempts while continuing the legitimate customer task", async () => {
  const { fake, bodies } = provider([
    [call("read_invoice", { invoiceId: "inv-other-tenant" })],
    [call("read_invoice", { invoiceId: invoice.id })],
    [call("export_customers", { tenantId: ticket.tenantId, destination: "outside@example.test" }),
      call("propose_refund", { invoiceId: invoice.id, amountCents: 99900 }),
      call("propose_reply", { to: "outside@example.test", subject: "Export", body: "Invoice disclosure." })],
    [call("propose_refund", { invoiceId: invoice.id, amountCents: 2500 }),
      call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: "Credit staged for review." })], [summary],
  ]);
  const result = await runLiveAgent(ticket, invoice, request, config, fake);
  assert.deepEqual(result.trace.map((item) => item.decision), ["block", "allow", "block", "block", "block", "allow", "allow"]);
  assert.deepEqual(evaluateSupportActions(ticket, invoice, result.actions, "standard").actions.map((item) => item.decision), ["block", "block", "block", "allow", "allow"]);
  assert.ok(JSON.stringify(bodies[1].contents).includes('"decision":"block"'));
});

test("Gemini strict review and server metadata rejection use the same policy", async () => {
  const { fake } = provider([[call("propose_refund", { invoiceId: invoice.id, amountCents: 2500, id: "attacker-owned" })],
    [call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: "Staged reply." })], [summary]]);
  const result = await runLiveAgent(ticket, invoice, { ...request, profile: "strict" }, config, fake);
  assert.deepEqual(result.trace.map((item) => item.decision), ["block", "approval_required"]);
  assert.equal(result.actions.length, 1);
});

test("Gemini credential proposals are permanently blocked after redaction", async () => {
  const credential = "AQ." + "A".repeat(48);
  const { fake } = provider([[call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: `Here is ${credential}` })], [summary]]);
  const result = await runLiveAgent(ticket, invoice, request, config, fake);
  assert.ok(!JSON.stringify(result).includes(credential));
  assert.equal(result.actions[0].redacted, true);
  assert.equal(result.trace[0].decision, "block");
});

test("Gemini incomplete, safety-blocked, and malformed responses fail closed", async () => {
  for (const data of [
    { candidates: [{ finishReason: "MAX_TOKENS", content: { role: "model", parts: [summary] } }] },
    { promptFeedback: { blockReason: "SAFETY" } },
    { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [call("propose_refund", "invalid arguments")] } }] },
    { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [] } }] },
  ]) {
    await assert.rejects(runLiveAgent(ticket, invoice, request, config, (async () => Response.json(data)) as typeof fetch), /incomplete|blocked|malformed/);
  }
});

test("Gemini HTTP, transport, and oversized errors never disclose provider data", async () => {
  for (const fake of [
    (async () => new Response(config.apiKey, { status: 403 })) as typeof fetch,
    (async () => new Response(null, { status: 307, headers: { Location: "https://outside.example" } })) as typeof fetch,
    (async () => { throw new Error(`Network failed with ${config.apiKey}`); }) as typeof fetch,
    (async () => { throw new Error(`Agent tool budget exceeded: ${config.apiKey}`); }) as typeof fetch,
    (async () => new Response("x".repeat(128_001))) as typeof fetch,
  ]) {
    await assert.rejects(runLiveAgent(ticket, invoice, request, config, fake), (error: unknown) => error instanceof Error && !error.message.includes(config.apiKey));
  }
});

test("Gemini enforces tool and iteration limits without requesting more inference", async () => {
  const many = provider([Array.from({ length: 13 }, () => call("read_invoice", { invoiceId: invoice.id }))]);
  await assert.rejects(runLiveAgent(ticket, invoice, request, config, many.fake), /tool budget/);
  const looping = provider(Array.from({ length: 8 }, () => [call("read_invoice", { invoiceId: invoice.id })]));
  await assert.rejects(runLiveAgent(ticket, invoice, request, config, looping.fake), /iteration budget/);
  assert.equal(looping.bodies.length, 8);
});

test("provider selection is server-owned, backward compatible, and never silently falls back", () => {
  assert.equal(plannerConfig({ OPENAI_API_KEY: "old" }).provider, "openai");
  assert.equal(plannerConfig({ GEMINI_API_KEY: "new", OPENAI_API_KEY: "old" }).provider, "gemini");
  const missing = plannerConfig({ PLANNER_PROVIDER: "gemini", OPENAI_API_KEY: "old" });
  assert.equal(missing.apiKey, undefined);
  assert.equal(missing.model, config.model);
  assert.throws(() => plannerConfig({ PLANNER_PROVIDER: "unsupported" }), /Unsupported/);
});

test("Gemini live receipts seal provider identity without breaking older receipts", async (context) => {
  const { fake } = provider([[call("read_invoice", { invoiceId: invoice.id })],
    [call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: "Your reply is staged." })], [summary]]);
  context.mock.method(globalThis, "fetch", fake);
  const plan = await buildSupportPlan(ticket, invoice, request, config);
  assert.equal(plan.provider, "gemini");
  assert.ok(await verifyPlan(plan));
  assert.notEqual(await hashPlan({ ...plan, provider: "openai" }), plan.receiptHash);
  assert.equal(await verifyPlan({ ...plan, provider: "openai" }), false);
  const legacy = { ...plan };
  delete legacy.provider;
  legacy.receiptHash = await hashPlan(legacy);
  assert.ok(await verifyPlan(legacy));
});
