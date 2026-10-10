import { buildSupportPlan } from "./agent";
import { supportInvoices, supportTickets } from "./fixtures";
import { canonicalJson, evaluateSupportActions, hashPlan, verifyPlan } from "./policy";
import type { OutboxMessage, PlanRequest, SupportAuditEvent, SupportDashboard, SupportInvoice, SupportPlan, SupportTicket } from "./types";

export class SupportStoreError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "SupportStoreError"; }
}
export interface SupportStoreConfig { apiKey?: string; model: string }
export interface PlanOperation { operation: "execute" | "reject" | "recover"; receiptHash: string; approve: boolean }

interface InvoiceRow {
  id: string; tenant_id: string; customer_id: string; amount_cents: number;
  refunded_cents: number; refundable_cents: number; status: SupportInvoice["status"]; version: number;
}
interface PlanRow {
  immutable_json: string; receipt_hash: string; status: SupportPlan["status"]; approved: number;
  executed_at: string | null; recovered_at: string | null; invoice_after_json: string | null; ticket_before_json: string | null;
}

function invoiceFromRow(row: InvoiceRow): SupportInvoice {
  return { id: row.id, tenantId: row.tenant_id, customerId: row.customer_id, amountCents: row.amount_cents,
    refundedCents: row.refunded_cents, refundableCents: row.refundable_cents, status: row.status, version: row.version };
}
function planFromRow(row: PlanRow): SupportPlan {
  return { ...JSON.parse(row.immutable_json) as SupportPlan, status: row.status, approved: Boolean(row.approved),
    executedAt: row.executed_at, recoveredAt: row.recovered_at,
    invoiceAfter: row.invoice_after_json ? JSON.parse(row.invoice_after_json) as SupportInvoice : null };
}
function validateOwner(owner: string) {
  if (!owner || owner.length > 200 || /[\u0000-\u001f\u007f]/.test(owner)) throw new SupportStoreError(401, "An authenticated visitor is required.");
}

/** No memory-only persistence: every lifecycle transition and connector effect is a D1 transaction. */
export function createSupportStore(db: D1Database, config: SupportStoreConfig) {
  const prepare = (sql: string, ...values: (string | number | null)[]) => db.prepare(sql).bind(...values);
  const assertion = (token: string, expression: string, ...values: (string | number | null)[]) =>
    prepare(`INSERT INTO support_transaction_assertions(token, passed) VALUES (?, ${expression})`, token, ...values);
  const event = (owner: string, planId: string, at: string, name: string, detail: string) =>
    prepare("INSERT INTO support_events(owner_id,id,plan_id,at,event,detail) VALUES (?,?,?,?,?,?)", owner, crypto.randomUUID(), planId, at, name, detail);

  async function seed(owner: string) {
    validateOwner(owner);
    await db.batch([
      ...supportTickets.map((ticket) => prepare("INSERT OR IGNORE INTO support_tickets(owner_id,id,ticket_json) VALUES (?,?,?)", owner, ticket.id, JSON.stringify(ticket))),
      ...supportInvoices.map((invoice) => prepare("INSERT OR IGNORE INTO support_invoices(owner_id,id,tenant_id,customer_id,amount_cents,refunded_cents,refundable_cents,status,version) VALUES (?,?,?,?,?,?,?,?,?)",
        owner, invoice.id, invoice.tenantId, invoice.customerId, invoice.amountCents, invoice.refundedCents, invoice.refundableCents, invoice.status, invoice.version)),
    ]);
  }
  async function getTicketSnapshot(owner: string, id: string): Promise<{ ticket: SupportTicket; json: string } | null> {
    const row = await prepare("SELECT ticket_json FROM support_tickets WHERE owner_id=? AND id=?", owner, id).first<{ ticket_json: string }>();
    return row ? { ticket: JSON.parse(row.ticket_json) as SupportTicket, json: row.ticket_json } : null;
  }
  async function getTicket(owner: string, id: string): Promise<SupportTicket | null> {
    return (await getTicketSnapshot(owner, id))?.ticket ?? null;
  }
  async function getInvoice(owner: string, id: string): Promise<SupportInvoice | null> {
    const row = await prepare("SELECT * FROM support_invoices WHERE owner_id=? AND id=?", owner, id).first<InvoiceRow>();
    return row ? invoiceFromRow(row) : null;
  }
  async function getRow(owner: string, id: string): Promise<PlanRow | null> {
    validateOwner(owner);
    return prepare("SELECT * FROM support_plans WHERE owner_id=? AND id=?", owner, id).first<PlanRow>();
  }
  async function get(owner: string, id: string): Promise<SupportPlan | null> {
    const row = await getRow(owner, id);
    return row ? planFromRow(row) : null;
  }

  async function dashboard(owner: string): Promise<SupportDashboard> {
    await seed(owner);
    const [tickets, invoices, plans, outbox, events] = await Promise.all([
      prepare("SELECT ticket_json FROM support_tickets WHERE owner_id=? ORDER BY id", owner).all<{ ticket_json: string }>(),
      prepare("SELECT * FROM support_invoices WHERE owner_id=? ORDER BY id", owner).all<InvoiceRow>(),
      prepare("SELECT * FROM support_plans WHERE owner_id=? ORDER BY created_at DESC, id DESC LIMIT 100", owner).all<PlanRow>(),
      prepare("SELECT id,plan_id AS planId,recipient AS 'to',subject,body,created_at AS createdAt,status FROM support_outbox WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 100", owner).all<OutboxMessage>(),
      prepare("SELECT id,plan_id AS planId,at,event,detail FROM support_events WHERE owner_id=? ORDER BY at DESC,id DESC LIMIT 200", owner).all<SupportAuditEvent>(),
    ]);
    return { tickets: tickets.results.map((row) => JSON.parse(row.ticket_json) as SupportTicket), invoices: invoices.results.map(invoiceFromRow),
      plans: plans.results.map(planFromRow), outbox: outbox.results, events: events.results,
      config: { liveAvailable: Boolean(config.apiKey), model: config.model, sandbox: true } };
  }

  async function stage(owner: string, request: PlanRequest): Promise<SupportPlan> {
    await seed(owner);
    const ticket = await getTicket(owner, request.ticketId);
    if (!ticket) throw new SupportStoreError(404, "Support ticket was not found.");
    const invoice = await getInvoice(owner, ticket.invoiceId);
    if (!invoice || invoice.tenantId !== ticket.tenantId || invoice.customerId !== ticket.customerId) throw new SupportStoreError(409, "Trusted ticket and invoice scope do not match.");
    if (request.mode === "live" && !config.apiKey) throw new SupportStoreError(503, "Live mode requires a server-configured OpenAI API key. Replay remains available.");
    if (request.mode === "live") {
      const token = crypto.randomUUID();
      const now = new Date().toISOString();
      const cooldown = new Date(Date.now() + 75_000).toISOString();
      try {
        await db.batch([
          prepare("INSERT INTO support_live_reservations(owner_id,token,expires_at) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE support_live_reservations.expires_at<=?", owner, token, cooldown, now),
          assertion(`${token}:live`, "EXISTS(SELECT 1 FROM support_live_reservations WHERE owner_id=? AND token=?)", owner, token),
          prepare("DELETE FROM support_transaction_assertions WHERE token=?", `${token}:live`),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (/CHECK constraint|support_transaction_assertions|constraint failed/i.test(message)) throw new SupportStoreError(409, "Live planning is already running or in its 75-second cooldown. Replay remains available.");
        throw new SupportStoreError(503, "A durable live planning reservation could not be created.");
      }
    }
    const plan = await buildSupportPlan(ticket, invoice, request, config);
    if (plan.ticketId !== ticket.id || !(await verifyPlan(plan))) throw new SupportStoreError(503, "The proposed plan failed its integrity check.");
    await db.batch([
      prepare("INSERT INTO support_plans(owner_id,id,ticket_id,created_at,expires_at,receipt_hash,immutable_json,status,approved) VALUES (?,?,?,?,?,?,?,?,0)",
        owner, plan.id, ticket.id, plan.createdAt, plan.expiresAt, plan.receiptHash, JSON.stringify(plan), "staged"),
      event(owner, plan.id, plan.createdAt, "plan_staged", `Staged ${plan.actions.length} actions; ${plan.actions.filter((action) => action.decision === "block").length} blocked by policy. No connector ran.`),
    ]);
    return plan;
  }

  async function operate(owner: string, id: string, input: PlanOperation): Promise<SupportPlan> {
    const row = await getRow(owner, id);
    if (!row) throw new SupportStoreError(404, "Support plan was not found.");
    const plan = planFromRow(row);
    if (input.receiptHash !== row.receipt_hash || plan.receiptHash !== row.receipt_hash || await hashPlan(plan) !== row.receipt_hash) throw new SupportStoreError(409, "The plan receipt does not match its immutable proposal.");
    if (input.operation === "execute" && plan.status === "executed") return plan;
    if (input.operation === "recover" && plan.status === "recovered") return plan;
    if (input.operation === "reject" && plan.status === "rejected") return plan;
    const at = new Date().toISOString();
    const token = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [];
    const claim = (expected: SupportPlan["status"]) => prepare("UPDATE support_plans SET execution_token=? WHERE owner_id=? AND id=? AND status=? AND receipt_hash=? AND execution_token IS NULL AND (?=0 OR julianday(expires_at)>julianday('now'))", token, owner, id, expected, input.receiptHash, input.operation === "execute" ? 1 : 0);
    const claimGuard = () => assertion(`${token}:claim`, "EXISTS(SELECT 1 FROM support_plans WHERE owner_id=? AND id=? AND execution_token=?)", owner, id, token);
    const invoiceGuard = (invoice: SupportInvoice) => assertion(`${token}:invoice`, "EXISTS(SELECT 1 FROM support_invoices WHERE owner_id=? AND id=? AND tenant_id=? AND customer_id=? AND version=? AND amount_cents=? AND refunded_cents=? AND refundable_cents=? AND status=?)",
      owner, invoice.id, invoice.tenantId, invoice.customerId, invoice.version, invoice.amountCents, invoice.refundedCents, invoice.refundableCents, invoice.status);
    const ticketGuard = (ticketId: string, json: string) => assertion(`${token}:ticket`, "EXISTS(SELECT 1 FROM support_tickets WHERE owner_id=? AND id=? AND ticket_json=?)", owner, ticketId, json);
    let resultInvoice: SupportInvoice | null = null;

    if (input.operation === "reject") {
      if (plan.status !== "staged") throw new SupportStoreError(409, "Only a staged plan can be rejected.");
      statements.push(claim("staged"), claimGuard(),
        prepare("UPDATE support_plans SET status='rejected',execution_token=NULL WHERE owner_id=? AND id=? AND execution_token=?", owner, id, token),
        event(owner, id, at, "plan_rejected", "Reviewer rejected the staged proposal. No connector ran."));
    } else if (input.operation === "execute") {
      if (plan.status !== "staged") throw new SupportStoreError(409, "Only a staged plan can be executed.");
      // Executing a new effect must satisfy today's policy. Rejecting a proposal
      // and compensating an already committed sandbox transaction instead rely
      // on its original immutable receipt and trusted durable state, so a policy
      // update cannot strand old proposals or prevent recovery.
      if (Date.parse(plan.expiresAt) <= Date.now() || !(await verifyPlan(plan))) throw new SupportStoreError(409, "The task grant expired or is no longer valid. Stage a new plan.");
      const permitted = plan.actions.filter((decision) => decision.decision !== "block");
      if (!permitted.length) throw new SupportStoreError(409, "This plan has no permitted actions to execute.");
      const needsApproval = permitted.some((decision) => decision.decision === "approval_required");
      if (needsApproval && !input.approve) throw new SupportStoreError(403, "Explicit approval is required for this exact plan receipt.");
      const snapshot = await getTicketSnapshot(owner, plan.ticketId);
      if (!snapshot) throw new SupportStoreError(409, "The trusted ticket is no longer available.");
      const ticket = snapshot.ticket;
      // Re-derive the resulting state from the trusted policy and permitted raw
      // actions; model text and client-supplied lifecycle state have no authority.
      const evaluated = evaluateSupportActions(ticket, plan.invoiceBefore, permitted.map((decision) => decision.action), plan.profile, Date.parse(plan.createdAt));
      if (canonicalJson(evaluated.grant) !== canonicalJson(plan.grant)) throw new SupportStoreError(409, "The trusted ticket entitlement changed. Stage a new proposal.");
      if (evaluated.actions.some((decision) => decision.decision === "block")) throw new SupportStoreError(409, "Current trusted policy no longer permits this plan.");
      resultInvoice = evaluated.invoiceAfter;
      const writesInvoice = permitted.some((decision) => decision.action.type === "refund" || decision.action.type === "update_invoice");
      resultInvoice = { ...resultInvoice, version: plan.invoiceBefore.version + (writesInvoice ? 1 : 0) };
      statements.push(claim("staged"), claimGuard(), invoiceGuard(plan.invoiceBefore), ticketGuard(ticket.id, snapshot.json));
      const refund = permitted.find((decision) => decision.action.type === "refund")?.action;
      if (refund?.type === "refund") statements.push(prepare("INSERT INTO support_refunds(owner_id,invoice_id,plan_id,amount_cents,created_at) VALUES (?,?,?,?,?)", owner, plan.invoiceBefore.id, id, refund.amountCents, at));
      if (writesInvoice) {
        statements.push(prepare("UPDATE support_invoices SET refunded_cents=?,refundable_cents=?,status=?,version=? WHERE owner_id=? AND id=? AND version=?", resultInvoice.refundedCents, resultInvoice.refundableCents, resultInvoice.status, resultInvoice.version, owner, resultInvoice.id, plan.invoiceBefore.version),
          assertion(`${token}:write`, "changes()"));
      }
      for (const decision of permitted) {
        if (decision.action.type === "send_reply") {
          const action = decision.action;
          statements.push(prepare("INSERT INTO support_outbox(owner_id,id,plan_id,recipient,subject,body,created_at,status) VALUES (?,?,?,?,?,?,?,'queued')", owner, `${id}:${action.id}`, id, action.to, action.subject, action.body, at));
        }
      }
      const ticketAfter = { ...ticket, status: resultInvoice.status === "resolved" ? "resolved" as const : ticket.status };
      statements.push(prepare("UPDATE support_tickets SET ticket_json=? WHERE owner_id=? AND id=?", JSON.stringify(ticketAfter), owner, ticket.id),
        prepare("UPDATE support_plans SET status='executed',approved=?,executed_at=?,invoice_after_json=?,ticket_before_json=?,execution_token=NULL WHERE owner_id=? AND id=? AND execution_token=?", needsApproval && input.approve ? 1 : 0, at, JSON.stringify(resultInvoice), snapshot.json, owner, id, token),
        event(owner, id, at, "plan_executed", `Executed ${permitted.length} permitted actions atomically; skipped ${plan.actions.length - permitted.length} blocked actions. Replies remain in the sandbox outbox.`));
    } else {
      if (plan.status !== "executed" || !plan.invoiceAfter || !row.ticket_before_json) throw new SupportStoreError(409, "Only an executed plan can be recovered.");
      const writesInvoice = plan.actions.some((decision) => decision.decision !== "block" && (decision.action.type === "refund" || decision.action.type === "update_invoice"));
      resultInvoice = { ...plan.invoiceBefore, version: plan.invoiceAfter.version + (writesInvoice ? 1 : 0) };
      const ticketBefore = JSON.parse(row.ticket_before_json) as SupportTicket;
      const ticketAfter = { ...ticketBefore, status: plan.invoiceAfter.status === "resolved" ? "resolved" as const : ticketBefore.status };
      statements.push(claim("executed"), claimGuard(), invoiceGuard(plan.invoiceAfter), ticketGuard(plan.ticketId, JSON.stringify(ticketAfter)));
      if (writesInvoice) statements.push(prepare("UPDATE support_invoices SET refunded_cents=?,refundable_cents=?,status=?,version=? WHERE owner_id=? AND id=? AND version=?", resultInvoice.refundedCents, resultInvoice.refundableCents, resultInvoice.status, resultInvoice.version, owner, resultInvoice.id, plan.invoiceAfter.version), assertion(`${token}:write`, "changes()"));
      statements.push(prepare("DELETE FROM support_refunds WHERE owner_id=? AND plan_id=?", owner, id),
        prepare("UPDATE support_outbox SET status='cancelled' WHERE owner_id=? AND plan_id=? AND status='queued'", owner, id),
        prepare("UPDATE support_tickets SET ticket_json=? WHERE owner_id=? AND id=?", row.ticket_before_json, owner, plan.ticketId),
        prepare("UPDATE support_plans SET status='recovered',recovered_at=?,execution_token=NULL WHERE owner_id=? AND id=? AND execution_token=?", at, owner, id, token),
        event(owner, id, at, "plan_recovered", writesInvoice ? "Compensated supported invoice changes and cancelled queued sandbox replies. Invoice version advanced to invalidate older plans." : "Cancelled queued sandbox replies. This plan made no invoice changes."));
    }
    statements.push(prepare("DELETE FROM support_transaction_assertions WHERE token IN (?,?,?,?)", `${token}:claim`, `${token}:invoice`, `${token}:write`, `${token}:ticket`));
    try { await db.batch(statements); } catch (error) {
      // A concurrent identical operation can finish while this caller is waiting.
      // Returning that committed result is safe; never issue the connectors again.
      const current = await get(owner, id);
      const target = input.operation === "execute" ? "executed" : input.operation === "recover" ? "recovered" : "rejected";
      if (current?.status === target) return current;
      const message = error instanceof Error ? error.message : "";
      if (/CHECK constraint|UNIQUE constraint|support_transaction_assertions|constraint failed/i.test(message)) throw new SupportStoreError(409, "The plan state, ticket, or invoice changed. Refresh and stage a new proposal; no partial actions were committed.");
      throw new SupportStoreError(503, "The durable transaction could not be completed. No partial actions were committed.");
    }
    const committed = await get(owner, id);
    if (!committed) throw new SupportStoreError(503, "The committed plan could not be read.");
    return committed;
  }
  return { dashboard, stage, get, operate };
}
