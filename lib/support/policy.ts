import { z } from "zod";
import { scanForSecrets } from "../security/secret-scanner";
import { redactAuditValue } from "../security/audit-redaction";
import { supportTickets } from "./fixtures";
import type { ActionDecision, PolicyProfile, SupportAction, SupportInvoice, SupportPlan, SupportTicket, TaskGrant } from "./types";

const boundedId = z.string().min(1).max(100);
const redacted = z.literal(true).optional();
export const supportActionSchema = z.discriminatedUnion("type", [
  z.object({ id: boundedId, type: z.literal("update_invoice"), invoiceId: boundedId, status: z.enum(["open", "disputed", "resolved"]), redacted }).strict(),
  z.object({ id: boundedId, type: z.literal("refund"), invoiceId: boundedId, amountCents: z.number().int().positive().max(100_000_000), redacted }).strict(),
  z.object({ id: boundedId, type: z.literal("send_reply"), to: z.string().email().max(254), subject: z.string().min(1).max(200), body: z.string().min(1).max(6000), redacted }).strict(),
  z.object({ id: boundedId, type: z.literal("export_customers"), tenantId: boundedId, destination: z.string().min(1).max(300), redacted }).strict(),
]);

export function createGrant(ticket: SupportTicket, invoice: SupportInvoice, profile: PolicyProfile, now = Date.now()): TaskGrant {
  return {
    ticketId: ticket.id, tenantId: ticket.tenantId, customerId: ticket.customerId,
    invoiceId: ticket.invoiceId, recipient: ticket.customerEmail,
    maxRefundCents: Math.max(0, Math.min(ticket.requestedRefundCents, invoice.refundableCents - invoice.refundedCents, 10000)),
    autoRefundCents: profile === "strict" ? 0 : 5000,
    maxActions: 8, expiresAt: new Date(now + 15 * 60 * 1000).toISOString(), profile,
  };
}

/** A model only proposes. All authority is derived from the assigned ticket. */
export function evaluateSupportActions(ticket: SupportTicket, invoice: SupportInvoice, proposals: SupportAction[], profile: PolicyProfile, now = Date.now()) {
  const grant = createGrant(ticket, invoice, profile, now);
  const projection = { ...invoice };
  const seenIds = new Set<string>();
  const seenTypes = new Set<string>();
  let mutated = false;
  const actions: ActionDecision[] = proposals.map((action, index) => {
    const reasons: string[] = [];
    let needsApproval = profile === "strict";
    let before: Record<string, unknown> = {};
    let after: Record<string, unknown> = {};
    const parsed = supportActionSchema.safeParse(action);
    if (!parsed.success) reasons.push("Invalid tool arguments; the action cannot be dispatched.");
    if (action.redacted) reasons.push("Sensitive values were removed before persistence. This denied proposal cannot execute.");
    if (ticket.invoiceId !== invoice.id || ticket.tenantId !== invoice.tenantId || ticket.customerId !== invoice.customerId) reasons.push("Trusted ticket and invoice scope do not match.");
    if (index >= grant.maxActions) reasons.push("Task action budget exceeded.");
    if (seenIds.has(action.id)) reasons.push("Duplicate action identifier.");
    seenIds.add(action.id);
    if (seenTypes.has(action.type)) reasons.push("Only one action of each type is permitted in a support transaction.");
    // Only valid permitted actions consume a type slot, so an attacker cannot
    // suppress a following legitimate action by proposing a blocked one first.
    if (action.type === "export_customers") reasons.push("Bulk customer export is outside this ticket's capabilities.");
    if (action.type === "refund" || action.type === "update_invoice") {
      if (action.invoiceId !== grant.invoiceId) reasons.push("Invoice is outside the assigned customer and tenant scope.");
      if (action.type === "refund") {
        before = { refundedCents: projection.refundedCents };
        after = { refundedCents: projection.refundedCents + action.amountCents };
        if (invoice.refundedCents > 0) reasons.push("This invoice already has a refund; a new support task cannot repeat it.");
        if (action.amountCents > grant.maxRefundCents || projection.refundedCents + action.amountCents > invoice.refundableCents || projection.refundedCents + action.amountCents > invoice.amountCents) reasons.push("Refund exceeds the trusted ticket entitlement or invoice balance.");
        needsApproval ||= action.amountCents > grant.autoRefundCents;
      } else {
        before = { status: projection.status };
        after = { status: action.status };
        if (action.status !== "resolved" || invoice.status === "resolved") reasons.push("Only an unresolved invoice may transition to resolved for this task.");
      }
    }
    if (action.type === "send_reply") {
      before = { outbox: "No reply queued" };
      after = { outbox: "Sandbox reply queued", to: action.to, subject: action.subject, body: action.body };
      // Exact equality prevents display-name, comma-separated and Unicode
      // lookalike destinations from inheriting the trusted customer address.
      if (action.to !== grant.recipient) reasons.push("Reply destination is not the original ticket requester.");
      if (/[\r\n]/.test(action.subject) || /[\r\n]/.test(action.to)) reasons.push("Mail header injection is forbidden.");
      if (scanForSecrets(`${action.subject}\n${action.body}`).length) reasons.push("Recognizable credentials or sensitive payment data cannot enter the reply outbox.");
    }
    const decision = reasons.length ? "block" : needsApproval ? "approval_required" : "allow";
    if (decision !== "block") {
      seenTypes.add(action.type);
      if (action.type === "refund") { projection.refundedCents += action.amountCents; mutated = true; }
      if (action.type === "update_invoice") { projection.status = action.status; mutated = true; }
    }
    return { action, decision, reasons: reasons.length ? reasons : [needsApproval ? "Exact action requires operator approval under this task's policy." : "Within the server-owned ticket capability."], before, after, reversible: action.type !== "export_customers" } satisfies ActionDecision;
  });
  if (mutated) projection.version += 1;
  return { grant, actions, invoiceAfter: projection };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
/** Redaction cannot turn a denied proposal into a newly authorized action. */
export function sanitizeSupportAction(action: SupportAction): SupportAction {
  const safe = redactAuditValue(action) as SupportAction;
  return canonicalJson(safe) === canonicalJson(action) ? safe : { ...safe, redacted: true };
}
function receiptPayload(plan: SupportPlan) {
  return { id: plan.id, ticketId: plan.ticketId, createdAt: plan.createdAt, expiresAt: plan.expiresAt, mode: plan.mode, model: plan.model, scenario: plan.scenario, profile: plan.profile, summary: plan.summary, grant: plan.grant, invoiceBefore: plan.invoiceBefore, actions: plan.actions, trace: plan.trace, latencyMs: plan.latencyMs,
    // Old receipts keep their exact payload. New evidence cannot be silently replaced.
    ...(plan.observer === undefined ? {} : { observer: plan.observer }) };
}
export async function hashPlan(plan: SupportPlan): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(receiptPayload(plan))));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyPlan(plan: SupportPlan, now = Date.now()): Promise<boolean> {
  try {
    const ticket = supportTickets.find((t) => t.id === plan.ticketId);
    const created = Date.parse(plan.createdAt);
    if (!ticket || !Number.isFinite(created) || now >= Date.parse(plan.expiresAt) || created > now || !["standard", "strict"].includes(plan.profile) || !["replay", "live", "external"].includes(plan.mode)) return false;
    if (plan.mode === "external" && (plan.profile !== "strict" || plan.model !== "external-proposal-v1")) return false;
    const expected = evaluateSupportActions(ticket, plan.invoiceBefore, plan.actions.map((a) => a.action), plan.profile, created);
    return plan.expiresAt === expected.grant.expiresAt && canonicalJson(plan.grant) === canonicalJson(expected.grant) && canonicalJson(plan.actions) === canonicalJson(expected.actions) && plan.receiptHash === await hashPlan(plan);
  } catch { return false; }
}
