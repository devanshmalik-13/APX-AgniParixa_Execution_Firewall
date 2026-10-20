import type { ObserverEvidence } from "../observer/types";
import type { PlannerProvider } from "./provider-config";
import type { WebEvidence } from "../tinyfish/types";

export type InvoiceStatus = "open" | "disputed" | "resolved";
export type AgentMode = "replay" | "live" | "external";
export type Scenario = "normal" | "injection" | "over-refund" | "cross-tenant" | "duplicate-refund";
export type PolicyProfile = "standard" | "strict";

export interface SupportTicket {
  id: string; tenantId: string; customerId: string; invoiceId: string;
  customerName: string; customerEmail: string; subject: string; body: string;
  requestedRefundCents: number; status: "open" | "resolved";
}
export interface SupportInvoice {
  id: string; tenantId: string; customerId: string; amountCents: number;
  refundedCents: number; refundableCents: number; status: InvoiceStatus; version: number;
}
export interface TaskGrant {
  ticketId: string; tenantId: string; customerId: string; invoiceId: string;
  recipient: string; maxRefundCents: number; autoRefundCents: number;
  expiresAt: string; maxActions: number; profile: PolicyProfile;
}
export type SupportAction = (
  | { id: string; type: "update_invoice"; invoiceId: string; status: InvoiceStatus }
  | { id: string; type: "refund"; invoiceId: string; amountCents: number }
  | { id: string; type: "send_reply"; to: string; subject: string; body: string }
  | { id: string; type: "export_customers"; tenantId: string; destination: string }
) & { redacted?: true };
export interface ActionDecision {
  action: SupportAction; decision: "allow" | "approval_required" | "block";
  reasons: string[]; before: Record<string, unknown>; after: Record<string, unknown>;
  reversible: boolean;
}
export interface AgentTrace {
  step: number; tool: string; decision: string; detail: string;
}
export interface SupportPlan {
  id: string; ticketId: string; createdAt: string; expiresAt: string;
  mode: AgentMode; model: string; scenario: Scenario; profile: PolicyProfile;
  summary: string; grant: TaskGrant; invoiceBefore: SupportInvoice;
  actions: ActionDecision[]; trace: AgentTrace[]; receiptHash: string;
  status: "staged" | "executed" | "recovered" | "rejected";
  approved: boolean; executedAt: string | null; recoveredAt: string | null;
  invoiceAfter: SupportInvoice | null; latencyMs: number;
  /** Advisory model evidence, sealed with the proposal; never execution authority. */
  observer?: ObserverEvidence;
  /** Optional for compatibility with earlier immutable receipts. */
  provider?: PlannerProvider;
  webEvidence?: WebEvidence;
}
export interface OutboxMessage {
  id: string; planId: string; to: string; subject: string; body: string;
  createdAt: string; status: "queued" | "cancelled";
}
export interface SupportAuditEvent {
  id: string; planId: string; at: string; event: string; detail: string;
}
export interface SupportDashboard {
  tickets: SupportTicket[]; invoices: SupportInvoice[]; plans: SupportPlan[];
  outbox: OutboxMessage[]; events: SupportAuditEvent[];
  config: { liveAvailable: boolean; provider: PlannerProvider; model: string; sandbox: true };
}
export interface PlanRequest {
  ticketId: string; mode: Exclude<AgentMode, "external">; scenario: Scenario; profile: PolicyProfile; note?: string; webEvidenceId?: string;
}
/** An external agent supplies proposals only, never authority or approval. */
export interface ExternalProposalRequest { ticketId: string; actions: SupportAction[] }
