"use client";
import { WorkspaceHeader, WorkspaceHeading } from "@/components/workspace-chrome";
import { LabExecutionFlow } from "@/components/lab-execution-flow";

import {
  Activity,
  Database,
  LockKeyhole,
  Mail,
  Play,
  ShieldCheck,
  TimerReset,
  Zap,
  History,
  FlaskConical,
  ChevronUp,
  SlidersHorizontal,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { evaluateAction } from "@/lib/security/policy-engine";
import { evaluationCases } from "@/lib/security/evaluation";
import { attackScenarios, demoTask } from "@/lib/security/scenarios";
import type { GatewayResponse, ToolExecutionResult } from "@/lib/security/types";
import type { PromptRecord, StoredRun } from "@/lib/security/run-store";
import { attackLevels, actorForScenario, demoActors, promptForLevel, proposeAction, type AttackLevel } from "@/lib/security/attack-lab";
import { AuditExplorer } from "@/components/audit-explorer";
import { isExactDemoFixture } from "@/lib/security/demo-fixture";
import { constrainDemoIngress } from "@/lib/security/ingress";

const labPanels = [
  { id: "simulation", label: "Simulation", icon: Activity, title: "See the execution boundary", subtitle: "Follow one proposed action from untrusted input to the tool boundary." },
  { id: "configure", label: "Configure", icon: SlidersHorizontal, title: "Set up an attack", subtitle: "Choose a scenario, protection mode, and editable prompt before running it." },
  { id: "evidence", label: "Evidence", icon: ShieldCheck, title: "Understand the decision", subtitle: "Inspect policy findings and review actions that need an analyst." },
  { id: "bench", label: "Bench", icon: BarChart3, title: "Measure the protection", subtitle: "Run the recorded test bench and compare containment with false positives." },
  { id: "history", label: "History", icon: History, title: "Explore recorded runs", subtitle: "Search stored prompts, execution receipts, and analyst decisions." },
] as const;
type LabPanel = typeof labPanels[number]["id"];
type Mode = "unprotected" | "observe" | "enforce";

const scenarioTitles: Record<string, string> = {
  "indirect-injection": "Possible data exfiltration",
  "memory-poisoning": "Persistent trust manipulation",
  "loop-exhaustion": "Runaway agent execution",
  "unknown-behavior": "Unrecognized behavior drift",
  "tool-escalation": "Forbidden capability attempt",
  "goal-hijack": "Off-task objective detected",
  "filesystem-escape": "Filesystem sandbox escape",
  "cross-tenant-query": "Cross-tenant data access",
};

type AnalystDecision = "pending" | "contained" | "safe" | "failed";
type AuditData = {
  prompts: PromptRecord[];
  runs: StoredRun[];
  metrics: { attempts: number; attacks: number; contained: number; defenseRate: number | null; legitimate: number; falsePositives: number; falsePositiveRate: number | null };
};

export default function Home() {
  const [panel, setPanel] = useState<LabPanel>("simulation");
  const [dockPinned, setDockPinned] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const currentPanel = labPanels.find((item) => item.id === panel)!;
  const [mode, setMode] = useState<Mode>("enforce");
  const [scenarioId, setScenarioId] = useState(attackScenarios[0].id);
  const [attackLevel, setAttackLevel] = useState<AttackLevel>("easy");
  const [actorId, setActorId] = useState<string>(actorForScenario(attackScenarios[0].id).id);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [attackRun, setAttackRun] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [analystDecision, setAnalystDecision] = useState<AnalystDecision>("pending");
  const [gatewayResponse, setGatewayResponse] = useState<GatewayResponse | null>(null);
  const [gatewayError, setGatewayError] = useState("");
  const [promptText, setPromptText] = useState(attackScenarios[0].prompt);
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(attackScenarios[0].action, null, 2));
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [suiteError, setSuiteError] = useState("");
  const scenario = attackScenarios.find((item) => item.id === scenarioId) ?? attackScenarios[0];
  const proposedAction = useMemo(() => proposeAction(scenarioId, attackLevel, promptText), [scenarioId, attackLevel, promptText]);
  const stockReplay = useMemo(() => isExactDemoFixture(scenarioId, attackLevel, promptText, proposedAction), [scenarioId, attackLevel, promptText, proposedAction]);
  const previewMode = stockReplay ? mode : "enforce";
  const previewEvaluation = useMemo(() => {
    const constrained = constrainDemoIngress(proposedAction, previewMode, stockReplay, promptText);
    return evaluateAction(demoTask, constrained.action, constrained.mode);
  }, [previewMode, proposedAction, stockReplay, promptText]);
  const evaluation = gatewayResponse?.evaluation ?? previewEvaluation;
  const displayedAction = evaluation.action;
  const isCustomAction = gatewayResponse ? !isExactDemoFixture(scenarioId, attackLevel, promptText, evaluation.action) : !stockReplay;
  const effectiveMode = evaluation.mode;
  const decision = {
    label: evaluation.decision === "block" ? "Blocked" : evaluation.decision === "observe" ? "Observed" : evaluation.decision === "approval_required" ? "Approval required" : effectiveMode === "unprotected" ? "Would execute" : "Allowed",
    risk: evaluation.riskScore,
    copy: effectiveMode === "unprotected" ? "Protection disabled in this synthetic comparison" : `${evaluation.findings.length} policy ${evaluation.findings.length === 1 ? "violation" : "violations"}`,
  };
  const events = evaluation.findings.slice(0, 3).map((finding) => ({
    time: gatewayResponse ? new Date(evaluation.evaluatedAt).toLocaleTimeString([], { hour12: false }) : "preview",
    title: finding.title,
    detail: Object.values(finding.evidence).flat().slice(0, 2).join(" · ") || finding.description,
    tone: finding.severity === "critical" ? "red" : "amber",
  }));
  const isUnknown = !isCustomAction && scenario.id === "unknown-behavior";
  const requiresReview = evaluation.decision === "approval_required";
  const responseCopy = effectiveMode === "unprotected"
    ? "Policy findings are recorded, but this fixed demo action is simulated as reaching the tool. No real system is touched."
    : effectiveMode === "observe"
    ? "The policy records findings without containment. Tool reach is simulated for this fixed demo action."
    : requiresReview
    ? analystDecision === "failed"
      ? "The analyst approved this action, but the connector refused execution. The failure is recorded in the audit log."
      : analystDecision === "safe"
      ? "The analyst allowed this exact action once; the decision and execution result are recorded."
      : analystDecision === "contained"
        ? "The analyst kept this action isolated. No tool execution followed."
        : "Keep this session isolated while an analyst reviews the new execution pattern."
    : evaluation.decision === "block"
      ? "No approval needed. The gateway stopped the action and preserved the evidence automatically."
      : "No analyst action needed. The event remains searchable in the audit trail.";

  async function refreshAudit() {
    const response = await fetch("/api/audit", { cache: "no-store" });
    if (!response.ok) throw new Error("Stored prompt logs are temporarily unavailable.");
    setAuditData(await response.json() as AuditData);
    setAuditRefreshKey((value) => value + 1);
  }

  useEffect(() => {
    let active = true;
    fetch("/api/audit", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Stored prompt logs are temporarily unavailable.");
        return response.json() as Promise<AuditData>;
      })
      .then((data) => { if (active) setAuditData(data); })
      .catch(() => { if (active) setSuiteError("Prompt history is unavailable; check the audit database."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [panel]);

  function clearResult() {
    setAnalystDecision("pending");
    setGatewayResponse(null);
    setGatewayError("");
  }

  function selectScenario(id: string) {
    const next = attackScenarios.find((item) => item.id === id) ?? attackScenarios[0];
    setScenarioId(id);
    clearResult();
    setPromptText(next.prompt);
    setPayloadText(JSON.stringify(next.action, null, 2));
    setAttackLevel("easy");
    setActorId(actorForScenario(id).id);
  }

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    clearResult();
  }

  async function submitToGateway(action = proposedAction) {
    setAttackRun((current) => current + 1);
    setRunning(true);
    clearResult();
    try {
      const response = await fetch("/api/gateway", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, prompt: promptText, scenarioId: scenario.id, attackLevel, actorId, action }),
      });
      const result = await response.json() as GatewayResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Gateway rejected the request envelope.");
      setGatewayResponse(result as GatewayResponse);
      await refreshAudit();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : "Gateway request failed.");
    } finally {
      setRunning(false);
    }
  }

  async function runCustomPayload() {
    try {
      await submitToGateway(JSON.parse(payloadText));
    } catch {
      setGatewayError("The action editor must contain valid JSON.");
    }
  }

  async function runSuite() {
    setSuiteRunning(true);
    setSuiteError("");
    try {
      const response = await fetch("/api/benchmark", { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Test bench failed.");
      await refreshAudit();
    } catch (error) {
      setSuiteError(error instanceof Error ? error.message : "Test bench failed.");
    } finally {
      setSuiteRunning(false);
    }
  }

  async function resolveReview(verdict: "contained" | "safe") {
    if (!gatewayResponse || reviewing) return;
    setReviewing(true);
    try {
      const response = await fetch("/api/audit", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: gatewayResponse.receipt.id, verdict }),
      });
      const result = await response.json() as { updated?: boolean; reason?: string; error?: string; execution?: ToolExecutionResult };
      if (!response.ok) throw new Error(result.reason ?? result.error ?? "Review could not be saved.");
      if (verdict === "safe" && result.execution && !result.execution.executed) {
        setAnalystDecision("failed");
        setGatewayError(result.execution.safeAlternative ?? "The approved action could not execute.");
      } else setAnalystDecision(verdict);
      const execution = result.execution;
      if (execution) setGatewayResponse((current) => current ? { ...current, execution } : current);
      await refreshAudit();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : "Review could not be saved.");
    } finally {
      setReviewing(false);
    }
  }

  return (
    <main className="apx-lab min-h-screen overflow-x-hidden bg-[#07090b] text-[#eff3ef]">
      <WorkspaceHeader active="lab" />
      <div className="lab-shell">
        <div className="lab-toolbar">
          <WorkspaceHeading eyebrow="ATTACK LAB / SYNTHETIC SANDBOX" title={currentPanel.title} subtitle={currentPanel.subtitle} icon={<currentPanel.icon size={25} />} headingRef={headingRef} />
          {(panel === "simulation" || panel === "configure") && <button className="lab-button lab-button-primary" disabled={running || reviewing} onClick={() => { setPanel("simulation"); void submitToGateway(); }}><Play size={15} fill="currentColor" />{running ? "Running…" : "Run attack"}</button>}
        </div>
        {gatewayError && <div role="alert" className="lab-error">{gatewayError}</div>}
        <div className="lab-viewport" ref={viewportRef}>
          <section className="lab-view" id="lab-simulation" role="tabpanel" aria-labelledby="lab-tab-simulation" hidden={panel !== "simulation"}>
        <div className="lab-canvas relative flex flex-col overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0b0e11]">
          <div className="mesh-bg absolute inset-0 opacity-70" />
          <div className="lab-canvas-heading">
            <div><span className="workspace-kicker">{gatewayResponse ? "RECORDED GATEWAY OUTCOME" : "LOCAL POLICY PREVIEW"}</span><h2>{scenario.name}</h2><p>{effectiveMode} mode · {attackLevel} level · {demoActors.find((actor) => actor.id === actorId)?.name}</p></div>
            <button className="lab-button" onClick={() => setPanel("configure")}><SlidersHorizontal size={15} /> Configure</button>
          </div>
          <LabExecutionFlow
            decision={evaluation.decision}
            phase={running ? "running" : gatewayResponse ? "recorded" : "preview"}
            executed={gatewayResponse?.execution.executed}
            analystDecision={analystDecision}
            inputLabel={isCustomAction ? "Custom prompt" : scenarioId === "memory-poisoning" ? "Poisoned invoice" : scenarioId === "loop-exhaustion" ? "Tool response" : "Support ticket"}
            toolLabel={displayedAction.tool === "send_email" ? "Email connector" : displayedAction.tool.includes("memory") ? "Agent memory" : displayedAction.tool === "database" ? "Customer DB" : displayedAction.tool.replaceAll("_", " ")}
            toolIcon={displayedAction.tool === "send_email" ? <Mail /> : displayedAction.tool.includes("shell") ? <LockKeyhole /> : <Database />}
            toolTone={displayedAction.tool === "send_email" ? "coral" : "amber"}
            traceKey={String(attackRun)}
          />
            <div className={`lab-flow-result relative flex items-center justify-between rounded-2xl border p-4 backdrop-blur-xl transition-colors ${evaluation.decision === "block" ? "border-[#ff6b4a]/25 bg-[#ff6b4a]/[0.07]" : evaluation.decision === "approval_required" ? "border-[#f4b860]/25 bg-[#f4b860]/[0.06]" : "border-white/[0.08] bg-white/[0.04]"}`}>
              <div className="flex items-center gap-3">
                <div className={`grid size-9 place-items-center rounded-xl ${evaluation.decision === "block" ? "bg-[#ff6b4a]/15 text-[#ff8064]" : evaluation.decision === "approval_required" ? "bg-[#f4b860]/15 text-[#f4b860]" : "bg-white/[0.06] text-white/65"}`}>
                  <ShieldCheck className="size-[18px]" />
                </div>
                <div>
                  <div className="text-sm font-medium">{decision.label} · Risk {decision.risk}/100</div>
                  <div className="text-xs text-white/40">{decision.copy}</div>
                </div>
              </div>
              <button className="lab-button" onClick={() => setPanel("evidence")}>Evidence <ArrowRight size={14} /></button>
            </div>
        </div>
          </section>
          <section className="lab-view lab-two" id="lab-configure" role="tabpanel" aria-labelledby="lab-tab-configure" hidden={panel !== "configure"}>
            <div className="lab-card"><span className="workspace-kicker">01 / SCENARIO</span><h2>Choose the boundary to test</h2><div className="lab-scenarios" aria-label="Attack scenarios">{attackScenarios.map((item, index) => <button key={item.id} disabled={running || reviewing} aria-pressed={scenarioId === item.id} onClick={() => selectScenario(item.id)}><span>0{index + 1}</span><b>{item.name}</b></button>)}</div><span className="workspace-kicker lab-mode-label">02 / PROTECTION MODE</span>          <div className="lab-mode-switch flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] p-1">
          {(["unprotected", "observe", "enforce"] as Mode[]).map((item) => (
            <button
              key={item}
              aria-pressed={mode === item}
              disabled={running || reviewing} onClick={() => selectMode(item)}
              className={`rounded-full px-4 py-2 text-xs font-medium capitalize transition-all ${mode === item ? "bg-white/[0.11] text-white shadow-sm" : "text-white/40 hover:text-white/70"}`}
            >
              {item}
            </button>
          ))}
          </div>
<p className="lab-help">Unprotected and Observe simulate tool reach for unchanged synthetic fixtures. Edited inputs are always enforced.</p>          <div className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-white/38">Assigned task</span>
              <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-white/45">TASK-0042</span>
            </div>
            <p className="text-sm leading-relaxed text-white/78">Summarize the customer&apos;s billing issue and draft an internal response.</p>
          </div>

</div>
            <div className="lab-card"><span className="workspace-kicker">03 / INPUT</span><h2>Shape the proposed action</h2>          <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-white/60">Attack level</span><span className="text-[10px] text-white/30">Subtlety, not guaranteed success</span></div>
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1">{attackLevels.map((level) => <button key={level} disabled={running || reviewing} onClick={() => { setAttackLevel(level); setPromptText(promptForLevel(scenarioId, level)); clearResult(); }} className={`rounded-lg px-1 py-2 text-[10px] font-medium capitalize transition ${attackLevel === level ? "bg-[#c8f560]/15 text-[#d9ff77]" : "text-white/35 hover:text-white/70"}`}>{level}</button>)}</div>
            <div className="mt-3 flex items-center justify-between gap-3"><label htmlFor="demo-actor" className="text-[11px] text-white/60">Attack as synthetic user</label><select disabled={running || reviewing} id="demo-actor" value={actorId} onChange={(event) => { setActorId(event.target.value); clearResult(); }} className="rounded-lg border border-white/[0.08] bg-[#151a1d] px-2 py-1.5 text-[11px] text-white/70">{demoActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></div>
            {gatewayResponse?.auditIdentity && <div className="mt-3 rounded-lg border border-[#c8f560]/20 bg-[#c8f560]/[0.05] p-2 text-[10px] text-[#c8f560]">Verified in backend log: {gatewayResponse.auditIdentity.actorName}<span className="mt-1 block break-all font-mono text-white/35">prompt {gatewayResponse.auditIdentity.promptId}</span></div>}
            <div className="my-4 border-t border-white/[0.06]" />
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <label htmlFor="attack-prompt" className="text-[11px] font-medium text-white/60">Prompt / untrusted content</label>
              <span className="text-right text-[10px] text-white/30">Known secrets redacted in logs</span>
            </div>
            <textarea disabled={running || reviewing} id="attack-prompt" value={promptText} onChange={(event) => { setPromptText(event.target.value); clearResult(); }} maxLength={10_000} spellCheck={false} className="soc-scrollbar min-h-24 w-full resize-y rounded-xl border border-white/[0.07] bg-black/20 p-3 text-xs leading-relaxed text-white/75 outline-none focus:border-[#c8f560]/35" />
            <p className="mt-2 text-[10px] leading-relaxed text-white/35">Edit freely. A deterministic mock agent extracts supported intents into the proposed tool action; use the action inspector for exact payloads. Unknown wording may be missed.</p>
            {mode !== "enforce" && !stockReplay && <p className="mt-2 rounded-lg border border-[#f4b860]/20 bg-[#f4b860]/[0.06] p-2 text-[10px] text-[#f4b860]">Edited prompts and actions run in Enforce mode. Unprotected and Observe are reserved for unchanged synthetic scenarios.</p>}
            {gatewayResponse && gatewayResponse.evaluation.mode !== mode && <p className="mt-2 text-[10px] text-[#f4b860]">This submission was enforced because its action differed from the stock demo.</p>}
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 font-mono text-[10px] text-white/45">Proposal → {displayedAction.tool}.{displayedAction.operation} · {displayedAction.destination ?? String(displayedAction.arguments.path ?? displayedAction.arguments.tenantId ?? "scoped")}</div>
          </div>

            <Dialog onOpenChange={(open) => { if (open) setPayloadText(JSON.stringify(displayedAction, null, 2)); }}>
              <DialogTrigger asChild>
                <button disabled={running || reviewing} className="mt-5 w-full rounded-xl border border-white/[0.09] bg-white/[0.04] py-3 text-xs font-medium text-white/72 transition hover:bg-white/[0.07]">Open live action inspector</button>
              </DialogTrigger>
              <DialogContent className="max-h-[82vh] overflow-auto border-white/[0.1] bg-[#0d1114] text-white sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Live action inspector · {displayedAction.id}</DialogTitle>
                  <DialogDescription>Edit the proposed tool call, then submit it to the real server-side gateway.</DialogDescription>
                </DialogHeader>
                {gatewayError && <p role="alert" className="rounded-lg bg-[#ff6b4a]/10 p-3 text-xs text-[#ff8064]">{gatewayError}</p>}
                <textarea disabled={running || reviewing} aria-label="Action JSON" value={payloadText} onChange={(event) => setPayloadText(event.target.value)} spellCheck={false} className="min-h-64 w-full resize-y rounded-xl border border-white/[0.08] bg-black/30 p-4 font-mono text-[11px] leading-relaxed text-white/65 outline-none focus:border-[#c8f560]/30" />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] text-white/35">Try changing a path, tenantId, table, destination, or data lineage.</span>
                  <button onClick={runCustomPayload} disabled={running || reviewing} className="shrink-0 rounded-xl bg-[#c8f560] px-4 py-2.5 text-xs font-semibold text-[#11150c] disabled:opacity-50">Evaluate payload</button>
                </div>
                {gatewayResponse && (
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
                    <div className="flex items-center justify-between text-xs"><b className="uppercase tracking-wider text-[#c8f560]">Policy receipt</b><span className="font-mono text-white/40">{gatewayResponse.receipt.id}</span></div>
                    <div className="mt-3 grid grid-cols-3 gap-3 text-[10px] text-white/45"><span><b className="block text-white/80">{gatewayResponse.evaluation.decision}</b>decision</span><span><b className="block text-white/80">{gatewayResponse.evaluation.riskScore}/100</b>risk</span><span><b className="block text-white/80">{String(gatewayResponse.execution.executed)}</b>executed</span></div>
                    <div className="mt-3 truncate border-t border-white/[0.07] pt-3 font-mono text-[9px] text-white/30">sha256 {gatewayResponse.receipt.hash}</div>
                    <div className="mt-3 border-t border-white/[0.07] pt-3 text-[10px] uppercase tracking-wider text-white/40">Policy findings</div>
                    <div className="mt-2 space-y-2">{gatewayResponse.evaluation.findings.length ? gatewayResponse.evaluation.findings.map((finding) => <div key={finding.id} className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5 text-xs"><b className="text-white/75">{finding.title}</b><p className="mt-1 text-white/45">{finding.description}</p></div>) : <p className="text-xs text-[#c8f560]">No policy findings.</p>}</div>
                    <div className="mt-3 border-t border-white/[0.07] pt-3 text-[10px] uppercase tracking-wider text-white/40">Mock tool result</div>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/25 p-3 text-[10px] leading-relaxed text-white/55">{JSON.stringify(gatewayResponse.execution.output ?? { status: gatewayResponse.execution.safeAlternative ?? "Held before execution" }, null, 2)}</pre>
                  </div>
                )}
              </DialogContent>
            </Dialog></div>
          </section>
          <section className="lab-view lab-two" id="lab-evidence" role="tabpanel" aria-labelledby="lab-tab-evidence" hidden={panel !== "evidence"}>
            <div className="lab-card">          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30">Incident</div>
              <h2 className="mt-1 text-xl font-medium tracking-[-0.025em]">{isCustomAction ? "Custom prompt evaluation" : scenarioTitles[scenario.id]}</h2>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${isUnknown ? "border-[#f4b860]/20 bg-[#f4b860]/10 text-[#f4b860]" : "border-[#ff6b4a]/20 bg-[#ff6b4a]/10 text-[#ff8064]"}`}>{isCustomAction ? decision.label : isUnknown ? "Novel" : "Critical"}</span>
          </div>

<p className="lab-help">{gatewayResponse ? "Recorded gateway result for this submission." : "Policy preview only. Run the attack to store a receipt or enable analyst review."}</p>          <div className="mt-7 flex items-center justify-between">
            <h3 className="text-sm font-medium">Evidence trail</h3>
            <span className="text-[11px] text-white/30">{events.length} {events.length === 1 ? "event" : "events"} · {gatewayResponse?.latencyMs ?? "—"}ms</span>
          </div>


          <div className="mt-5 rounded-2xl border border-[#9fb8ff]/15 bg-[#9fb8ff]/[0.035] p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#adc2ff]">Capability passport</span>
              <span className="rounded-full border border-[#9fb8ff]/15 px-2 py-1 font-mono text-[9px] text-[#adc2ff]/70">SERVER SCOPE</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[10px]">
              <div><span className="block text-white/28">Tenant</span><b className="mt-0.5 block font-mono font-medium text-white/65">{demoTask.tenantId}</b></div>
              <div><span className="block text-white/28">Proposed tool</span><b className="mt-0.5 block font-mono font-medium text-white/65">{displayedAction.tool}</b></div>
              <div><span className="block text-white/28">Data scope</span><b className="mt-0.5 block font-mono font-medium text-white/65">task-bound</b></div>
              <div><span className="block text-white/28">Expiry</span><b className="mt-0.5 block font-mono font-medium text-white/65">demo task · 2099</b></div>
            </div>
          </div>

          <div className="mt-4 flex-1">
            {events.map((event, index) => (
              <div key={event.title} className="relative grid grid-cols-[56px_18px_1fr] gap-2 pb-6 last:pb-0">
                <time className="pt-0.5 font-mono text-[10px] text-white/27">{event.time}</time>
                <div className="relative flex justify-center">
                  <span className={`mt-1.5 size-2 rounded-full ${event.tone === "red" ? "bg-[#ff6b4a] shadow-[0_0_10px_#ff6b4a]" : "bg-[#f4b860]"}`} />
                  {index < events.length - 1 && <span className="absolute bottom-[-3px] top-3 w-px bg-white/[0.09]" />}
                </div>
                <div>
                  <div className="text-[13px] font-medium text-white/80">{event.title}</div>
                  <div className="mt-1 break-all font-mono text-[10px] leading-relaxed text-white/30">{event.detail}</div>
                </div>
              </div>
            ))}
          </div>

          <div className={`mt-5 rounded-2xl border p-4 ${requiresReview ? "border-[#f4b860]/20 bg-[#f4b860]/[0.04]" : "border-[#c8f560]/15 bg-[#c8f560]/[0.035]"}`}>
            <div className="flex items-center justify-between">
              <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${effectiveMode === "unprotected" || requiresReview && analystDecision === "pending" ? "text-[#f4b860]" : "text-[#c8f560]/70"}`}>{effectiveMode === "unprotected" ? "Policy bypass mode" : requiresReview ? analystDecision === "pending" ? "Analyst decision needed" : "Analyst decision recorded" : "Automatically resolved"}</div>
              <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[9px] text-white/35">{effectiveMode === "unprotected" ? "Synthetic only" : requiresReview ? "Novel · ambiguous" : "Deterministic policy"}</span>
            </div>
            <p className="mt-2 text-[13px] font-medium leading-relaxed text-white/80">
              {responseCopy}
            </p>
            {requiresReview ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-3 text-[9px] text-white/42">
                  <span><b className="block text-white/70">1 action</b>{displayedAction.operation.replaceAll("_", " ")}</span>
                  <span><b className="block text-white/70">5 minutes</b>auto expires</span>
                  <span><b className="block text-white/70">No new data</b>same scope</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => resolveReview("contained")} disabled={running || reviewing || !gatewayResponse || analystDecision !== "pending"} className={`flex-1 rounded-xl px-3 py-2.5 text-[11px] font-semibold transition disabled:opacity-45 ${analystDecision === "contained" ? "bg-[#c8f560]/15 text-[#c8f560]" : "bg-[#c8f560] text-[#11150c] hover:bg-[#d9ff77]"}`}>
                    {analystDecision === "contained" ? "Session kept isolated" : "Keep isolated"}
                  </button>
                  <button onClick={() => resolveReview("safe")} disabled={running || reviewing || !gatewayResponse || analystDecision !== "pending"} className="rounded-xl border border-white/[0.09] px-3 py-2.5 text-[11px] text-white/55 transition hover:bg-white/[0.05] disabled:opacity-45">
                    {analystDecision === "safe" ? "Approved once" : "Approve once"}
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2.5 text-[10px] text-white/40">
                <ShieldCheck className="size-3.5 text-[#c8f560]" /> {effectiveMode === "unprotected" ? "Policy bypassed" : effectiveMode === "observe" ? "Policy observed" : "Policy applied"} · {gatewayResponse ? (gatewayResponse.execution.executed ? effectiveMode === "unprotected" || effectiveMode === "observe" ? "synthetic tool reach simulated" : "mock tool executed" : "execution stopped") : "awaiting run"} · audit {gatewayResponse ? "stored" : "pending"}
              </div>
            )}
            <div className="mt-3 flex items-center gap-3 text-[9px] text-white/30">
              <TimerReset className="size-3" /><span>Scoped response</span><span>✓ preserve audit</span><span>✓ reversible</span>
            </div>
          </div>

</div>
            <div className="lab-card"><span className="workspace-kicker">EXECUTION PATH</span><h2>How this action reached the gate</h2>            <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Attack flow</div><div className="mt-3 space-y-2 text-[11px]">{[["01", "Untrusted input", "Editable prompt enters sandbox"], ["02", "Mock agent proposal", `${displayedAction.tool}.${displayedAction.operation}`], ["03", "Policy gateway", `${evaluation.findings.length} findings · ${evaluation.decision}`], ["04", "Tool boundary", gatewayResponse ? gatewayResponse.execution.executed ? effectiveMode === "unprotected" || effectiveMode === "observe" ? "Synthetic tool reach simulated" : "Mock action executed" : "Action held" : "Awaiting run"], ["05", "SOC audit", gatewayResponse ? "Receipt stored for analyst" : "Prompt and receipt on run"]].map(([number, title, subtitle]) => <div key={number} className="flex gap-3"><span className="font-mono text-[#c8f560]/60">{number}</span><span><b className="block font-medium text-white/70">{title}</b><span className="text-[10px] text-white/35">{subtitle}</span></span></div>)}</div></div>

</div>
          </section>
          <section className="lab-view" id="lab-bench" role="tabpanel" aria-labelledby="lab-tab-bench" hidden={panel !== "bench"}>
            <div className="lab-card lab-bench-card"><span className="workspace-kicker">RECORDED BENCHMARK</span><h2>Containment and false alarms</h2><p className="lab-help">Measured from stored sandbox runs. These are deterministic fixtures, not a claim about every real-world attack.</p>          <div className="lab-bench-summary items-center gap-2 rounded-full border border-[#c8f560]/15 bg-[#c8f560]/[0.045] px-3 py-2 text-[11px] text-white/55">
            <Zap className="size-3.5 text-[#c8f560]" />
            <span><b className="font-semibold text-white/80">{auditData?.metrics.attacks ? `${auditData.metrics.contained}/${auditData.metrics.attacks}` : "—"}</b> attacks contained</span>
            <span className="text-white/20">·</span>
            <span><b className="font-semibold text-[#f4b860]">{auditData?.metrics.legitimate ? auditData.metrics.falsePositives : "—"}</b> measured false positives</span>
          </div>

            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-white/38">Recorded test bench</span>
              <span className="text-xs font-medium text-[#c8f560]">{auditData?.metrics.attempts ?? 0} stored runs</span>
            </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#6a812f] to-[#c8f560]" style={{ width: `${(auditData?.metrics.defenseRate ?? 0) * 100}%` }} />
              </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric value={auditData?.metrics.attacks ? `${Math.round((auditData.metrics.defenseRate ?? 0) * 1000) / 10}%` : "—"} label="Attack containment" />
              <Metric value={auditData?.metrics.attacks ? String(auditData.metrics.attacks - auditData.metrics.contained) : "—"} label="Misses" tone="amber" />
              <Metric value={auditData?.metrics.legitimate ? `${Math.round((auditData.metrics.falsePositiveRate ?? 0) * 100)}%` : "—"} label="False positives" tone="amber" />
            </div>
            <button onClick={runSuite} disabled={suiteRunning} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#c8f560] px-4 py-3 text-xs font-semibold text-[#11150c] transition hover:bg-[#d9ff77] disabled:opacity-55"><FlaskConical className="size-4" />{suiteRunning ? `Running all ${evaluationCases.length} cases…` : `Run ${evaluationCases.length}-case attack bench`}</button>
            {suiteError && <p className="mt-2 text-[10px] text-[#ff8064]">{suiteError}</p>}
</div>
          </section>
          <section className="lab-view" id="lab-history" role="tabpanel" aria-labelledby="lab-tab-history" hidden={panel !== "history"}>
            <div className="lab-card lab-history-card"><AuditExplorer refreshKey={auditRefreshKey} active={panel === "history"} /></div>
          </section>
        </div>
      </div>
      <div className={`lab-dock-zone ${dockPinned ? "pinned" : ""}`}>
        <button className="lab-dock-handle" aria-label="Keep attack lab navigation visible" aria-pressed={dockPinned} onClick={() => setDockPinned((value) => !value)}><ChevronUp size={13} />Panels</button>
        <nav className="lab-dock" role="tablist" aria-label="Attack lab panels">{labPanels.map((item, index) => <button key={item.id} id={`lab-tab-${item.id}`} role="tab" aria-selected={panel === item.id} aria-controls={`lab-${item.id}`} tabIndex={panel === item.id ? 0 : -1} onClick={() => setPanel(item.id)} onKeyDown={(event) => { let next: number | undefined; if (event.key === "ArrowRight") next = (index + 1) % labPanels.length; else if (event.key === "ArrowLeft") next = (index - 1 + labPanels.length) % labPanels.length; else if (event.key === "Home") next = 0; else if (event.key === "End") next = labPanels.length - 1; if (next === undefined) return; event.preventDefault(); setPanel(labPanels[next].id); document.getElementById(`lab-tab-${labPanels[next].id}`)?.focus(); }}><item.icon size={21} strokeWidth={1.7} /><small>{item.label}</small></button>)}</nav>
      </div>
    </main>
  );
}

function Metric({ value, label, tone = "green" }: { value: string; label: string; tone?: "green" | "amber" }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-2.5">
      <div className={`text-sm font-semibold ${tone === "amber" ? "text-[#f4b860]" : "text-[#c8f560]"}`}>{value}</div>
      <div className="mt-0.5 text-[9px] leading-tight text-white/32">{label}</div>
    </div>
  );
}
