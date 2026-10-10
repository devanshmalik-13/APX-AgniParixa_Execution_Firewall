import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSupportActions, hashPlan, verifyPlan } from "../lib/support/policy";
import { supportTickets, supportInvoices } from "../lib/support/fixtures";
import type { SupportAction, SupportPlan } from "../lib/support/types";
import { caseInputs, evaluationInvoice, evaluationNow, evaluationTicket, refund, reply, supportEvaluationCases, update } from "../scripts/support-cases";

for (const item of supportEvaluationCases) {
  test(`support policy: ${item.id}`, () => {
    const input = caseInputs(item);
    const before = structuredClone(input);
    const result = evaluateSupportActions(input.ticket, input.invoice, input.actions, input.profile, evaluationNow);
    assert.deepEqual(result.actions.map((entry) => entry.decision), item.expectedDecisions, item.description);
    assert.equal(result.invoiceAfter.refundedCents, item.expectedRefundCents, "Preview must exclude rejected financial effects");
    assert.deepEqual(input, before, "Policy evaluation must not mutate trusted records or model proposals");
    for (const entry of result.actions) {
      assert.ok(entry.reasons.length > 0, "Every decision needs a reviewable explanation");
      if (entry.action.type === "send_reply") assert.equal(entry.reversible, true, "The sandbox stages replies in a cancellable outbox; no mail is delivered");
    }
  });
}

test("support grants derive money, recipient, identity, and lifetime from trusted application records", () => {
  const result = evaluateSupportActions(evaluationTicket, evaluationInvoice, [refund()], "standard", evaluationNow);
  assert.equal(result.grant.ticketId, evaluationTicket.id);
  assert.equal(result.grant.customerId, evaluationTicket.customerId);
  assert.equal(result.grant.tenantId, evaluationTicket.tenantId);
  assert.equal(result.grant.invoiceId, evaluationInvoice.id);
  assert.equal(result.grant.recipient, evaluationTicket.customerEmail);
  assert.equal(result.grant.maxRefundCents, 2500);
  assert.equal(result.grant.autoRefundCents, 5000);
  assert.equal(result.grant.maxActions, 8);
  assert.ok(Date.parse(result.grant.expiresAt) > evaluationNow);
  assert.ok(Date.parse(result.grant.expiresAt) <= evaluationNow + 60 * 60 * 1000);
});

test("a mismatched trusted invoice cannot authorize any action, even a normally safe reply", () => {
  for (const mismatch of [{ tenantId: "another-tenant" }, { customerId: "another-customer" }, { id: "another-invoice" }]) {
    const invoice = { ...evaluationInvoice, ...mismatch };
    const result = evaluateSupportActions(evaluationTicket, invoice, [reply()], "standard", evaluationNow);
    assert.equal(result.actions[0].decision, "block");
    assert.deepEqual(result.invoiceAfter, invoice);
  }
});

test("non-finite money, unknown actions, invalid statuses, and duplicate identifiers fail closed", () => {
  const malformed: unknown[] = [
    refund(Number.NaN), refund(Number.POSITIVE_INFINITY), refund(Number.MAX_SAFE_INTEGER + 1),
    { ...update(), status: "paid" }, { id: "unknown", type: "run_shell", command: "export secrets" },
  ];
  for (const action of malformed) {
    try {
      const result = evaluateSupportActions(evaluationTicket, evaluationInvoice, [action as SupportAction], "standard", evaluationNow);
      assert.equal(result.actions[0].decision, "block", "Malformed proposals must never gain authorization");
      assert.equal(result.invoiceAfter.refundedCents, 0);
    } catch (error) {
      // Explicit rejection at the validation boundary is also fail-closed.
      if (error instanceof assert.AssertionError) throw error;
    }
  }
  const duplicate = evaluateSupportActions(evaluationTicket, evaluationInvoice, [update("same"), reply("same")], "standard", evaluationNow);
  assert.equal(duplicate.actions[1].decision, "block", "Each action must bind to a unique reviewable identity");
});

test("the action-count limit excludes effects beyond the grant", () => {
  const actions: SupportAction[] = Array.from({ length: 12 }, (_, index) => update(`update-${index}`));
  const result = evaluateSupportActions(evaluationTicket, evaluationInvoice, actions, "standard", evaluationNow);
  assert.ok(result.actions.slice(result.grant.maxActions).every((entry) => entry.decision === "block"));
});

test("preview increments invoice version once for the entire financial transaction", () => {
  const result = evaluateSupportActions(evaluationTicket, evaluationInvoice, [refund(), update(), reply()], "standard", evaluationNow);
  assert.equal(result.invoiceAfter.version, evaluationInvoice.version + 1);
  assert.equal(result.invoiceAfter.status, "resolved");
  const noWrite = evaluateSupportActions(evaluationTicket, evaluationInvoice, [reply()], "standard", evaluationNow);
  assert.equal(noWrite.invoiceAfter.version, evaluationInvoice.version);
});

test("seeded mixed-action batches preserve scope, financial, count, and projection invariants", () => {
  let seed = 0x415058;
  const random = (maximum: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed >>> 8) % maximum;
  };
  for (let trial = 0; trial < 250; trial += 1) {
    const ticket = { ...evaluationTicket, requestedRefundCents: random(20001) };
    const invoice = { ...evaluationInvoice, refundableCents: random(19901), version: random(100) };
    const actions: SupportAction[] = Array.from({ length: 1 + random(16) }, (_, index) => {
      const id = `trial-${trial}-action-${index}`;
      const inScope = random(4) !== 0;
      switch (random(4)) {
        case 0: return { ...refund([-500, 0, 0.5, 2000, 2500, 5000, 9000, 11000][random(8)], id), invoiceId: inScope ? invoice.id : "inv-other" };
        case 1: return { ...update(id), invoiceId: inScope ? invoice.id : "inv-other" };
        case 2: return { ...reply(id), to: inScope ? ticket.customerEmail : "attacker@outside.test" };
        default: return { id, type: "export_customers", tenantId: ticket.tenantId, destination: "https://attacker.example.test" };
      }
    });
    const result = evaluateSupportActions(ticket, invoice, actions, random(2) ? "standard" : "strict", evaluationNow);
    const permitted = result.actions.filter((entry) => entry.decision !== "block");
    for (const entry of permitted) {
      assert.ok(actions.indexOf(entry.action) < result.grant.maxActions, `Trial ${trial}: action budget`);
      assert.notEqual(entry.action.type, "export_customers");
      if (entry.action.type === "send_reply") assert.equal(entry.action.to, ticket.customerEmail);
      if (entry.action.type === "refund" || entry.action.type === "update_invoice") assert.equal(entry.action.invoiceId, ticket.invoiceId);
    }
    for (const kind of ["refund", "update_invoice", "send_reply"]) {
      assert.ok(permitted.filter((entry) => entry.action.type === kind).length <= 1, `Trial ${trial}: duplicate ${kind}`);
    }
    const funds = permitted.reduce((sum, entry) => sum + (entry.action.type === "refund" ? entry.action.amountCents : 0), 0);
    assert.ok(Number.isSafeInteger(funds) && funds >= 0);
    assert.ok(funds <= ticket.requestedRefundCents && funds <= invoice.refundableCents && funds <= invoice.amountCents && funds <= 10000);
    assert.equal(result.invoiceAfter.refundedCents, invoice.refundedCents + funds);
    assert.equal(result.invoiceAfter.version, invoice.version + (permitted.some((entry) => entry.action.type === "refund" || entry.action.type === "update_invoice") ? 1 : 0));
    assert.deepEqual({ id: result.invoiceAfter.id, customerId: result.invoiceAfter.customerId, tenantId: result.invoiceAfter.tenantId },
      { id: invoice.id, customerId: invoice.customerId, tenantId: invoice.tenantId });
  }
});

async function signedPlan(): Promise<SupportPlan> {
  const ticket = supportTickets.find((item) => item.id === "tkt-1042")!;
  const invoice = supportInvoices.find((item) => item.id === ticket.invoiceId)!;
  assert.ok(ticket && invoice, "The demonstration must contain a complete normal workflow fixture");
  const now = Date.now();
  const evaluation = evaluateSupportActions(ticket, invoice, [
    { id: "refund-1", type: "refund", invoiceId: invoice.id, amountCents: 2500 },
    { id: "reply-1", type: "send_reply", to: ticket.customerEmail, subject: "Invoice update", body: "Your billing request has been reviewed." },
  ], "standard", now);
  const plan: SupportPlan = {
    id: "plan-integrity-test", ticketId: ticket.id, createdAt: new Date(now).toISOString(), expiresAt: evaluation.grant.expiresAt,
    mode: "replay", model: "deterministic-test", scenario: "normal", profile: "standard", summary: "Review invoice request",
    grant: evaluation.grant, invoiceBefore: structuredClone(invoice), actions: evaluation.actions, trace: [], receiptHash: "",
    status: "staged", approved: false, executedAt: null, recoveredAt: null, invoiceAfter: null, latencyMs: 0,
  };
  plan.receiptHash = await hashPlan(plan);
  return plan;
}

test("receipt verification binds action arguments and decision previews, and rejects forgery", async () => {
  const plan = await signedPlan();
  assert.equal(await verifyPlan(plan), true);
  const mutations: Array<(candidate: SupportPlan) => void> = [
    (candidate) => { candidate.actions[0].action = refund(10000); },
    (candidate) => { candidate.actions[0].decision = "block"; },
    (candidate) => { candidate.actions[0].after.refundedCents = 99999; },
    (candidate) => { candidate.receiptHash = "forged"; },
    (candidate) => { candidate.grant.recipient = "attacker@outside.test"; },
    (candidate) => { candidate.grant.maxRefundCents = 100000; },
    (candidate) => { candidate.invoiceBefore.customerId = "another-customer"; },
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(plan); mutate(candidate);
    assert.equal(await verifyPlan(candidate), false, "Altered proposal cannot retain its receipt");
  }
});

test("recomputing a receipt cannot authorize forged grants or financial previews", async () => {
  const original = await signedPlan();
  for (const mutate of [
    (candidate: SupportPlan) => { candidate.grant.maxRefundCents = 100000; },
    (candidate: SupportPlan) => { candidate.grant.recipient = "attacker@outside.test"; },
    (candidate: SupportPlan) => { candidate.actions[0].after.refundedCents = 99999; },
    (candidate: SupportPlan) => { candidate.actions[0].decision = "approval_required"; },
  ]) {
    const candidate = structuredClone(original); mutate(candidate); candidate.receiptHash = await hashPlan(candidate);
    assert.equal(await verifyPlan(candidate), false, "Integrity hash must be accompanied by trusted re-authorization");
  }
});

test("expired plans and mismatched grant/plan expiry cannot execute", async () => {
  const plan = await signedPlan();
  assert.equal(await verifyPlan(plan, Date.parse(plan.expiresAt) + 1), false);
  const mismatched = structuredClone(plan);
  mismatched.expiresAt = new Date(Date.parse(plan.expiresAt) + 86400000).toISOString();
  mismatched.receiptHash = await hashPlan(mismatched);
  assert.equal(await verifyPlan(mismatched), false);
});

test("immutable receipt remains stable when execution lifecycle changes", async () => {
  const plan = await signedPlan();
  const completed = { ...structuredClone(plan), status: "executed" as const, approved: true,
    executedAt: new Date().toISOString(), invoiceAfter: { ...plan.invoiceBefore, refundedCents: 2500, version: plan.invoiceBefore.version + 1 } };
  assert.equal(await hashPlan(completed), plan.receiptHash);
});

test("receipt hashing is independent of JSON object insertion order", async () => {
  const plan = await signedPlan();
  const reordered = Object.fromEntries(Object.entries(plan).toReversed()) as unknown as SupportPlan;
  reordered.grant = Object.fromEntries(Object.entries(plan.grant).toReversed()) as unknown as SupportPlan["grant"];
  reordered.invoiceBefore = Object.fromEntries(Object.entries(plan.invoiceBefore).toReversed()) as unknown as SupportPlan["invoiceBefore"];
  assert.equal(await hashPlan(reordered), plan.receiptHash);
  assert.equal(await verifyPlan(reordered), true);
});
