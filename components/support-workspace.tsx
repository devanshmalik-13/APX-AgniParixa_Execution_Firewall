"use client";

import {
  ArrowDownToLine, ArrowRight, Check, ChevronDown, Clock3, Database,
  Eye, FileText, FlaskConical, Inbox, LoaderCircle, LockKeyhole, Mail,
  RefreshCw, RotateCcw, ShieldCheck, Sparkles, Ticket, X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { scenarioContent } from "@/lib/support/fixtures";
import type { ObserverEvidence } from "@/lib/observer/types";
import type {
  ActionDecision, PlanRequest, PolicyProfile, Scenario, SupportDashboard,
  SupportPlan, SupportTicket,
} from "@/lib/support/types";

const scenarios: { value: Scenario; title: string; description: string }[] = [
  { value: "normal", title: "Legitimate support task", description: "Resolve the customer's invoice request within its authorized scope." },
  { value: "injection", title: "Injected export instruction", description: "A hostile instruction in the source ticket attempts to export customer data." },
  { value: "over-refund", title: "Excessive refund", description: "The proposed refund exceeds this task's maximum authorized amount." },
  { value: "cross-tenant", title: "Another customer's invoice", description: "The agent attempts to change an invoice outside this ticket's scope." },
  { value: "duplicate-refund", title: "Repeated refund", description: "Two refund actions attempt to pay the same request twice." },
];

const workspacePanels = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "planner", label: "Planner", icon: Sparkles },
  { id: "review", label: "Review", icon: ShieldCheck },
  { id: "permissions", label: "Permissions", icon: LockKeyhole },
  { id: "trace", label: "Trace", icon: Database },
  { id: "activity", label: "Activity", icon: Clock3 },
] as const;
type WorkspacePanel = typeof workspacePanels[number]["id"];

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function timestamp(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

class SupportRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readResponse<T>(response: Response): Promise<T> {
  let result: T & { error?: string; reason?: string };
  try {
    result = await response.json();
  } catch {
    throw new SupportRequestError(`The server returned an unreadable response (${response.status}). Please retry.`, response.status);
  }
  if (!response.ok) throw new SupportRequestError(result.error ?? result.reason ?? `Request failed (${response.status}).`, response.status);
  return result;
}

export function SupportWorkspace() {
  const [panel, setPanel] = useState<WorkspacePanel>("inbox");
  const [dockPinned, setDockPinned] = useState(false);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dashboard, setDashboard] = useState<SupportDashboard | null>(null);
  const [ticketId, setTicketId] = useState("");
  const [plan, setPlan] = useState<SupportPlan | null>(null);
  const [mode, setMode] = useState<PlanRequest["mode"]>("replay");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [profile, setProfile] = useState<PolicyProfile>("standard");
  const [note, setNote] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState<string | null>("loading");
  const [error, setError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [notice, setNotice] = useState("");
  const [activityTab, setActivityTab] = useState<"history" | "outbox" | "audit">("history");
  const [clock, setClock] = useState(() => Date.now());
  const locked = useRef(false);
  const reviewRef = useRef<HTMLElement>(null);
  const plannerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [panel]);

  async function loadDashboard(signal?: AbortSignal) {
    const next = await readResponse<SupportDashboard>(await fetch("/api/support", { cache: "no-store", signal }));
    setDashboard(next);
    setAuthRequired(false);
    setTicketId((current) => current || next.tickets[0]?.id || "");
    return next;
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/support", { cache: "no-store", signal: controller.signal })
      .then((response) => readResponse<SupportDashboard>(response))
      .then(async (next) => {
        if (controller.signal.aborted) return;
        setDashboard(next);
        setTicketId((current) => current || next.tickets[0]?.id || "");
        setAuthRequired(false);
        const requestedPlanId = new URLSearchParams(window.location.search).get("plan");
        if (requestedPlanId) {
          const selected = next.plans.find((item) => item.id === requestedPlanId)
            ?? (await readResponse<{ plan: SupportPlan }>(await fetch(`/api/support/plans/${encodeURIComponent(requestedPlanId)}`, { cache: "no-store", signal: controller.signal }))).plan;
          if (controller.signal.aborted) return;
          setTicketId(selected.ticketId);
          setPlan(selected);
          setPanel("review");
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "The support workspace could not load.");
          setAuthRequired(failure instanceof SupportRequestError && failure.status === 401);
        }
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!plan || plan.status !== "staged") return;
    const timer = setTimeout(() => setClock(Date.now()), Math.max(0, new Date(plan.expiresAt).getTime() - Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [plan]);

  const selectedTicket = dashboard?.tickets.find((item) => item.id === ticketId);
  const invoice = dashboard?.invoices.find((item) => item.id === selectedTicket?.invoiceId);
  const needsApproval = !!plan?.actions.some((item) => item.decision === "approval_required");
  const allowedCount = plan?.actions.filter((item) => item.decision !== "block").length ?? 0;
  const blockedCount = plan?.actions.filter((item) => item.decision === "block").length ?? 0;
  const expired = !!plan && new Date(plan.expiresAt).getTime() <= clock;
  const planOutbox = dashboard?.outbox.filter((item) => item.planId === plan?.id) ?? [];
  const planEvents = dashboard?.events.filter((item) => item.planId === plan?.id) ?? [];

  function chooseTicket(next: SupportTicket) {
    if (busy) return;
    setTicketId(next.id);
    setPlan(null);
    setApproved(false);
    setError("");
    setNotice("");
  }

  function choosePlan(next: SupportPlan) {
    if (busy) return;
    setTicketId(next.ticketId);
    setPlan(next);
    setApproved(false);
    setError("");
    setNotice("");
    setPanel("review");
  }

  async function refresh() {
    if (locked.current) return;
    locked.current = true;
    setBusy("refresh");
    setError("");
    try {
      const next = await loadDashboard();
      if (plan) setPlan(next.plans.find((item) => item.id === plan.id) ?? plan);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Refresh failed. Your current review remains available.");
      setAuthRequired(failure instanceof SupportRequestError && failure.status === 401);
    } finally { locked.current = false; setBusy(null); }
  }

  async function stage() {
    if (locked.current || !selectedTicket) return;
    locked.current = true;
    setBusy("stage");
    setError("");
    setNotice("");
    setApproved(false);
    try {
      const result = await readResponse<{ plan: SupportPlan }>(await fetch("/api/support/plan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId, mode, scenario, profile, note: mode === "live" ? note.trim() || undefined : undefined }),
      }));
      setPlan(result.plan);
      setPanel("review");
      setNotice("Plan staged. Review the proposed changes before executing them.");
      try { await loadDashboard(); } catch { setError("The plan was staged, but the history refresh failed. Retry refresh to retrieve durable records."); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The agent could not stage a plan. Please retry.");
      setAuthRequired(failure instanceof SupportRequestError && failure.status === 401);
    } finally { locked.current = false; setBusy(null); }
  }

  async function operate(operation: "execute" | "reject" | "recover") {
    if (locked.current || !plan) return;
    locked.current = true;
    setBusy(operation);
    setError("");
    setNotice("");
    try {
      const result = await readResponse<{ plan: SupportPlan }>(await fetch(`/api/support/plans/${encodeURIComponent(plan.id)}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation, receiptHash: plan.receiptHash, approve: approved }),
      }));
      setPlan(result.plan);
      setApproved(false);
      setNotice(operation === "execute" ? "Permitted actions executed. Blocked actions were skipped. Replies are queued only in the sandbox outbox."
        : operation === "recover" ? "Supported changes recovered and this plan's queued replies cancelled. The audit trail is preserved."
        : "Plan rejected. No actions from this plan were executed.");
      try { await loadDashboard(); } catch { setError("The operation succeeded, but the history refresh failed. Retry refresh to retrieve durable records."); }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The operation failed. Refresh the workspace before retrying.");
      setAuthRequired(failure instanceof SupportRequestError && failure.status === 401);
    } finally { locked.current = false; setBusy(null); }
  }

  function downloadEvidence() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sandbox: true, plan, outbox: planOutbox, events: planEvents }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `apx-evidence-${plan.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="apx-workspace apx-focus">
      <header className="apx-header">
        <a className="apx-brand" href="/" aria-label="APX support workspace">
          <span className="apx-brand-icon"><ShieldCheck size={23} strokeWidth={1.8} /></span>
          <span><b>APX<span className="apx-brand-dot">.</span></b><small>AUTHORIZED EXECUTION</small></span>
        </a>
        <nav className="apx-nav" aria-label="Main navigation">
          <a href="/evaluation" aria-label="Compare execution defenses"><FileText size={15} /><span className="hidden min-[400px]:inline">Compare</span></a>
          <a href="/observer" aria-label="Open security observer"><Eye size={15} /><span className="hidden min-[400px]:inline">Observer</span></a>
          <a href="/lab"><FlaskConical size={15} /> Attack lab <ArrowRight size={13} /></a>
        </nav>
        <span className="apx-environment"><span /> Sandbox environment</span>
      </header>

      <div className="apx-shell apx-focus-shell">
        <div className="apx-focus-toolbar"><div><span className="apx-section-label">SUPPORT WORKSPACE</span><h1 ref={panelHeadingRef} tabIndex={-1}>{workspacePanels.find(item => item.id === panel)?.label}</h1></div><div className="apx-focus-controls"><label className="apx-ticket-switch"><span className="apx-sr-only">Active customer request</span><select aria-label="Active customer request" value={ticketId} disabled={!!busy || !dashboard?.tickets.length} onChange={event => { const ticket = dashboard?.tickets.find(item => item.id === event.target.value); if (ticket) chooseTicket(ticket); }}>{!dashboard?.tickets.length && <option value="">Loading requests…</option>}{dashboard?.tickets.map(item => <option key={item.id} value={item.id}>{item.customerName} · {item.id}</option>)}</select></label><button className="apx-button apx-button-secondary" onClick={refresh} disabled={!!busy} aria-label="Refresh support workspace"><RefreshCw size={15} className={busy === "refresh" ? "apx-spin" : ""} /></button></div></div>
        <div className="apx-feedback" aria-live="polite" aria-atomic="true">
          {error && <div className="apx-alert apx-alert-error" role="alert"><ShieldCheck size={17} /><span>{error}{authRequired && <a className="apx-signin" href="/signin-with-chatgpt?return_to=/support">Sign in with ChatGPT <ArrowRight size={12} /></a>}</span><button onClick={() => setError("")} aria-label="Dismiss error"><X size={16} /></button></div>}
          {notice && <div className="apx-alert apx-alert-success"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification"><X size={16} /></button></div>}
        </div>
        <div className="apx-panel-viewport" ref={viewportRef}>
          <div id="workspace-inbox" role="tabpanel" aria-labelledby="dock-inbox" hidden={panel !== "inbox"} className="apx-focus-view apx-view-inbox"><aside id="ticket-queue" className="apx-ticket-panel apx-panel" aria-label="Support ticket queue">
            <div className="apx-panel-heading"><div><span className="apx-section-label">01 / INBOX</span><h2>Customer requests</h2></div><span className="apx-counter">{dashboard?.tickets.length ?? "—"}</span></div>
            <div className="apx-queue">
              {busy === "loading" && !dashboard ? <LoadingState label="Loading ticket queue" /> : dashboard?.tickets.length ? dashboard.tickets.map((item, index) => (
                <button className={`apx-ticket ${ticketId === item.id ? "selected" : ""}`} key={item.id} onClick={() => chooseTicket(item)} disabled={!!busy} aria-pressed={ticketId === item.id}>
                  <span className="apx-ticket-top"><span className={`apx-avatar apx-avatar-${index % 3}`}>{initials(item.customerName)}</span><span><b>{item.customerName}</b><small>{item.id}</small></span><span className={`apx-ticket-state ${item.status}`} title={item.status} /></span>
                  <strong>{item.subject}</strong><span className="apx-ticket-snippet">{item.body}</span>
                  <span className="apx-ticket-bottom"><span>{item.tenantId}</span><span>{item.requestedRefundCents ? `${money(item.requestedRefundCents)} requested` : "Invoice review"}</span></span>
                </button>
              )) : <EmptyState icon={<Inbox size={24} />} title={error ? "Connection unavailable" : "Your queue is empty"} detail={error ? "Use Refresh above to reconnect to the support database." : "Support tickets will appear here when the sandbox is initialized."} />}
            </div>
            <div className="apx-queue-footer"><LockKeyhole size={14} /><span>Permissions come from trusted records. Ticket contents cannot expand them.</span></div>
          </aside>
<section className="apx-panel apx-source-panel" aria-labelledby="source-title">
              <div className="apx-panel-heading"><div><span className="apx-section-label">02 / CONTEXT</span><h2 id="source-title">{selectedTicket?.subject ?? "Select a support ticket"}</h2></div><span className="apx-badge apx-badge-neutral">Untrusted source</span></div>
              {selectedTicket ? <>
                <div className="apx-source-meta"><span><Mail size={13} />{selectedTicket.customerEmail}</span><span>{selectedTicket.invoiceId}</span></div>
                <div className="apx-source-body">{selectedTicket.body}</div>
                <div className="apx-invoice-strip"><span><small>Invoice amount</small><b>{invoice ? money(invoice.amountCents) : "Unavailable"}</b></span><span><small>Already refunded</small><b>{invoice ? money(invoice.refundedCents) : "—"}</b></span><span><small>Remaining refundable</small><b>{invoice ? money(Math.max(0, invoice.refundableCents - invoice.refundedCents)) : "—"}</b></span><span><small>Current state</small><b className="apx-capitalize">{invoice?.status ?? "—"}</b></span></div>
              </> : <p className="apx-empty-copy">Choose a ticket to inspect its source, invoice, and customer boundary.</p>}
            </section>
<button className="apx-button apx-button-primary apx-next" disabled={!!busy || !selectedTicket} onClick={() => setPanel("planner")}>Plan this request<ArrowRight size={15} /></button></div>
          <div id="workspace-planner" role="tabpanel" aria-labelledby="dock-planner" hidden={panel !== "planner"} className="apx-focus-view apx-view-planner"><section className="apx-panel apx-planner-panel" ref={plannerRef} aria-labelledby="planner-title">
              <div className="apx-panel-heading"><div><span className="apx-section-label">03 / PROPOSE</span><h2 id="planner-title">Stage an action plan</h2></div><Sparkles size={19} className="apx-accent" /></div>
              <div className="apx-mode-group" role="group" aria-label="Agent planning mode">
                <button onClick={() => setMode("replay")} disabled={!!busy} aria-pressed={mode === "replay"} className={mode === "replay" ? "selected" : ""}><FlaskConical size={14} /><span>Deterministic replay<small>Reproducible test proposals</small></span>{mode === "replay" && <Check size={15} />}</button>
                <button onClick={() => setMode("live")} disabled={!!busy || !dashboard?.config.liveAvailable} aria-pressed={mode === "live"} className={mode === "live" ? "selected" : ""}><Sparkles size={14} /><span>Live model<small>{dashboard?.config.liveAvailable ? dashboard.config.model : "Requires server API configuration"}</small></span>{mode === "live" && <Check size={15} />}</button>
              </div>
              <div className="apx-planner-fields">
                <label className="apx-field"><span>Scenario</span><span className="apx-select-wrap"><select aria-label="Scenario" value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)} disabled={!!busy}>{scenarios.map((item) => <option key={item.value} value={item.value}>{item.title}</option>)}</select><ChevronDown size={14} /></span></label>
                <label className="apx-field"><span>Permission profile</span><span className="apx-select-wrap"><select aria-label="Permission profile" value={profile} onChange={(event) => setProfile(event.target.value as PolicyProfile)} disabled={!!busy}><option value="standard">Standard · scoped autonomy</option><option value="strict">Strict · review all changes</option></select><ChevronDown size={14} /></span></label>
              </div>
              <p className="apx-scenario-description">{scenarios.find((item) => item.value === scenario)?.description}</p>
              {scenario !== "normal" && <details className="apx-injected-source"><summary><FileText size={12} />Inspect appended attack text<ChevronDown size={12} /></summary><pre>{scenarioContent[scenario].trim()}</pre><p>Live mode reads this as ticket content. Replay stages fixed adversarial proposals for the same scenario.</p></details>}
              <details className="apx-note"><summary>Additional customer context <span>live mode · optional</span></summary><label className="apx-field"><span className="apx-sr-only">Additional customer context</span><textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={!!busy || mode === "replay"} maxLength={2000} placeholder="For example: explain the refund calculation in the reply." rows={3} /></label><p>Live mode treats this text as untrusted customer input. Replay uses fixed test proposals. Neither can widen the task grant.</p></details>
              <div className="apx-planner-footer"><span><LockKeyhole size={13} /> Staging makes no customer changes</span><button className="apx-button apx-button-primary" onClick={stage} disabled={!!busy || !selectedTicket}>{busy === "stage" ? <LoaderCircle size={15} className="apx-spin" /> : <Sparkles size={15} />}{busy === "stage" ? "Staging plan…" : "Stage plan"}<ArrowRight size={14} /></button></div>
            </section></div>
          <div id="workspace-review" role="tabpanel" aria-labelledby="dock-review" hidden={panel !== "review"} className="apx-focus-view apx-view-review"><section className="apx-panel apx-review-panel" ref={reviewRef} aria-labelledby="review-title">
              <div className="apx-panel-heading"><div><span className="apx-section-label">04 / REVIEW & EXECUTE</span><h2 id="review-title">The change preview</h2></div>{plan && <span className={`apx-badge apx-badge-${plan.status}`}>{plan.status}</span>}</div>
              {plan ? <>
                <div className="apx-plan-summary"><p>{plan.summary}</p><div><span>{plan.mode === "live" ? `Live · ${plan.model}` : plan.mode === "external" ? "External proposal · reviewed execution" : "Deterministic test replay"}</span><span>{plan.latencyMs} ms</span><span>{timestamp(plan.createdAt)}</span></div></div>
                {plan.observer && <ObserverSummary observation={plan.observer} />}
                <div className="apx-review-counts"><span><span className="apx-dot green" /> {allowedCount} within grant or approval</span><span><span className="apx-dot red" /> {blockedCount} blocked · will be skipped</span></div>
                <div className="apx-actions">{plan.actions.length ? plan.actions.map((item, index) => <ActionCard key={item.action.id} item={item} index={index} planStatus={plan.status} />) : <p className="apx-empty-copy">This plan proposes no executable actions.</p>}</div>
                {plan.status === "staged" && <div className="apx-execute-panel">
                  {expired && <p className="apx-expiry-warning"><Clock3 size={14} /> This plan has expired. Stage a new plan from the current invoice.</p>}
                  {needsApproval && <label className="apx-approval"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} disabled={!!busy || expired} /><span><b>Approve the flagged actions in this exact plan</b><small>Approval is bound to its receipt. Blocked actions remain blocked.</small></span></label>}
                  <div className="apx-execute-footer"><button className="apx-button apx-button-secondary" disabled={!!busy} onClick={() => operate("reject")}>{busy === "reject" ? <LoaderCircle size={14} className="apx-spin" /> : <X size={14} />}Reject plan</button><button className="apx-button apx-button-primary" onClick={() => operate("execute")} disabled={!!busy || !allowedCount || expired || (needsApproval && !approved)}>{busy === "execute" ? <LoaderCircle size={15} className="apx-spin" /> : <ShieldCheck size={15} />}{busy === "execute" ? "Executing…" : "Execute permitted actions"}</button></div>
                  <p className="apx-execution-hint">The server rechecks permissions and invoice state at execution. Nothing is sent as real email.</p>
                </div>}
                {plan.status === "executed" && <div className="apx-recovery"><div><RotateCcw size={18} /><span><b>Recover this plan&apos;s supported changes</b><p>Restore invoice state and cancel queued sandbox replies. Recovery fails if a later operation changed the invoice. A delivered email or external payment cannot be undone here.</p></span></div><button className="apx-button apx-button-secondary" onClick={() => operate("recover")} disabled={!!busy || !plan.actions.some((item) => item.decision !== "block" && item.reversible)}>{busy === "recover" ? <LoaderCircle size={14} className="apx-spin" /> : <RotateCcw size={14} />}{busy === "recover" ? "Recovering…" : "Recover changes"}</button></div>}
                {plan.status === "recovered" && <div className="apx-terminal"><RotateCcw size={17} /><span>This plan&apos;s supported changes were recovered. Its execution and recovery remain in the audit trail.</span></div>}
                {plan.status === "rejected" && <div className="apx-terminal"><X size={17} /><span>This plan was rejected before execution. Stage a new plan to continue the task.</span></div>}
                <div className="apx-receipt"><span><LockKeyhole size={12} /><code title={plan.receiptHash}>sha256 {plan.receiptHash.slice(0, 24)}…</code></span><button onClick={downloadEvidence} className="apx-text-button"><ArrowDownToLine size={13} />Download evidence</button></div>
              </> : <div className="apx-review-start">
                <div className="apx-flow-intro"><span className="apx-section-label">FROM REQUEST TO REVIEWABLE ACTION</span><h3>A plan before a change</h3><p>Choose a test below, then stage the plan. Compare the proposal against its permissions before anything executes.</p>
                  <div className="apx-flow" aria-label="Request, policy check, change preview, execution">
                    <span><Inbox size={20} /><b>Request</b></span><i /><span><ShieldCheck size={20} /><b>Policy check</b></span><i /><span><FileText size={20} /><b>Preview</b></span><i /><span><Check size={20} /><b>Execute</b></span>
                  </div>
                  <p className="apx-flow-caption">Illustrated workflow · stage a plan to see real decisions.</p>
                </div>
                <div className="apx-scenario-library"><span className="apx-section-label">EXPLORE THE GUARDRAILS</span><h3>Pick a test scenario</h3><div className="apx-scenario-cards">{scenarios.map((item, index) => <button key={item.value} className={scenario === item.value ? "selected" : ""} aria-pressed={scenario === item.value} disabled={!!busy} onClick={() => { setScenario(item.value); setMode("replay"); setPanel("planner"); }}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{item.title}</b><small>{item.description}</small></div>{scenario === item.value ? <Check size={15} /> : <ArrowRight size={15} />}</button>)}</div></div>
              </div>}
            </section></div>
          <div id="workspace-permissions" role="tabpanel" aria-labelledby="dock-permissions" hidden={panel !== "permissions"} className="apx-focus-view apx-view-permissions"><section className="apx-panel apx-grant-panel" aria-labelledby="grant-title"><div className="apx-panel-heading"><div><span className="apx-section-label">TRUSTED APPLICATION SCOPE</span><h2 id="grant-title">Task permission grant</h2></div><LockKeyhole size={18} className="apx-accent" /></div>
              <div className="apx-grant-note"><ShieldCheck size={15} /><span>{plan ? "Derived on the server from this ticket's records." : "A grant is issued when the task is staged."}</span></div>
              <dl className="apx-grant-list"><GrantRow label="Tenant" value={plan?.grant.tenantId ?? selectedTicket?.tenantId} /><GrantRow label="Customer" value={plan?.grant.customerId ?? selectedTicket?.customerId} /><GrantRow label="Invoice" value={plan?.grant.invoiceId ?? selectedTicket?.invoiceId} /><GrantRow label="Reply recipient" value={plan?.grant.recipient ?? selectedTicket?.customerEmail} /><GrantRow label="Refund maximum" value={plan ? money(plan.grant.maxRefundCents) : "Issued on staging"} /><GrantRow label="Without approval" value={plan ? money(Math.min(plan.grant.autoRefundCents, plan.grant.maxRefundCents)) : "Profile-dependent"} /><GrantRow label="Action budget" value={plan ? `${plan.grant.maxActions} actions` : "Issued on staging"} /><GrantRow label="Expires" value={plan ? timestamp(plan.grant.expiresAt) : "Short-lived grant"} /></dl>
              <div className="apx-grant-boundary"><span className="apx-dot green" />One task. One customer. One invoice.</div>
            </section></div>
          <div id="workspace-trace" role="tabpanel" aria-labelledby="dock-trace" hidden={panel !== "trace"} className="apx-focus-view apx-view-trace"><section className="apx-panel apx-trace-panel" aria-labelledby="trace-title"><div className="apx-panel-heading"><div><span className="apx-section-label">OBSERVABLE EXECUTION</span><h2 id="trace-title">Tool trace</h2></div><span className="apx-counter">{plan?.trace.length ?? 0}</span></div>
              {plan?.observer && <ObserverSummary observation={plan.observer} details />}
              {plan?.trace.length ? <ol className="apx-trace">{plan.trace.map((entry, index) => <li key={`${entry.step}-${index}`}><span className={`apx-trace-marker ${entry.decision.includes("block") ? "blocked" : entry.decision.includes("approval") ? "review" : ""}`}>{entry.decision.includes("block") ? <X size={11} /> : entry.decision.includes("approval") ? <LockKeyhole size={10} /> : <Check size={11} />}</span><div><div className="apx-trace-heading"><b>{entry.tool.replaceAll("_", " ")}</b><small>{entry.decision.replaceAll("_", " ")}</small></div><p>{entry.detail}</p></div></li>)}</ol> : <p className="apx-empty-copy">Agent reads and proposed tool calls appear here after staging.</p>}
            </section></div>
          <div id="workspace-activity" role="tabpanel" aria-labelledby="dock-activity" hidden={panel !== "activity"} className="apx-focus-view apx-view-activity"><section className="apx-metrics" aria-label="Workspace activity">
          <Stat icon={<Ticket size={16} />} label="Support tickets" value={dashboard ? String(dashboard.tickets.length) : "—"} detail="Customer-scoped requests" />
          <Stat icon={<FileText size={16} />} label="Staged plans" value={dashboard ? String(dashboard.plans.filter((item) => item.status === "staged").length) : "—"} detail="Waiting for execution review" />
          <Stat icon={<ShieldCheck size={16} />} label="Blocked proposals" value={dashboard ? String(dashboard.plans.reduce((total, item) => total + item.actions.filter((action) => action.decision === "block").length, 0)) : "—"} detail="Recorded across stored plans" />
          <Stat icon={<RotateCcw size={16} />} label="Recovered plans" value={dashboard ? String(dashboard.plans.filter((item) => item.status === "recovered").length) : "—"} detail="Changes reversed with evidence" />
        </section>
<section className="apx-panel apx-activity" aria-labelledby="activity-title">
          <div className="apx-activity-heading"><div><span className="apx-section-label">DURABLE EVIDENCE</span><h2 id="activity-title">Every decision leaves a record</h2></div><div className="apx-tabs" role="tablist" aria-label="Stored activity"><button role="tab" id="tab-history" aria-controls="activity-history" aria-selected={activityTab === "history"} onClick={() => setActivityTab("history")}>Plans <span>{dashboard?.plans.length ?? 0}</span></button><button role="tab" id="tab-outbox" aria-controls="activity-outbox" aria-selected={activityTab === "outbox"} onClick={() => setActivityTab("outbox")}>Sandbox outbox <span>{dashboard?.outbox.length ?? 0}</span></button><button role="tab" id="tab-audit" aria-controls="activity-audit" aria-selected={activityTab === "audit"} onClick={() => setActivityTab("audit")}>Audit trail <span>{dashboard?.events.length ?? 0}</span></button></div></div>
          <div role="tabpanel" id={`activity-${activityTab}`} aria-labelledby={`tab-${activityTab}`} className="apx-activity-content">
            {activityTab === "history" && (dashboard?.plans.length ? <div className="apx-history-list"><div className="apx-history-labels"><span>Task / plan</span><span>Agent mode</span><span>Created</span><span>State</span><span /></div>{dashboard.plans.map((item) => <button key={item.id} disabled={!!busy} className={`apx-history-row ${plan?.id === item.id ? "selected" : ""}`} onClick={() => choosePlan(item)}><span><b>{dashboard.tickets.find((ticket) => ticket.id === item.ticketId)?.customerName ?? item.ticketId}</b><small>{item.scenario.replaceAll("-", " ")} · {item.id}</small></span><span>{item.mode === "live" ? "Live model" : item.mode === "external" ? "External proposal" : "Test replay"}</span><span>{timestamp(item.createdAt)}</span><span><span className={`apx-badge apx-badge-${item.status}`}>{item.status}</span></span><ArrowRight size={15} /></button>)}</div> : <EmptyState icon={<FileText size={23} />} title="No plans recorded yet" detail="Stage a task to create the first durable action plan." />)}
            {activityTab === "outbox" && <><p className="apx-outbox-disclaimer"><Mail size={14} /> Sandbox only. These messages are stored in the sandbox and are never delivered.</p>{dashboard?.outbox.length ? <div className="apx-outbox-list">{dashboard.outbox.map((message) => <details key={message.id} className="apx-outbox-item"><summary><Mail size={16} /><span><b>{message.subject}</b><small>To {message.to} · {timestamp(message.createdAt)}</small></span><span className={`apx-badge ${message.status === "cancelled" ? "apx-badge-rejected" : "apx-badge-staged"}`}>{message.status}</span><ChevronDown size={14} /></summary><div className="apx-message-body">{message.body}</div><div className="apx-outbox-plan"><code>{message.planId}</code><button className="apx-text-button" disabled={!!busy} onClick={() => { const found = dashboard.plans.find((item) => item.id === message.planId); if (found) choosePlan(found); }}>Review originating plan<ArrowRight size={12} /></button></div></details>)}</div> : <EmptyState icon={<Mail size={23} />} title="The sandbox outbox is empty" detail="Execute a permitted reply action to queue a message here." />}</>}
            {activityTab === "audit" && (dashboard?.events.length ? <div className="apx-audit-list">{dashboard.events.map((event) => <div className="apx-audit-row" key={event.id}><time>{timestamp(event.at)}</time><span className="apx-audit-dot" /><div><b>{event.event.replaceAll("_", " ")}</b><p>{event.detail}</p><button className="apx-text-button" disabled={!!busy} onClick={() => { const found = dashboard.plans.find((item) => item.id === event.planId); if (found) choosePlan(found); }}>{event.planId}<ArrowRight size={11} /></button></div></div>)}</div> : <EmptyState icon={<ShieldCheck size={23} />} title="No audit events yet" detail="Staging, execution, rejection, and recovery are recorded here." />)}
          </div>
        </section></div>
        </div>
      </div>
      <div className={`apx-dock-zone ${dockPinned ? "pinned" : ""}`}>
        <button className="apx-dock-handle" onClick={() => setDockPinned(value => !value)} aria-label="Keep panel navigation visible" aria-pressed={dockPinned}><span />Panels<ChevronDown size={12} /></button>
        <nav className="apx-dock" role="tablist" aria-label="Workspace panels">{workspacePanels.map((item, index) => <button key={item.id} id={`dock-${item.id}`} role="tab" aria-selected={panel === item.id} aria-controls={`workspace-${item.id}`} tabIndex={panel === item.id ? 0 : -1} onClick={() => setPanel(item.id)} onKeyDown={event => { const keys = ["ArrowRight", "ArrowLeft", "Home", "End"]; if (!keys.includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? workspacePanels.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + workspacePanels.length) % workspacePanels.length; setPanel(workspacePanels[next].id); document.getElementById(`dock-${workspacePanels[next].id}`)?.focus(); }}><item.icon size={20} strokeWidth={1.7} /><span>{item.label}</span>{item.id === "review" && plan?.status === "staged" && <i />}</button>)}</nav>
      </div>
    </main>
  );
}

function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join(""); }

function ObserverSummary({ observation, details = false }: { observation: ObserverEvidence; details?: boolean }) {
  const label = observation.verdict === "suspicious" ? "Suspicious signal" : observation.verdict === "benign" ? "No suspicious signal" : "No verdict";
  return <div className="apx-grant-note"><Eye size={15} /><div style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>Security observer · {label}</b><p>{observation.reason} Shadow mode: permissions and required approvals remain unchanged.</p>{details && <details style={{ marginTop: 7 }}><summary>Model evidence</summary><p>{observation.model?.id ?? "No model inference"} · {observation.latencyMs} ms · {observation.coverage.complete ? "Complete" : "Incomplete"} coverage · {observation.coverage.segments} segments</p>{observation.model && <p>Revision: <code>{observation.model.revision}</code></p>}<p>Highest suspicion score: {observation.maxScore === null ? "Unmeasured" : observation.maxScore.toFixed(4)} · threshold {observation.threshold.toFixed(4)}</p></details>}<a className="apx-text-button" style={{ marginTop: 6 }} href="/observer">Open observer workspace<ArrowRight size={12} /></a></div></div>;
}

function Stat({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <div className="apx-stat"><div><span>{icon}{label}</span><strong>{value}</strong></div><small>{detail}</small></div>;
}

function LoadingState({ label }: { label: string }) {
  return <div className="apx-loading" role="status"><LoaderCircle size={22} className="apx-spin" /><span>{label}…</span></div>;
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return <div className="apx-empty"><span>{icon}</span><h3>{title}</h3><p>{detail}</p></div>;
}

function GrantRow({ label, value }: { label: string; value?: string }) {
  return <div><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

function actionTitle(item: ActionDecision) {
  const action = item.action;
  switch (action.type) {
    case "update_invoice": return "Update invoice status";
    case "refund": return `Record ${money(action.amountCents)} refund`;
    case "send_reply": return "Queue a customer reply";
    case "export_customers": return "Export customer records";
  }
}

function displayValue(key: string, value: unknown) {
  if (typeof value === "number" && key.toLowerCase().includes("cents")) return money(value);
  if (value === undefined || value === null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fieldLabel(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/ cents$/i, "");
}

function ActionCard({ item, index, planStatus }: { item: ActionDecision; index: number; planStatus: SupportPlan["status"] }) {
  const changes = Array.from(new Set([...Object.keys(item.before), ...Object.keys(item.after)]));
  const decisionLabel = item.decision === "block" ? "Blocked" : item.decision === "approval_required" ? "Approval required" : "Allowed";
  const action = item.action;
  return <article className={`apx-action apx-action-${item.decision}`}>
    <div className="apx-action-heading"><span className="apx-action-index">{String(index + 1).padStart(2, "0")}</span><div><h3>{actionTitle(item)}</h3><small>{action.type === "send_reply" ? action.to : action.type === "export_customers" ? action.destination : action.invoiceId}</small></div><span className={`apx-badge apx-badge-${item.decision}`}>{item.decision === "block" ? <X size={11} /> : item.decision === "allow" ? <Check size={11} /> : <LockKeyhole size={10} />}{decisionLabel}</span></div>
    <ul className="apx-action-reasons">{item.reasons.map((reason, reasonIndex) => <li key={reasonIndex}>{reason}</li>)}</ul>
    {changes.length > 0 && <div className="apx-diff"><div className="apx-diff-head"><span>Proposed field</span><span>Before</span><span>After</span></div>{changes.map((key) => <div key={key} className="apx-diff-row"><span>{fieldLabel(key)}</span><code>{displayValue(key, item.before[key])}</code><code className={JSON.stringify(item.before[key]) !== JSON.stringify(item.after[key]) ? "changed" : ""}>{displayValue(key, item.after[key])}</code></div>)}</div>}
    {action.type === "send_reply" && <details className="apx-reply-preview"><summary><Mail size={12} />Preview drafted reply<ChevronDown size={12} /></summary><div><b>{action.subject}</b><p>{action.body}</p></div></details>}
    <div className="apx-action-foot"><span>{item.decision === "block" ? "Skipped at execution" : item.reversible ? "Recovery supported in sandbox" : "Recovery unavailable"}</span><span>{item.decision === "block" ? "Outside task grant" : planStatus === "staged" ? "Not executed" : planStatus === "executed" ? "Executed" : planStatus === "recovered" ? "Recovered" : "Rejected"}</span></div>
  </article>;
}



