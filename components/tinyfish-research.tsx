"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Globe2, KeyRound, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { webSources, webEvidenceSchema, type WebEvidence } from "@/lib/tinyfish/types";
import type { SupportPlan } from "@/lib/support/types";

export function TinyFishResearch({ ticketId, disabled, liveAvailable, evidence, onEvidence, onBusyChange, onDraft }: {
  ticketId: string; disabled: boolean; liveAvailable: boolean; evidence: WebEvidence | null;
  onEvidence: (value: WebEvidence | null) => void; onBusyChange: (busy: boolean) => void;
  onDraft: (plan: SupportPlan) => void;
}) {
  const [source, setSource] = useState<string>(webSources[0].id), [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null), lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tinyfish", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (response.ok) { const data = await response.json() as { configured?: boolean }; if (!controller.signal.aborted) setConfigured(data.configured === true); }
    }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setError(""); setKey("");
    return () => { controllerRef.current?.abort(); };
  }, [ticketId]);

  async function retrieve() {
    if (lock.current || !ticketId) return;
    lock.current = true; setBusy(true); onBusyChange(true); setError("");
    const controller = new AbortController(); controllerRef.current = controller;
    try {
      const response = await fetch("/api/tinyfish", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketId, sourceId: source, ...(key.trim() ? { apiKey: key.trim() } : {}) }) });
      const body = await response.json() as { error?: string; evidence?: unknown };
      if (!response.ok) throw new Error(body.error || "The web reference could not be fetched.");
      const parsed = webEvidenceSchema.safeParse(body.evidence);
      if (!parsed.success) throw new Error("The retrieved reference could not be validated. Fetch it again.");
      if (!controller.signal.aborted) onEvidence(parsed.data);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "TinyFish could not be reached."); }
    finally { setKey(""); setBusy(false); onBusyChange(false); lock.current = false; }
  }

  async function stageReference() {
    if (lock.current || !evidence) return;
    lock.current=true;setBusy(true);onBusyChange(true);setError("");
    const controller=new AbortController();controllerRef.current=controller;
    try{
      const response=await fetch("/api/tinyfish/plan",{method:"POST",signal:controller.signal,headers:{"content-type":"application/json"},body:JSON.stringify({ticketId,evidenceId:evidence.id})});
      const body=await response.json() as {error?:string;plan?:SupportPlan};
      if(!response.ok||!body.plan)throw new Error(body.error||"The reference draft could not be staged.");
      if(!controller.signal.aborted)onDraft(body.plan);
    }catch(failure){if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:"Reference staging failed.");}
    finally{setBusy(false);onBusyChange(false);lock.current=false;}
  }

  return <section className="apx-web-research" aria-labelledby="tinyfish-title">
    <div className="apx-web-heading"><Globe2 size={20} /><div><h3 id="tinyfish-title">Bring live web context into the plan</h3><p>TinyFish Fetch → untrusted reference → model proposal → APX policy → review</p></div></div>
    <p className="apx-web-help">Fetch a public billing reference to help draft an informed reply. These are general Stripe references, not Northstar&apos;s refund policy. They cannot change this customer&apos;s entitlement.</p>
    <div className="apx-web-fields"><label className="apx-field"><span>Public reference</span><select value={source} disabled={disabled || busy} onChange={event => setSource(event.target.value)}>{webSources.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label className="apx-field"><span><KeyRound size={13} />TinyFish API key {configured && "· optional, server configured"}</span><input type="password" autoComplete="off" data-lpignore="true" value={key} maxLength={512} onChange={event => setKey(event.target.value)} disabled={disabled || busy} placeholder={configured ? "Use server key or enter your own" : "Paste your TinyFish key for this fetch"} /></label></div>
    <div className="apx-web-controls"><button className="apx-button apx-button-secondary" disabled={disabled || busy || !ticketId || (!configured && key.trim().length < 10)} onClick={() => void retrieve()}>{busy ? <LoaderCircle size={15} className="apx-spin" /> : <Globe2 size={15} />}{busy ? "Working…" : "Fetch reference with TinyFish"}</button><a href="https://agent.tinyfish.ai/api-keys" target="_blank" rel="noopener noreferrer" className="apx-text-button">Get a TinyFish key<ExternalLink size={12} /></a></div>
    <p className="apx-web-help">One-use key: cleared after this request, never saved in browser storage or plan records. Only the selected public URL goes to TinyFish; no ticket or invoice data. Your TinyFish quota may apply. Retrieval can use TinyFish&apos;s upstream cache.</p>
    {error && <p className="apx-alert apx-alert-error" role="alert">{error}</p>}
    {evidence && <><div className="apx-web-attached"><ShieldCheck size={15} /><span>Reference retrieved. {liveAvailable ? "Attached to the next live plan." : "Connect a model to use it in live planning."}</span><button className="apx-text-button" onClick={() => onEvidence(null)} disabled={disabled || busy} aria-label="Remove web reference"><X size={15} /></button></div><WebEvidenceCard evidence={evidence} /><button className="apx-button apx-button-secondary" disabled={disabled || busy} onClick={()=>void stageReference()}>Stage a reference reply · no LLM</button><p className="apx-web-help">An explicit alternative to live planning: quotes the retrieved source in a template reply. Requires strict approval; proposes no refund or invoice change.</p></>}
  </section>;
}

export function WebEvidenceCard({ evidence }: { evidence: WebEvidence }) {
  return <details className="apx-web-evidence"><summary><span>TinyFish reference · {evidence.title}</span><small>Untrusted web content</small></summary><div><a href={evidence.url} target="_blank" rel="noopener noreferrer">{evidence.url}<ExternalLink size={12} /></a><p>Retrieved {new Date(evidence.fetchedAt).toLocaleString()} · {evidence.text.length.toLocaleString()} characters{evidence.truncated && " · excerpt truncated"} · refresh before staging after 15 minutes</p><p className="apx-web-hash">SHA-256 <code>{evidence.sha256}</code></p><pre>{evidence.text}</pre><p>Read as reference data. It grants no new permissions. Evidence is sealed into the plan receipt.</p></div></details>;
}
