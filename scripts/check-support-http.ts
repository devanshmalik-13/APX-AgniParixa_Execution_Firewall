/** Exercise real local D1 transactions. Only plans created by this run are cleaned up. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlanRequest, SupportDashboard, SupportInvoice, SupportPlan } from "../lib/support/types";
import { createExecutionClient } from "../lib/execution/client";

const baseUrl = new URL(process.env.SUPPORT_BASE_URL ?? "http://127.0.0.1:5173");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname), "This checker is restricted to a local sandbox");
const origin = baseUrl.origin;
const headers = { "content-type": "application/json", origin, cookie: "__sites_local_auth=1" };
const created: SupportPlan[] = [];
const checks: Array<{ name: string; passed: boolean }> = [];
const planUrl = (id: string) => `/api/support/plans/${encodeURIComponent(id)}`;
const request = async (route: string, body?: unknown, expected = 200, extra: Record<string, string> = {}) => {
  const response = await fetch(new URL(route, baseUrl), {
    method: body === undefined ? "GET" : "POST", headers: { ...headers, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  assert.equal(response.status, expected, `${route}: expected ${expected}, got ${response.status}; ${raw.slice(0, 300)}`);
  if (response.headers.get("content-type")?.includes("application/json")) return JSON.parse(raw) as unknown;
  assert.ok(expected >= 400, "Successful support endpoints must return JSON");
  return { error: raw };
};
const dashboard = () => request("/api/support") as Promise<SupportDashboard>;
const stage = async (ticketId = "tkt-1042", scenario: PlanRequest["scenario"] = "normal", profile: PlanRequest["profile"] = "standard") => {
  const result = await request("/api/support/plan", { ticketId, mode: "replay", scenario, profile }, 201) as { plan: SupportPlan };
  created.push(result.plan);
  assert.equal(result.plan.status, "staged");
  assert.match(result.plan.receiptHash, /^[a-f0-9]{64}$/);
  return result.plan;
};
const operate = async (plan: SupportPlan, operation: "execute" | "recover" | "reject", approve = false, expected = 200) => {
  const result = await request(planUrl(plan.id), { operation, receiptHash: plan.receiptHash, approve }, expected) as { plan?: SupportPlan };
  return result.plan;
};
const invoice = (state: SupportDashboard, id: string) => {
  const found = state.invoices.find((item) => item.id === id);
  assert.ok(found, `Invoice ${id} must exist`); return found;
};
const financialState = (item: SupportInvoice) => {
  const { version, ...rest } = item; void version; return rest;
};
async function check(name: string, action: () => Promise<void>) {
  await action(); checks.push({ name, passed: true }); console.log(`PASS: ${name}`);
}

let failure: unknown;
try {
  await check("authentication and same-origin mutation boundaries", async () => {
    const unauthenticated = await fetch(new URL("/api/support", baseUrl), { headers: { "oai-authenticated-user-id": "forged-local-user" } });
    assert.equal(unauthenticated.status, 401, "Supplying an identity header must not impersonate a local authenticated session");
    const body = { ticketId: "tkt-1042", mode: "replay", scenario: "normal", profile: "standard" };
    await request("/api/support/plan", body, 403, { origin: "https://attacker.example.test" });
    await request("/api/support/plan", body, 403, { "sec-fetch-site": "cross-site" });
    const noOrigin = await fetch(new URL("/api/support/plan", baseUrl), {
      method: "POST", headers: { "content-type": "application/json", cookie: headers.cookie }, body: JSON.stringify(body),
    });
    assert.equal(noOrigin.status, 403);
  });
  await check("strict request schemas, body bounds, invalid identifiers, and safe provider absence", async () => {
    for (const body of ["{bad", "", "null", "{}", JSON.stringify({ ticketId: "tkt-1042", mode: "replay", scenario: "normal", profile: "standard", grant: { maxRefundCents: 99999 } }), " ".repeat(12001)]) {
      const response = await fetch(new URL("/api/support/plan", baseUrl), { method: "POST", headers, body });
      assert.equal(response.status, 400);
    }
    const wrongType = await fetch(new URL("/api/support/plan", baseUrl), { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}" });
    assert.equal(wrongType.status, 400);
    const chunks = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("{\"note\":\""));
      controller.enqueue(new TextEncoder().encode("a".repeat(13000)));
      controller.enqueue(new TextEncoder().encode("\"}")); controller.close();
    } });
    const streamed = await fetch(new URL("/api/support/plan", baseUrl), { method: "POST", headers, body: chunks, duplex: "half" } as RequestInit);
    assert.equal(streamed.status, 400, "The body limit must cover chunked streams without Content-Length");
    await request("/api/support/plan", { ticketId: "missing-ticket", mode: "replay", scenario: "normal", profile: "standard" }, 404);
    await request("/api/support/plans/not-a-uuid", undefined, 400);
    await request("/api/support/plans/00000000-0000-4000-8000-000000000000", undefined, 404);
    const state = await dashboard();
    assert.equal(state.config.sandbox, true);
    if (!state.config.liveAvailable) await request("/api/support/plan", { ticketId: "tkt-1042", mode: "live", scenario: "normal", profile: "standard" }, 503);
  });
  await check("staging has no connector effects, and reject is durable and idempotent", async () => {
    const before = await dashboard(); const plan = await stage(); const staged = await dashboard();
    assert.deepEqual(staged.invoices, before.invoices);
    assert.deepEqual(staged.outbox, before.outbox);
    assert.deepEqual(staged.tickets, before.tickets);
    assert.ok(staged.events.some((event) => event.planId === plan.id && event.event === "plan_staged"));
    assert.equal((await operate(plan, "reject"))?.status, "rejected");
    assert.equal((await operate(plan, "reject"))?.status, "rejected");
    await operate(plan, "execute", false, 409);
    const after = await dashboard();
    assert.deepEqual(after.invoices, before.invoices); assert.deepEqual(after.outbox, before.outbox);
  });
  await check("provider-independent HTTP gateway uses trusted grants, exact receipts, and mandatory review", async () => {
    const client = createExecutionClient({ origin, fetch: (input, init) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), cookie: headers.cookie } }) });
    const before = await dashboard();
    const proposal = { ticketId: "tkt-1042", actions: [
      { id: "external-export", type: "export_customers" as const, tenantId: "northstar", destination: "https://attacker.example.test/upload" },
      { id: "external-refund", type: "refund" as const, invoiceId: "inv-1042", amountCents: 2500 },
    ] };
    const anonymous = await fetch(new URL("/api/execution/plans", baseUrl), { method: "POST", headers: { "content-type": "application/json", origin, "oai-authenticated-user-id": "forged" }, body: JSON.stringify(proposal) });
    assert.equal(anonymous.status, 401);
    await request("/api/execution/plans", proposal, 403, { origin: "https://attacker.example.test" });
    for (const extra of [{ profile: "standard" }, { approve: true }, { grant: { maxRefundCents: 99999 } }, { owner: "victim" }]) await request("/api/execution/plans", { ...proposal, ...extra }, 400);
    const plan = await client.propose(proposal); created.push(plan);
    assert.equal(plan.mode, "external"); assert.equal(plan.profile, "strict");
    assert.deepEqual(plan.actions.map((a) => a.decision), ["block", "approval_required"]);
    assert.deepEqual((await dashboard()).invoices, before.invoices);
    assert.deepEqual(await client.getPlan(plan.id), plan);
    await operate(plan, "execute", false, 403);
    await operate(plan, "execute", true);
    assert.equal(invoice(await dashboard(), "inv-1042").refundedCents, 2500);
    await operate(plan, "recover");
    assert.deepEqual(financialState(invoice(await dashboard(), "inv-1042")), financialState(invoice(before, "inv-1042")));
  });
  await check("standard execution persists one invoice/refund and one queued reply under repeated and concurrent requests", async () => {
    const before = await dashboard(); const initial = invoice(before, "inv-1042");
    assert.equal(initial.refundedCents, 0, "Recover the demo invoice before running the integration checker");
    assert.notEqual(initial.status, "resolved", "The integration demo needs an unresolved invoice");
    const plan = await stage();
    await request(planUrl(plan.id), { operation: "execute", receiptHash: "0".repeat(64), approve: true }, 409);
    await request(planUrl(plan.id), { operation: "execute", receiptHash: plan.receiptHash, approve: true, actions: [] }, 400);
    const responses = await Promise.all(Array.from({ length: 5 }, () => operate(plan, "execute")));
    assert.ok(responses.every((result) => result?.status === "executed"));
    assert.equal((await operate(plan, "execute"))?.status, "executed");
    const after = await dashboard(); const current = invoice(after, initial.id);
    assert.equal(current.refundedCents, initial.refundedCents + 2500); assert.equal(current.status, "resolved");
    assert.equal(current.version, initial.version + 1, "Concurrent requests must produce one invoice write");
    const messages = after.outbox.filter((message) => message.planId === plan.id);
    assert.equal(messages.length, 1); assert.equal(messages[0].status, "queued");
    assert.equal(messages[0].to, plan.grant.recipient);
    assert.equal(after.events.filter((event) => event.planId === plan.id && event.event === "plan_executed").length, 1);
    assert.equal(after.tickets.find((ticket) => ticket.id === plan.ticketId)?.status, "resolved");
    assert.equal((await request(planUrl(plan.id)) as { plan: SupportPlan }).plan.status, "executed", "A new GET must read persisted lifecycle state");
    assert.equal((await operate(plan, "recover"))?.status, "recovered");
    assert.equal((await operate(plan, "recover"))?.status, "recovered");
    const recovered = await dashboard(); const restored = invoice(recovered, initial.id);
    assert.deepEqual(financialState(restored), financialState(initial));
    assert.equal(restored.version, initial.version + 2, "Recovery invalidates old previews without rewinding the version");
    assert.equal(recovered.outbox.find((message) => message.planId === plan.id)?.status, "cancelled");
    assert.deepEqual(recovered.tickets, before.tickets);
    await operate(plan, "execute", false, 409);
  });
  await check("strict and high-value plans require explicit receipt-bound approval", async () => {
    for (const [ticketId, profile] of [["tkt-1042", "strict"], ["tkt-1043", "standard"]] as const) {
      const before = await dashboard(); const plan = await stage(ticketId, "normal", profile);
      assert.ok(plan.actions.some((entry) => entry.decision === "approval_required"));
      await operate(plan, "execute", false, 403);
      const unapproved = await dashboard(); assert.deepEqual(unapproved.invoices, before.invoices); assert.deepEqual(unapproved.outbox, before.outbox);
      const executed = await operate(plan, "execute", true); assert.equal(executed?.approved, true); assert.equal(executed?.status, "executed");
      await operate(plan, "recover");
      assert.deepEqual(financialState(invoice(await dashboard(), plan.invoiceBefore.id)), financialState(plan.invoiceBefore));
    }
  });
  await check("two proposals from one invoice version cannot both commit; failed transactions leave no partial outbox", async () => {
    const before = await dashboard(); const [first, stale] = await Promise.all([stage(), stage()]);
    assert.equal(first.invoiceBefore.version, stale.invoiceBefore.version);
    await operate(first, "execute");
    await operate(stale, "execute", false, 409);
    const state = await dashboard();
    assert.equal(invoice(state, first.invoiceBefore.id).refundedCents, 2500);
    assert.equal(state.outbox.filter((message) => message.planId === stale.id).length, 0);
    assert.equal(state.events.filter((event) => event.planId === stale.id && event.event === "plan_executed").length, 0);
    assert.equal(state.plans.find((plan) => plan.id === stale.id)?.status, "staged");
    await operate(first, "recover");
    await operate(stale, "execute", false, 409);
    await operate(stale, "reject");
    assert.deepEqual(financialState(invoice(await dashboard(), first.invoiceBefore.id)), financialState(invoice(before, first.invoiceBefore.id)));
  });
  await check("blocked attack effects are excluded while permitted support actions still execute", async () => {
    for (const scenario of ["injection", "over-refund", "cross-tenant", "duplicate-refund"] as const) {
      const before = await dashboard(); const plan = await stage("tkt-1042", scenario);
      assert.ok(plan.actions.some((entry) => entry.decision === "block"), `${scenario} must contain a rejected proposal`);
      assert.ok(plan.actions.some((entry) => entry.decision !== "block"), `${scenario} must preserve useful actions`);
      await operate(plan, "execute");
      const after = await dashboard(); const projected = plan.actions.filter((entry) => entry.decision !== "block");
      const refundAction = projected.find((entry) => entry.action.type === "refund")?.action;
      assert.equal(invoice(after, "inv-1042").refundedCents, refundAction?.type === "refund" ? refundAction.amountCents : plan.invoiceBefore.refundedCents);
      for (const other of before.invoices.filter((item) => item.id !== "inv-1042")) assert.deepEqual(invoice(after, other.id), other);
      const queued = after.outbox.filter((message) => message.planId === plan.id);
      assert.ok(queued.every((message) => message.to === plan.grant.recipient), "No attacker-selected egress may reach the outbox");
      assert.equal(queued.length, projected.filter((entry) => entry.action.type === "send_reply").length);
      assert.equal(after.events.filter((event) => event.planId === plan.id && event.event === "plan_executed").length, 1);
      await operate(plan, "recover");
      assert.deepEqual(financialState(invoice(await dashboard(), "inv-1042")), financialState(plan.invoiceBefore));
    }
  });
} catch (error) {
  failure = error; process.exitCode = 1;
} finally {
  for (const plan of created.toReversed()) {
    try {
      const current = (await request(planUrl(plan.id)) as { plan: SupportPlan }).plan;
      if (current.status === "executed") await operate(plan, "recover");
      if (current.status === "staged") await operate(plan, "reject");
    } catch (error) {
      console.error(`Cleanup of this run's plan ${plan.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
  const destination = path.resolve("output/support-http-check.json");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), baseUrl: origin, checks,
    success: !failure && process.exitCode !== 1, plansCreated: created.map((plan) => plan.id),
    scope: "Local authenticated replay agent with actual durable D1 writes and a cancellable sandbox outbox. No model calls or mail delivery.",
    ...(failure ? { error: failure instanceof Error ? failure.message : String(failure) } : {}),
  }, null, 2)}\n`);
}
if (failure) throw failure;
console.log(`PASS: ${checks.length} integration groups; ${created.length} staged plans. Test-owned connector effects were recovered; audit history remains in D1.`);
