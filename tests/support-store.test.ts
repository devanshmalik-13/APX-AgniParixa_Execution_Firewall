import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createSupportStore, SupportStoreError, type SupportStoreConfig } from "../lib/support/store";
import { evaluateSupportActions, hashPlan } from "../lib/support/policy";
import { supportTickets } from "../lib/support/fixtures";
import type { PlanRequest, SupportPlan } from "../lib/support/types";

/** Execute actual SQLite SQL, including CHECK constraints and rollback behavior. */
function database(config: SupportStoreConfig = { model: "replay" }) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../database/support-schema.sql", import.meta.url), "utf8"));
  let nextBatchHook: ((database: DatabaseSync) => void) | null = null;
  class Statement {
    values: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...values: (string | number | null)[]) { this.values = values; return this; }
    async first<T>() { return sqlite.prepare(this.sql).get(...this.values) as T | null ?? null; }
    async all<T>() { return { results: sqlite.prepare(this.sql).all(...this.values) as T[], success: true }; }
    async run() { return this.runSync(); }
    runSync() { const result = sqlite.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
  }
  const d1 = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (statements: Statement[]) => {
      const hook = nextBatchHook;
      nextBatchHook = null;
      hook?.(sqlite);
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => statement.runSync());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, store: createSupportStore(d1, config), beforeNextBatch: (hook: (database: DatabaseSync) => void) => { nextBatchHook = hook; } };
}
const request = (ticketId = "tkt-1042", extra: Partial<PlanRequest> = {}): PlanRequest => ({ ticketId, mode: "replay", scenario: "normal", profile: "standard", ...extra });
const operation = (plan: SupportPlan, kind: "execute" | "recover" | "reject", approve = false) => ({ operation: kind, receiptHash: plan.receiptHash, approve });
const status = (value: number) => (error: unknown) => error instanceof SupportStoreError && error.status === value;

test("external gateway ignores model authority, stages mixed actions, and requires operator review", async () => {
  const { sqlite, store } = database();
  try {
    const before = await store.dashboard("gateway-owner");
    const plan = await store.stageExternal("gateway-owner", { ticketId: "tkt-1042", actions: [
      { id: "export", type: "export_customers", tenantId: "northstar", destination: "attacker@outside.test" },
      { id: "refund", type: "refund", invoiceId: "inv-1042", amountCents: 2500 },
      { id: "reply", type: "send_reply", to: "maya@example.test", subject: "Invoice review", body: "We are processing your request." },
    ] });
    assert.equal(plan.mode, "external");
    assert.equal(plan.profile, "strict");
    assert.deepEqual(plan.actions.map((a) => a.decision), ["block", "approval_required", "approval_required"]);
    const staged = await store.dashboard("gateway-owner");
    assert.deepEqual(staged.invoices, before.invoices);
    assert.equal(staged.outbox.length, 0);
    await assert.rejects(store.operate("gateway-owner", plan.id, operation(plan, "execute")), status(403));
    await assert.rejects(store.operate("another-owner", plan.id, operation(plan, "execute", true)), status(404));
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => store.operate("gateway-owner", plan.id, operation(plan, "execute", true))));
    assert.ok(outcomes.every((p) => p.status === "executed"));
    const executed = await store.dashboard("gateway-owner");
    assert.equal(executed.invoices[0].refundedCents, 2500);
    assert.equal(executed.outbox.length, 1);
    assert.equal(executed.events.filter((e) => e.event === "plan_executed").length, 1);
    await store.operate("gateway-owner", plan.id, operation(plan, "recover"));
    assert.equal((await store.dashboard("gateway-owner")).outbox[0].status, "cancelled");
  } finally { sqlite.close(); }
});

test("external gateway schema rejects injected grants, approvals, profiles and excessive batches", async () => {
  const { sqlite, store } = database();
  try {
    const proposal = { ticketId: "tkt-1042", actions: [{ id: "refund", type: "refund" as const, invoiceId: "inv-1042", amountCents: 2500 }] };
    for (const extra of [{ grant: { maxRefundCents: 999999 } }, { approve: true }, { profile: "standard" }, { owner: "victim" }, { receiptHash: "a".repeat(64) }]) {
      await assert.rejects(store.stageExternal("owner", { ...proposal, ...extra }));
    }
    await assert.rejects(store.stageExternal("owner", { ...proposal, actions: [] }));
    await assert.rejects(store.stageExternal("owner", { ...proposal, actions: Array.from({ length: 9 }, () => proposal.actions[0]) }));
    assert.equal((await store.dashboard("owner")).plans.length, 0);
    await assert.rejects(store.stageExternal("owner", { ...proposal, ticketId: "missing" }), status(404));
  } finally { sqlite.close(); }
});

test("external proposals redact credentials without authorizing the redacted action", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stageExternal("owner", { ticketId: "tkt-1042", actions: [
      { id: "reply", type: "send_reply", to: "maya@example.test", subject: "Invoice", body: "key: sk-proj-syntheticCredential1234567890" },
    ] });
    assert.equal(plan.actions[0].decision, "block");
    assert.equal(plan.actions[0].action.redacted, true);
    assert.ok(!JSON.stringify(plan).includes("sk-proj-syntheticCredential1234567890"));
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "execute", true)), status(409));
    assert.equal((await store.dashboard("owner")).outbox.length, 0);
  } finally { sqlite.close(); }
});

test("recomputed checksums cannot downgrade an external proposal's mandatory review profile", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stageExternal("owner", { ticketId: "tkt-1042", actions: [{ id: "refund", type: "refund", invoiceId: "inv-1042", amountCents: 2500 }] });
    const downgraded = evaluateSupportActions(supportTickets[0], plan.invoiceBefore, plan.actions.map((a) => a.action), "standard", Date.parse(plan.createdAt));
    const forged = { ...plan, profile: "standard" as const, grant: downgraded.grant, actions: downgraded.actions };
    forged.receiptHash = await hashPlan(forged);
    sqlite.prepare("UPDATE support_plans SET immutable_json=?,receipt_hash=? WHERE owner_id=? AND id=?").run(JSON.stringify(forged), forged.receiptHash, "owner", plan.id);
    await assert.rejects(store.operate("owner", plan.id, operation(forged, "execute")), status(409));
    assert.equal((await store.dashboard("owner")).invoices[0].refundedCents, 0);
  } finally { sqlite.close(); }
});

test("staging writes only proposal/audit; execution and recovery commit durable connector effects", async () => {
  const { sqlite, store } = database();
  try {
    const before = await store.dashboard("owner-a");
    const plan = await store.stage("owner-a", request());
    const staged = await store.dashboard("owner-a");
    assert.deepEqual(staged.invoices, before.invoices);
    assert.equal(staged.outbox.length, 0);
    assert.equal(staged.events.length, 1);
    const executed = await store.operate("owner-a", plan.id, operation(plan, "execute"));
    assert.equal(executed.status, "executed");
    const after = await store.dashboard("owner-a");
    assert.equal(after.invoices.find((invoice) => invoice.id === plan.invoiceBefore.id)?.refundedCents, 2500);
    assert.equal(after.invoices.find((invoice) => invoice.id === plan.invoiceBefore.id)?.version, 1);
    assert.equal(after.outbox.length, 1);
    const recovered = await store.operate("owner-a", plan.id, operation(plan, "recover"));
    assert.equal(recovered.status, "recovered");
    const restored = await store.dashboard("owner-a");
    const restoredInvoice = restored.invoices.find((invoice) => invoice.id === plan.invoiceBefore.id)!;
    assert.deepEqual(restoredInvoice, { ...plan.invoiceBefore, version: 2 });
    assert.equal(restored.outbox[0].status, "cancelled");
    assert.equal(restored.events.length, 3);
    assert.deepEqual(await store.operate("owner-a", plan.id, operation(plan, "recover")), recovered);
    assert.equal((await store.dashboard("owner-a")).events.length, 3);
  } finally { sqlite.close(); }
});

test("simultaneous execution of one receipt issues its refund/outbox/audit exactly once", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    const results = await Promise.all(Array.from({ length: 8 }, () => store.operate("owner", plan.id, operation(plan, "execute"))));
    assert.ok(results.every((result) => result.status === "executed"));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.outbox.length, 1);
    assert.equal(snapshot.events.filter((event) => event.event === "plan_executed").length, 1);
    assert.equal(snapshot.invoices[0].refundedCents, 2500);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_transaction_assertions").get()?.n, 0);
  } finally { sqlite.close(); }
});

test("competing same-version plans produce one atomic winner and leave the stale proposal staged", async () => {
  const { sqlite, store } = database();
  try {
    const plans = await Promise.all([store.stage("owner", request()), store.stage("owner", request())]);
    const results = await Promise.allSettled(plans.map((plan) => store.operate("owner", plan.id, operation(plan, "execute"))));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && status(409)(rejected.reason));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.plans.filter((plan) => plan.status === "staged").length, 1);
    assert.equal(snapshot.outbox.length, 1);
    assert.equal(snapshot.invoices[0].refundedCents, 2500);
  } finally { sqlite.close(); }
});

test("owner namespaces deny cross-account reads and receipt replay", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner-a", request());
    assert.equal(await store.get("owner-b", plan.id), null);
    await assert.rejects(store.operate("owner-b", plan.id, operation(plan, "execute")), status(404));
    await store.operate("owner-a", plan.id, operation(plan, "execute"));
    const other = await store.dashboard("owner-b");
    assert.equal(other.plans.length, 0);
    assert.equal(other.outbox.length, 0);
    assert.equal(other.invoices[0].refundedCents, 0);
    await assert.rejects(store.dashboard(""), status(401));
  } finally { sqlite.close(); }
});

test("explicit approval is bound to receipt and cannot permit blocked attack actions", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request("tkt-1043", { scenario: "injection", profile: "strict" }));
    assert.ok(plan.actions.some((decision) => decision.decision === "block"));
    assert.ok(plan.actions.some((decision) => decision.decision === "approval_required"));
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "execute")), status(403));
    await assert.rejects(store.operate("owner", plan.id, { ...operation(plan, "execute", true), receiptHash: "0".repeat(64) }), status(409));
    const executed = await store.operate("owner", plan.id, operation(plan, "execute", true));
    assert.equal(executed.approved, true);
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.outbox.length, 1);
    assert.equal(snapshot.outbox[0].to, "jordan@example.test");
    assert.equal(snapshot.invoices.find((invoice) => invoice.id === "inv-1043")?.refundedCents, 7500);
  } finally { sqlite.close(); }
});

test("a connector failure rolls back invoice, refund ledger, lifecycle and execution audit", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    const reply = plan.actions.find((decision) => decision.action.type === "send_reply")!.action;
    // Simulate a pre-existing conflicting connector record. Failure occurs after
    // the invoice write, proving that JS prechecks alone are insufficient.
    sqlite.prepare("INSERT INTO support_outbox(owner_id,id,plan_id,recipient,subject,body,created_at,status) VALUES (?,?,?,?,?,?,?,'queued')").run("owner", `${plan.id}:${reply.id}`, plan.id, "maya@example.test", "Injected collision", "test", plan.createdAt);
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "execute")), status(409));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.invoices[0].refundedCents, 0);
    assert.equal(snapshot.invoices[0].version, 0);
    assert.equal(snapshot.plans[0].status, "staged");
    assert.equal(snapshot.events.length, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_refunds").get()?.n, 0);
    assert.equal(sqlite.prepare("SELECT execution_token FROM support_plans").get()?.execution_token, null);
  } finally { sqlite.close(); }
});

test("execution rejects changed snapshot even if an attacker preserves invoice version", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    sqlite.prepare("UPDATE support_invoices SET refunded_cents=100 WHERE owner_id='owner' AND id='inv-1042'").run();
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "execute")), status(409));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.invoices[0].refundedCents, 100);
    assert.equal(snapshot.outbox.length, 0);
    assert.equal(snapshot.plans[0].status, "staged");
  } finally { sqlite.close(); }
});

test("recovery refuses to overwrite a newer invoice mutation and keeps the outbox queued", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    await store.operate("owner", plan.id, operation(plan, "execute"));
    sqlite.prepare("UPDATE support_invoices SET version=version+1 WHERE owner_id='owner' AND id='inv-1042'").run();
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "recover")), status(409));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.plans[0].status, "executed");
    assert.equal(snapshot.invoices[0].refundedCents, 2500);
    assert.equal(snapshot.invoices[0].version, 2);
    assert.equal(snapshot.outbox[0].status, "queued");
    assert.equal(snapshot.events.length, 2);
  } finally { sqlite.close(); }
});

test("changed ticket entitlement invalidates the original grant even when the refund itself remains affordable", async () => {
  const { sqlite, store } = database();
  try {
    for (const requestedRefundCents of [1000, 3500]) {
      const owner = `owner-${requestedRefundCents}`;
      const plan = await store.stage(owner, request());
      const original = JSON.parse(String(sqlite.prepare("SELECT ticket_json FROM support_tickets WHERE owner_id=? AND id=?").get(owner, plan.ticketId)?.ticket_json));
      sqlite.prepare("UPDATE support_tickets SET ticket_json=? WHERE owner_id=? AND id=?").run(JSON.stringify({ ...original, requestedRefundCents }), owner, plan.ticketId);
      await assert.rejects(store.operate(owner, plan.id, operation(plan, "execute")), status(409));
      const snapshot = await store.dashboard(owner);
      assert.equal(snapshot.plans[0].status, "staged");
      assert.equal(snapshot.invoices[0].refundedCents, 0);
      assert.equal(snapshot.outbox.length, 0);
      assert.equal(snapshot.events.length, 1);
    }
  } finally { sqlite.close(); }
});

test("ticket snapshot SQL guard rolls back an entitlement edit between trusted read and batch execution", async () => {
  const { sqlite, store, beforeNextBatch } = database();
  try {
    const plan = await store.stage("owner", request());
    beforeNextBatch((database) => {
      const original = JSON.parse(String(database.prepare("SELECT ticket_json FROM support_tickets WHERE owner_id=? AND id=?").get("owner", plan.ticketId)?.ticket_json));
      database.prepare("UPDATE support_tickets SET ticket_json=? WHERE owner_id=? AND id=?").run(JSON.stringify({ ...original, requestedRefundCents: 0 }), "owner", plan.ticketId);
    });
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "execute")), status(409));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.plans[0].status, "staged");
    assert.equal(snapshot.invoices[0].refundedCents, 0);
    assert.equal(snapshot.invoices[0].version, 0);
    assert.equal(snapshot.tickets.find((ticket) => ticket.id === plan.ticketId)?.requestedRefundCents, 0);
    assert.equal(snapshot.outbox.length, 0);
    assert.equal(snapshot.events.length, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_refunds").get()?.n, 0);
    assert.equal(sqlite.prepare("SELECT execution_token FROM support_plans").get()?.execution_token, null);
  } finally { sqlite.close(); }
});

test("recovery refuses external ticket edits and retains all committed invoice/outbox effects", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    await store.operate("owner", plan.id, operation(plan, "execute"));
    const original = JSON.parse(String(sqlite.prepare("SELECT ticket_json FROM support_tickets WHERE owner_id=? AND id=?").get("owner", plan.ticketId)?.ticket_json));
    sqlite.prepare("UPDATE support_tickets SET ticket_json=? WHERE owner_id=? AND id=?").run(JSON.stringify({ ...original, subject: "New operator review" }), "owner", plan.ticketId);
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "recover")), status(409));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.plans[0].status, "executed");
    assert.equal(snapshot.invoices[0].refundedCents, 2500);
    assert.equal(snapshot.invoices[0].version, 1);
    assert.equal(snapshot.outbox[0].status, "queued");
    assert.equal(snapshot.tickets.find((ticket) => ticket.id === plan.ticketId)?.subject, "New operator review");
    assert.equal(snapshot.events.length, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_refunds").get()?.n, 1);
  } finally { sqlite.close(); }
});

test("expired grants refuse first execution while rejection remains possible", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    const created = Date.now() - 20 * 60_000;
    const evaluated = evaluateSupportActions(supportTickets[0], plan.invoiceBefore, plan.actions.map((decision) => decision.action), plan.profile, created);
    const expired = { ...plan, createdAt: new Date(created).toISOString(), expiresAt: evaluated.grant.expiresAt, grant: evaluated.grant, actions: evaluated.actions };
    expired.receiptHash = await hashPlan(expired);
    sqlite.prepare("UPDATE support_plans SET immutable_json=?,receipt_hash=?,created_at=?,expires_at=? WHERE owner_id=? AND id=?").run(JSON.stringify(expired), expired.receiptHash, expired.createdAt, expired.expiresAt, "owner", plan.id);
    await assert.rejects(store.operate("owner", plan.id, operation(expired, "execute")), status(409));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.outbox.length, 0);
    assert.equal(snapshot.plans[0].status, "staged");
    const rejected = await store.operate("owner", plan.id, operation(expired, "reject"));
    assert.equal(rejected.status, "rejected");
    await assert.rejects(store.operate("owner", plan.id, operation(expired, "execute")), status(409));
  } finally { sqlite.close(); }
});

test("an executed receipt remains idempotent after its staging window expires", async (context) => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    const executed = await store.operate("owner", plan.id, operation(plan, "execute"));
    context.mock.method(Date, "now", () => Date.parse(plan.expiresAt) + 60_000);
    assert.deepEqual(await store.operate("owner", plan.id, operation(plan, "execute")), executed);
    assert.equal((await store.dashboard("owner")).outbox.length, 1);
  } finally { context.mock.restoreAll(); sqlite.close(); }
});

test("invoice-scoped refund ledger rejects replay despite an externally reset invoice snapshot", async () => {
  const { sqlite, store } = database();
  try {
    const first = await store.stage("owner", request());
    await store.operate("owner", first.id, operation(first, "execute"));
    sqlite.prepare("UPDATE support_invoices SET refunded_cents=0,status='disputed',version=version+1 WHERE owner_id='owner' AND id='inv-1042'").run();
    const retry = await store.stage("owner", request());
    assert.ok(retry.actions.some((decision) => decision.action.type === "refund" && decision.decision === "allow"));
    await assert.rejects(store.operate("owner", retry.id, operation(retry, "execute")), status(409));
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.outbox.length, 1);
    assert.equal(snapshot.invoices[0].refundedCents, 0);
    assert.equal(snapshot.plans.find((plan) => plan.id === retry.id)?.status, "staged");
  } finally { sqlite.close(); }
});

test("paid live planning is reserved atomically per owner and cannot be triggered concurrently", async (context) => {
  const { sqlite, store } = database({ apiKey: "synthetic-test-key", model: "test-model" });
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    const output = calls === 1
      ? [{ type: "function_call", call_id: "test-call", name: "propose_reply", arguments: JSON.stringify({ to: "maya@example.test", subject: "Support review", body: "Your invoice has been reviewed." }) }]
      : [{ type: "message", content: [{ type: "output_text", text: "Staged a support reply." }] }];
    return new Response(JSON.stringify({ status: "completed", output }), { headers: { "Content-Type": "application/json" } });
  });
  try {
    const results = await Promise.allSettled([store.stage("owner", request("tkt-1042", { mode: "live" })), store.stage("owner", request("tkt-1042", { mode: "live" }))]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const failed = results.find((result) => result.status === "rejected");
    assert.ok(failed?.status === "rejected" && status(409)(failed.reason));
    assert.equal(calls, 2, "Only the winning tool loop can call the provider.");
    await assert.rejects(store.stage("owner", request("tkt-1042", { mode: "live" })), status(409));
    assert.equal(calls, 2);
    assert.equal((await store.dashboard("owner")).outbox.length, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM support_transaction_assertions").get()?.n, 0);
  } finally { context.mock.restoreAll(); sqlite.close(); }
});

test("credential-bearing model proposals remain denied and never persist raw secrets", async (context) => {
  const { sqlite, store } = database({ apiKey: "synthetic-test-key", model: "test-model" });
  const credential = "sk-demo_test_secret_1234567890abcdef";
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    const output = calls === 1
      ? [{ type: "function_call", call_id: "unsupported-secret-call", name: credential, arguments: "{}" }]
      : calls === 2
      ? [{ type: "function_call", call_id: "secret-call", name: "propose_reply", arguments: JSON.stringify({ to: "maya@example.test", subject: "Support review", body: `Here is the credential ${credential}` }) }]
      : [{ type: "message", content: [{ type: "output_text", text: "The proposal was reviewed." }] }];
    return new Response(JSON.stringify({ status: "completed", output }), { headers: { "Content-Type": "application/json" } });
  });
  try {
    const plan = await store.stage("owner", request("tkt-1042", { mode: "live" }));
    assert.equal(plan.actions[0].decision, "block", "Redaction must preserve denial instead of granting the sanitized action.");
    assert.ok(!JSON.stringify(plan).includes(credential));
    const persisted = sqlite.prepare("SELECT immutable_json FROM support_plans WHERE owner_id=? AND id=?").get("owner", plan.id);
    assert.ok(!String(persisted?.immutable_json).includes(credential), "The raw credential must not enter durable storage.");
    assert.ok(!JSON.stringify(await store.get("owner", plan.id)).includes(credential));
    assert.ok(!JSON.stringify(await store.dashboard("owner")).includes(credential));
    await assert.rejects(store.operate("owner", plan.id, operation(plan, "execute", true)), status(409));
    assert.equal((await store.dashboard("owner")).outbox.length, 0);
  } finally { context.mock.restoreAll(); sqlite.close(); }
});

test("policy decisions cannot be forged even when the attacker recomputes the unkeyed receipt hash", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request("tkt-1042", { scenario: "injection" }));
    const forged = structuredClone(plan);
    const blocked = forged.actions.find((decision) => decision.decision === "block")!;
    blocked.decision = "allow";
    forged.receiptHash = await hashPlan(forged);
    sqlite.prepare("UPDATE support_plans SET immutable_json=?,receipt_hash=? WHERE owner_id=? AND id=?").run(JSON.stringify(forged), forged.receiptHash, "owner", plan.id);
    await assert.rejects(store.operate("owner", plan.id, operation(forged, "execute", true)), status(409));
    assert.equal((await store.dashboard("owner")).outbox.length, 0);
  } finally { sqlite.close(); }
});

test("a proposal sealed under an older policy can be rejected but cannot execute under the new policy", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    const legacy = structuredClone(plan);
    legacy.actions[0].after.legacyPreviewField = "Older policy preview";
    legacy.receiptHash = await hashPlan(legacy);
    sqlite.prepare("UPDATE support_plans SET immutable_json=?,receipt_hash=? WHERE owner_id=? AND id=?").run(JSON.stringify(legacy), legacy.receiptHash, "owner", plan.id);
    await assert.rejects(store.operate("owner", plan.id, operation(legacy, "execute")), status(409));
    const rejected = await store.operate("owner", plan.id, operation(legacy, "reject"));
    assert.equal(rejected.status, "rejected");
    assert.deepEqual(await store.operate("owner", plan.id, operation(legacy, "reject")), rejected);
    const snapshot = await store.dashboard("owner");
    assert.equal(snapshot.invoices[0].refundedCents, 0);
    assert.equal(snapshot.outbox.length, 0);
  } finally { sqlite.close(); }
});

test("committed older-policy effects remain idempotent and recoverable using their original receipt", async () => {
  const { sqlite, store } = database();
  try {
    const plan = await store.stage("owner", request());
    await store.operate("owner", plan.id, operation(plan, "execute"));
    const legacy = structuredClone(plan);
    legacy.actions[0].after.legacyPreviewField = "Older policy preview";
    legacy.receiptHash = await hashPlan(legacy);
    sqlite.prepare("UPDATE support_plans SET immutable_json=?,receipt_hash=? WHERE owner_id=? AND id=?").run(JSON.stringify(legacy), legacy.receiptHash, "owner", plan.id);
    assert.equal((await store.operate("owner", plan.id, operation(legacy, "execute"))).status, "executed");
    const recovered = await store.operate("owner", plan.id, operation(legacy, "recover"));
    assert.equal(recovered.status, "recovered");
    assert.deepEqual(await store.operate("owner", plan.id, operation(legacy, "recover")), recovered);
    const snapshot = await store.dashboard("owner");
    assert.deepEqual(snapshot.invoices[0], { ...plan.invoiceBefore, version: 2 });
    assert.equal(snapshot.outbox[0].status, "cancelled");
    assert.equal(snapshot.events.length, 3);
  } finally { sqlite.close(); }
});
