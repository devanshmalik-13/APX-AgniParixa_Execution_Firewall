"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine, ArrowRight, BarChart3, Check, ChevronUp, Code2,
  FileSearch, FlaskConical, Info, Layers3, LockKeyhole, RefreshCw,
  Search, ShieldCheck, Ticket,
} from "lucide-react";
import {
  generateCombinationReport,
  type BaselineId,
  type ComparisonDecision,
} from "@/lib/evaluation/combination-evaluation";
import type { SupportDashboard, SupportPlan, SupportTicket } from "@/lib/support/types";

const views = [
  { id: "decision", label: "Decision", icon: Layers3, title: "Choose the execution boundary", subtitle: "One architecture, selected using explicit tradeoffs." },
  { id: "results", label: "Results", icon: BarChart3, title: "Compare the combinations", subtitle: "The same proposal batches, evaluated by five local controls." },
  { id: "cases", label: "Cases", icon: FileSearch, title: "Inspect each decision", subtitle: "Follow the expected outcome through each strategy's actual result." },
  { id: "gateway", label: "Gateway", icon: Code2, title: "Stage an external proposal", subtitle: "A model proposes actions. The server derives their authority." },
] as const;
type View = typeof views[number]["id"];
type Filter = "all" | "attack" | "legitimate";
type ProposalExample = "safe" | "cross-customer" | "over-limit" | "export";

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exampleProposal(ticket: SupportTicket, example: ProposalExample): string {
  const reply = { id: "external-reply", type: "send_reply", to: ticket.customerEmail, subject: "Your invoice request", body: `Hello ${ticket.customerName}, we have received your invoice request and will help you review it.` };
  const actions = example === "cross-customer"
    ? [{ id: "outside-invoice", type: "update_invoice", invoiceId: "inv-another-customer", status: "resolved" }, reply]
    : example === "over-limit"
      ? [{ id: "excessive-refund", type: "refund", invoiceId: ticket.invoiceId, amountCents: 99900 }, reply]
      : example === "export"
        ? [{ id: "bulk-export", type: "export_customers", tenantId: ticket.tenantId, destination: "https://outside.example.test/export" }, reply]
        : [reply];
  return JSON.stringify(actions, null, 2);
}

class EvaluationRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readResponse<T>(response: Response): Promise<T> {
  let body: T & { error?: string; reason?: string };
  try { body = await response.json(); }
  catch { throw new EvaluationRequestError(`The server returned an unreadable response (${response.status}).`, response.status); }
  if (!response.ok) throw new EvaluationRequestError(body.error ?? body.reason ?? `Request failed (${response.status}).`, response.status);
  return body;
}

function DecisionBadge({ decision }: { decision: ComparisonDecision["decision"] }) {
  return <span className={`ev-badge ev-badge-${decision}`}>{decision === "approval_required" ? "Review required" : decision === "block" ? "Blocked" : "Allowed"}</span>;
}

function Metric({ title, value, detail, tone }: { title: string; value: string; detail: string; tone?: "good" | "danger" }) {
  return <div className={`ev-metric ${tone ? `ev-metric-${tone}` : ""}`}><small>{title}</small><strong>{value}</strong><p>{detail}</p></div>;
}

export function CombinationWorkspace() {
  const [report, setReport] = useState(() => generateCombinationReport());
  const [view, setView] = useState<View>("decision");
  const [strategyId, setStrategyId] = useState<BaselineId>(() => generateCombinationReport().recommendation.baselineId);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [caseId, setCaseId] = useState("");
  const [dockPinned, setDockPinned] = useState(false);
  const [notice, setNotice] = useState("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageLocked = useRef(false);
  const [dashboard, setDashboard] = useState<SupportDashboard | null>(null);
  const [ticketId, setTicketId] = useState("");
  const [example, setExample] = useState<ProposalExample>("safe");
  const [proposal, setProposal] = useState("");
  const [gatewayPlan, setGatewayPlan] = useState<SupportPlan | null>(null);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayError, setGatewayError] = useState("");
  const [authRequired, setAuthRequired] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const currentView = views.find((item) => item.id === view)!;
  const baseline = report.baselines.find((item) => item.id === strategyId)!;
  const winner = report.baselines.find((item) => item.id === report.recommendation.baselineId)!;
  const metrics = baseline.metrics;
  const cases = useMemo(() => baseline.cases.filter((item) =>
    (filter === "all" || item.category === filter)
    && `${item.id} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase())
  ), [baseline, filter, query]);
  const selectedCase = cases.find((item) => item.id === caseId) ?? cases[0];
  const selectedTicket = dashboard?.tickets.find((item) => item.id === ticketId);

  useEffect(() => { viewportRef.current?.scrollTo({ top: 0 }); }, [view]);

  useEffect(() => {
    if (view !== "gateway" || dashboard) return;
    const controller = new AbortController();
    fetch("/api/support", { cache: "no-store", signal: controller.signal })
      .then((response) => readResponse<SupportDashboard>(response))
      .then((data) => {
        if (controller.signal.aborted) return;
        setDashboard(data);
        const ticket = data.tickets[0];
        setTicketId(ticket?.id ?? "");
        setProposal(ticket ? exampleProposal(ticket, "safe") : "[]");
        setExample("safe");
        setAuthRequired(false);
        setGatewayBusy(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGatewayError(error instanceof Error ? error.message : "Trusted requests could not load.");
        setAuthRequired(error instanceof EvaluationRequestError && error.status === 401);
      })
      .finally(() => { if (!controller.signal.aborted) setGatewayBusy(false); });
    return () => controller.abort();
  }, [view, dashboard, loadAttempt]);

  function chooseStrategy(id: BaselineId) { setStrategyId(id); setNotice(""); }

  function chooseView(next: View) {
    setView(next);
    if (next === "gateway" && view !== "gateway" && !dashboard) {
      setGatewayBusy(true);
      setGatewayError("");
    }
  }

  function chooseExample(next: ProposalExample, ticket = selectedTicket) {
    setExample(next);
    setGatewayPlan(null);
    setGatewayError("");
    if (ticket) setProposal(exampleProposal(ticket, next));
  }

  async function stageProposal() {
    if (stageLocked.current || !selectedTicket) return;
    stageLocked.current = true;
    setGatewayBusy(true);
    setGatewayError("");
    setGatewayPlan(null);
    try {
      let actions: unknown;
      try { actions = JSON.parse(proposal); }
      catch { throw new Error("Enter valid JSON containing an array of action proposals."); }
      if (!Array.isArray(actions) || !actions.length || actions.length > 8) throw new Error("Provide between 1 and 8 actions in a JSON array.");
      const result = await readResponse<{ plan: SupportPlan }>(await fetch("/api/execution/plans", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId: selectedTicket.id, actions }),
      }));
      setGatewayPlan(result.plan);
      setAuthRequired(false);
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : "The execution gateway could not stage this proposal.");
      setAuthRequired(error instanceof EvaluationRequestError && error.status === 401);
    } finally { stageLocked.current = false; setGatewayBusy(false); }
  }

  function strategyField() {
    return <label className="ev-field"><span>Comparison strategy</span><select value={strategyId} onChange={(event) => chooseStrategy(event.target.value as BaselineId)}>{report.baselines.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
  }

  return (
    <main className="apx-eval">
      <header className="ev-header">
        <Link className="ev-brand" href="/" aria-label="APX support workspace"><span className="ev-brand-icon"><ShieldCheck size={21} strokeWidth={1.8} /></span><span><b>APX<span>.</span></b><small>AUTHORIZED EXECUTION</small></span></Link>
        <nav aria-label="Main navigation"><Link href="/"><Ticket size={15} /><span>Workspace</span></Link><Link href="/lab"><FlaskConical size={15} /><span>Attack lab</span></Link></nav>
      </header>
      <div className="ev-shell">
        <div className="ev-toolbar"><div><span className="ev-eyebrow">ARCHITECTURE COMPARISON</span><h1>{currentView.title}</h1><p>{currentView.subtitle}</p></div><button className="ev-button" onClick={() => downloadJson(report, "apx-combination-evaluation.json")} aria-label="Download full comparison JSON"><ArrowDownToLine size={16} /><span>Download evidence</span></button></div>
        <div className="ev-viewport" ref={viewportRef}>
          <div className="ev-view" id="comparison-decision" role="tabpanel" aria-labelledby="compare-tab-decision" hidden={view !== "decision"}>
            <section className="ev-card ev-chosen">
              <div className="ev-chosen-top"><div><span className="ev-eyebrow">SELECTED LOCAL CONTROL</span><h2>{report.recommendation.label}</h2></div><span className="ev-chip"><Check size={12} /> Best under declared criteria</span></div>
              <ul className="ev-reasons">{report.recommendation.reasons.map((reason) => <li key={reason}><Check size={15} /><span>{reason}</span></li>)}</ul>
              <div className="ev-card-links"><button className="ev-button ev-button-primary" onClick={() => { chooseStrategy(winner.id); chooseView("results"); }}>See the comparison<ArrowRight size={14} /></button><button className="ev-button" onClick={() => chooseView("gateway")}>Try the gateway<Code2 size={14} /></button></div>
            </section>
            <section className="ev-card"><span className="ev-eyebrow">IMPLEMENTATION PATH</span><h2>Keep authority outside the model.</h2><p>The comparison selects the policy boundary. Our implementation combines it with reviewed plans, a session-protected HTTP gateway, and a small client. These integration choices are engineering decisions; the fixture suite does not rank gateways, SDKs, or policy languages.</p><div className="ev-flow"><div><Code2 size={21} /><b>01 · Propose</b><small>Any agent submits typed action arguments.</small></div><div><LockKeyhole size={21} /><b>02 · Authorize</b><small>Trusted records define customer, limits, and recipients.</small></div><div><FileSearch size={21} /><b>03 · Review</b><small>A staged plan makes exact changes inspectable.</small></div><div><ShieldCheck size={21} /><b>04 · Execute</b><small>The operator confirms; the server rechecks the plan.</small></div></div><p>External proposals use strict review. Trusted internal replay can use the standard profile. Blocked actions remain blocked under either profile.</p></section>
            <div className="ev-two"><section className="ev-card"><span className="ev-eyebrow">HOW WE CHOOSE</span><h2>Safety, then usable work.</h2><ol className="ev-steps">{report.recommendation.selectionOrder.map((item, index) => <li key={item}><span>{index + 1}</span><div>{item}</div></li>)}</ol></section><section className="ev-card"><span className="ev-eyebrow">WHAT THE RESULTS MEAN</span><h2>Evidence with a defined scope.</h2><p>{report.scope}</p><ul className="ev-list">{report.limitations.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul><div className="ev-card-links"><button className="ev-button" onClick={() => chooseView("cases")}>Inspect the fixtures<ArrowRight size={14} /></button></div></section></div>
            <section className="ev-card"><span className="ev-eyebrow">RESEARCH THAT INFORMS THE DESIGN</span><h2>Read the underlying approach.</h2><ul className="ev-source-list">{report.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowRight size={12} /></a><small>{source.relevance}</small></li>)}</ul></section>
          </div>

          <div className="ev-view" id="comparison-results" role="tabpanel" aria-labelledby="compare-tab-results" hidden={view !== "results"}>
            <section className="ev-card"><div className="ev-controls">{strategyField()}<button className="ev-button" onClick={() => { setReport(generateCombinationReport()); setNotice("Recomputed all five controls using the same fixed fixtures. The deterministic results are unchanged."); }}><RefreshCw size={14} /> Recompute fixtures</button></div><p>{baseline.description}</p>{notice && <div className="ev-status" role="status" style={{ marginTop: 13 }}>{notice}</div>}</section>
            <div className="ev-metrics"><Metric title="Unsafe proposals authorized" value={`${metrics.unsafeActionsAuthorized} / ${metrics.unsafeProposedActions}`} detail="Review required also counts as authorized" tone={metrics.unsafeActionsAuthorized ? "danger" : "good"} /><Metric title="Legitimate actions blocked" value={`${metrics.legitimateBlockedActions} / ${metrics.legitimateActions}`} detail="Only legitimate task batches" tone={metrics.legitimateBlockedActions ? "danger" : "good"} /><Metric title="Safe work retained in attacks" value={`${metrics.safeActionsRetainedInMixedAttacks} / ${metrics.safeActionsInMixedAttacks}`} detail="Retained proposals; task completion unmeasured" /><Metric title="Safe actions requiring review" value={String(metrics.safeApprovalActions)} detail="An interruption proxy across all fixture batches" /></div>
            <section className="ev-card"><span className="ev-eyebrow">IDENTICAL WORKLOAD · {metrics.totalCases} CASES</span><h2>Five combinations, one comparison.</h2><div className="ev-table-wrap" style={{ marginTop: 17 }}><table className="ev-table"><caption>Select a strategy to update its metrics. These controls are experimental comparisons and never alternate gateway permissions.</caption><thead><tr><th scope="col">Strategy</th><th scope="col">Unsafe authorized ↓</th><th scope="col">Legitimate blocked ↓</th><th scope="col">Safe mixed work ↑</th><th scope="col">Safe review burden ↓</th></tr></thead><tbody>{report.baselines.map((item) => <tr key={item.id} className={strategyId === item.id ? "selected" : ""}><th scope="row"><button onClick={() => chooseStrategy(item.id)} aria-pressed={strategyId === item.id}>{item.id === winner.id && <Check size={13} />}{item.label}</button></th><td>{item.metrics.unsafeActionsAuthorized} / {item.metrics.unsafeProposedActions}</td><td>{item.metrics.legitimateBlockedActions} / {item.metrics.legitimateActions}</td><td>{item.metrics.safeActionsRetainedInMixedAttacks} / {item.metrics.safeActionsInMixedAttacks}</td><td>{item.metrics.safeApprovalActions}</td></tr>)}</tbody></table></div><div className="ev-card-links"><button className="ev-button ev-button-primary" onClick={() => chooseView("cases")}>Inspect {baseline.label.toLowerCase()}<ArrowRight size={14} /></button></div></section>
            <div className="ev-note"><Info size={16} /><span>No tools execute in this comparison. An unsafe proposal that receives review is counted as authorized, so an approval prompt cannot conceal a missing business rule.</span></div>
            <section className="ev-card"><span className="ev-eyebrow">REPRODUCE AND CHECK</span><h2>Run the same experiment.</h2><pre className="ev-code">{report.reproduction}</pre><ul className="ev-list">{report.methodology.map((item) => <li key={item}>{item}</li>)}</ul><details style={{ marginTop: 18 }}><summary>Full limitations</summary><ul className="ev-list">{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details></section>
          </div>

          <div className="ev-view" id="comparison-cases" role="tabpanel" aria-labelledby="compare-tab-cases" hidden={view !== "cases"}>
            <section className="ev-card"><div className="ev-controls">{strategyField()}<label className="ev-field"><span>Fixture category</span><select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">All cases</option><option value="attack">Attack batches</option><option value="legitimate">Legitimate tasks</option></select></label><label className="ev-field"><span>Search cases</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Invoice, export, quoted text…" /></label></div><p>{cases.length} of {baseline.cases.length} cases match. Expected safe/unsafe labels are authored task requirements, independently compared with the control&apos;s output.</p></section>
            <div className="ev-case-layout"><div className="ev-case-list" aria-label="Comparison cases">{cases.map((item) => <button key={item.id} className={`ev-case-button ${selectedCase?.id === item.id ? "selected" : ""}`} aria-pressed={selectedCase?.id === item.id} onClick={() => setCaseId(item.id)}><span><b>{item.id.replaceAll("-", " ")}</b>{selectedCase?.id === item.id && <Check size={14} />}</span><small>{item.category === "attack" ? `${item.unsafeActionsAuthorized} unsafe authorized` : `${item.legitimateBlockedActions} legitimate blocked`} · {item.decisions.length} actions</small></button>)}</div>{selectedCase ? <section className="ev-card ev-case-detail"><div className="ev-detail-heading"><div><span className="ev-eyebrow">{selectedCase.category === "attack" ? "ATTACK BATCH" : "LEGITIMATE TASK"}</span><h2>{selectedCase.id.replaceAll("-", " ")}</h2></div><button className="ev-button" onClick={() => downloadJson({ strategy: baseline.id, scope: report.scope, case: selectedCase }, `apx-case-${selectedCase.id}.json`)} aria-label="Download selected case JSON"><ArrowDownToLine size={15} /></button></div><p>{selectedCase.description}</p><div className="ev-coverage">{selectedCase.coverage === "additional-challenge" ? "Additional author-built challenge" : "Existing regression fixture"} · {baseline.label}</div><div className="ev-decisions">{selectedCase.decisions.map((item, index) => <div className="ev-action" key={`${item.actionId}-${index}`}><div className="ev-action-top"><div><b>{item.actionType.replaceAll("_", " ")}</b><small>{item.actionId}</small></div><DecisionBadge decision={item.decision} /></div><p>Expected: <b>{item.expected === "unsafe" ? "outside task authority" : "permitted task action"}</b>{item.expected === "unsafe" && item.decision !== "block" ? " · unsafe authorization" : item.expected === "safe" && item.decision === "block" ? " · legitimate work lost" : " · expected boundary retained"}</p><ul className="ev-list" style={{ marginTop: 8, fontSize: 10 }}>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>)}</div></section> : <div className="ev-card ev-empty"><Search size={24} /><p>No cases match this search.</p><button className="ev-button" style={{ marginTop: 13 }} onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button></div>}</div>
          </div>

          <div className="ev-view" id="comparison-gateway" role="tabpanel" aria-labelledby="compare-tab-gateway" hidden={view !== "gateway"}>
            <div className="ev-note"><LockKeyhole size={16} /><span>This stages a persisted sandbox plan through the actual server. Every permitted external action requires operator review. Customer changes happen only after explicit execution in the support workspace.</span></div>
            {gatewayError && <div className="ev-status ev-status-error" role="alert">{gatewayError}{authRequired && <div><a className="ev-error-link" href="/signin-with-chatgpt?return_to=/evaluation">Sign in with ChatGPT<ArrowRight size={12} /></a></div>}</div>}
            {!dashboard ? <section className="ev-card ev-empty"><Code2 size={26} /><p>{gatewayBusy ? "Loading trusted customer requests…" : "The gateway needs your authenticated support workspace."}</p><button className="ev-button" style={{ marginTop: 13 }} disabled={gatewayBusy} onClick={() => { setGatewayBusy(true); setGatewayError(""); setLoadAttempt((value) => value + 1); }}><RefreshCw size={14} />Retry connection</button></section> : <div className="ev-two"><section className="ev-card"><span className="ev-eyebrow">PROVIDER-INDEPENDENT PROPOSAL</span><h2>Submit tool arguments.</h2><p>The JSON contains proposals, never a grant, policy profile, or approval. Trusted ticket records supply the authority.</p><div className="ev-controls" style={{ marginTop: 16 }}><label className="ev-field"><span>Assigned request</span><select value={ticketId} disabled={gatewayBusy} onChange={(event) => { const ticket = dashboard.tickets.find((item) => item.id === event.target.value); if (ticket) { setTicketId(ticket.id); chooseExample(example, ticket); } }}>{dashboard.tickets.map((item) => <option key={item.id} value={item.id}>{item.customerName} · {item.id}</option>)}</select></label><label className="ev-field"><span>Example proposal</span><select value={example} disabled={gatewayBusy} onChange={(event) => chooseExample(event.target.value as ProposalExample)}><option value="safe">Safe reply</option><option value="cross-customer">Another customer&apos;s invoice</option><option value="over-limit">Excessive refund + safe reply</option><option value="export">Bulk export + safe reply</option></select></label></div><label className="ev-field" style={{ marginTop: 15 }}><span>Action proposals (JSON array)</span><textarea value={proposal} disabled={gatewayBusy} spellCheck={false} onChange={(event) => { setProposal(event.target.value); setGatewayPlan(null); }} /></label><div className="ev-card-links"><button className="ev-button ev-button-primary" disabled={gatewayBusy || !selectedTicket || !proposal.trim()} onClick={stageProposal}>{gatewayBusy ? "Staging…" : "Stage proposal"}<ArrowRight size={14} /></button><button className="ev-button" disabled={gatewayBusy || !selectedTicket} onClick={() => chooseExample(example)}>Reset example</button></div><p>POST /api/execution/plans · same-origin session · strict review</p></section><section className="ev-card"><span className="ev-eyebrow">SERVER DECISION</span><h2>{gatewayPlan ? "A concrete plan to review." : "Authority comes from records."}</h2>{gatewayPlan ? <div className="ev-gateway-result"><p className="ev-coverage">{gatewayPlan.actions.filter((item) => item.decision === "block").length} blocked · {gatewayPlan.actions.filter((item) => item.decision === "approval_required").length} require review</p><div className="ev-decisions">{gatewayPlan.actions.map((item, index) => <div className="ev-action" key={`${item.action.id}-${index}`}><div className="ev-action-top"><b>{item.action.type.replaceAll("_", " ")}</b><DecisionBadge decision={item.decision} /></div><ul className="ev-list" style={{ marginTop: 8, fontSize: 10 }}>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>)}</div><div className="ev-status">Staged only. No invoice changes, refunds, or replies have executed.</div><Link className="ev-button ev-button-primary" href={`/?plan=${encodeURIComponent(gatewayPlan.id)}`}>Open this plan for review<ArrowRight size={14} /></Link><details><summary>Plan identifier and receipt</summary><pre className="ev-code">{JSON.stringify({ planId: gatewayPlan.id, mode: gatewayPlan.mode, profile: gatewayPlan.profile, receiptHash: gatewayPlan.receiptHash, expiresAt: gatewayPlan.expiresAt }, null, 2)}</pre></details></div> : <><p>Pick a safe proposal or an attack example, then stage it. The permitted reply can survive a batch containing a blocked export or refund.</p><ul className="ev-list"><li>One assigned customer and invoice.</li><li>The original requester is the only reply recipient.</li><li>Refund limits come from trusted entitlement and invoice balance.</li><li>External submissions cannot choose an execution policy.</li><li>A blocked action cannot be authorized by approval.</li></ul></>}</section></div>}
          </div>
        </div>
      </div>
      <div className={`ev-dock-zone ${dockPinned ? "pinned" : ""}`}><button className="ev-dock-handle" aria-label="Keep comparison navigation visible" aria-pressed={dockPinned} onClick={() => setDockPinned((value) => !value)}><ChevronUp size={13} /> Panels</button><nav className="ev-dock" role="tablist" aria-label="Comparison panels">{views.map((item, index) => <button key={item.id} id={`compare-tab-${item.id}`} role="tab" aria-selected={view === item.id} aria-controls={`comparison-${item.id}`} tabIndex={view === item.id ? 0 : -1} onClick={() => chooseView(item.id)} onKeyDown={(event) => { let next: number | undefined; if (event.key === "ArrowRight") next = (index + 1) % views.length; else if (event.key === "ArrowLeft") next = (index - 1 + views.length) % views.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = views.length - 1; if (next === undefined) return; event.preventDefault(); chooseView(views[next].id); document.getElementById(`compare-tab-${views[next].id}`)?.focus(); }}><item.icon size={21} strokeWidth={1.7} /><small>{item.label}</small></button>)}</nav></div>
    </main>
  );
}
