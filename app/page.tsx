"use client";

import {
  Activity,
  Database,
  FileWarning,
  LockKeyhole,
  Mail,
  Play,
  Radar,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Zap,
  History,
  FlaskConical,
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

type AnalystDecision = "pending" | "contained" | "safe";
type AuditData = {
  prompts: PromptRecord[];
  runs: StoredRun[];
  metrics: { attempts: number; attacks: number; contained: number; defenseRate: number | null; legitimate: number; falsePositives: number; falsePositiveRate: number | null };
};

export default function Home() {
  const [mode, setMode] = useState<Mode>("enforce");
  const [scenarioId, setScenarioId] = useState(attackScenarios[0].id);
  const [attackLevel, setAttackLevel] = useState<AttackLevel>("easy");
  const [actorId, setActorId] = useState<string>(actorForScenario(attackScenarios[0].id).id);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [analystDecision, setAnalystDecision] = useState<AnalystDecision>("pending");
  const [gatewayResponse, setGatewayResponse] = useState<GatewayResponse | null>(null);
  const [gatewayError, setGatewayError] = useState("");
  const [promptText, setPromptText] = useState(attackScenarios[0].prompt);
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(attackScenarios[0].action, null, 2));
  const [auditData, setAuditData] = useState<AuditData | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [suiteError, setSuiteError] = useState("");
  const incidentPanelRef = useRef<HTMLElement>(null);
  const scenario = attackScenarios.find((item) => item.id === scenarioId) ?? attackScenarios[0];
  const proposedAction = useMemo(() => proposeAction(scenarioId, attackLevel, promptText), [scenarioId, attackLevel, promptText]);
  const previewEvaluation = useMemo(() => evaluateAction(demoTask, proposedAction, mode), [mode, proposedAction]);
  const evaluation = gatewayResponse?.evaluation ?? previewEvaluation;
  const decision = {
    label: evaluation.decision === "block" ? "Blocked" : evaluation.decision === "observe" ? "Observed" : evaluation.decision === "approval_required" ? "Approval required" : "Allowed",
    risk: evaluation.riskScore,
    copy: mode === "unprotected" ? "Protection disabled" : `${evaluation.findings.length} policy ${evaluation.findings.length === 1 ? "violation" : "violations"}`,
  };
  const events = evaluation.findings.slice(0, 3).map((finding) => ({
    time: gatewayResponse ? new Date(evaluation.evaluatedAt).toLocaleTimeString([], { hour12: false }) : "preview",
    title: finding.title,
    detail: Object.values(finding.evidence).flat().slice(0, 2).join(" · ") || finding.description,
    tone: finding.severity === "critical" ? "red" : "amber",
  }));
  const isUnknown = scenario.id === "unknown-behavior";
  const isToolEscalation = scenario.id === "tool-escalation";
  const isGoalHijack = scenario.id === "goal-hijack";
  const noveltyFinding = evaluation.findings.find((finding) => finding.id === "novel-behavior");
  const requiresReview = evaluation.decision === "approval_required";
  const responseCopy = mode === "unprotected"
    ? "Policy findings are recorded, but this mode lets the mock tool call continue for comparison."
    : requiresReview
    ? analystDecision === "safe"
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
    incidentPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [scenarioId, mode]);

  function selectScenario(id: string) {
    const next = attackScenarios.find((item) => item.id === id) ?? attackScenarios[0];
    setScenarioId(id);
    setAnalystDecision("pending");
    setGatewayResponse(null);
    setGatewayError("");
    setPromptText(next.prompt);
    setPayloadText(JSON.stringify(next.action, null, 2));
    setAttackLevel("easy");
    setActorId(actorForScenario(id).id);
  }

  function selectMode(nextMode: Mode) {
    setMode(nextMode);
    setAnalystDecision("pending");
    setGatewayResponse(null);
    setGatewayError("");
  }

  async function submitToGateway(action = proposedAction) {
    setRunning(true);
    setGatewayError("");
    setAnalystDecision("pending");
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
      window.setTimeout(() => setRunning(false), 850);
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
    if (!gatewayResponse) return;
    try {
      const response = await fetch("/api/audit", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: gatewayResponse.receipt.id, verdict }),
      });
      const result = await response.json() as { updated?: boolean; reason?: string; error?: string; execution?: ToolExecutionResult };
      if (!response.ok) throw new Error(result.reason ?? result.error ?? "Review could not be saved.");
      setAnalystDecision(verdict);
      const execution = result.execution;
      if (execution) setGatewayResponse((current) => current ? { ...current, execution } : current);
      await refreshAudit();
    } catch (error) {
      setGatewayError(error instanceof Error ? error.message : "Review could not be saved.");
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#07090b] text-[#eff3ef]">
      <header className="flex h-[72px] items-center justify-between border-b border-white/[0.08] px-5 md:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl border border-[#c8f560]/25 bg-[#c8f560]/[0.08]">
            <ShieldCheck className="size-[18px] text-[#c8f560]" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">APX</div>
            <div className="text-[11px] text-white/40">AgniParixa Execution Firewall</div>
          </div>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <div className="hidden items-center gap-2 rounded-full border border-[#c8f560]/15 bg-[#c8f560]/[0.045] px-3 py-2 text-[11px] text-white/55 xl:flex">
            <Zap className="size-3.5 text-[#c8f560]" />
            <span><b className="font-semibold text-white/80">{auditData?.metrics.attacks ? `${auditData.metrics.contained}/${auditData.metrics.attacks}` : "—"}</b> attacks contained</span>
            <span className="text-white/20">·</span>
            <span><b className="font-semibold text-[#f4b860]">{auditData?.metrics.legitimate ? auditData.metrics.falsePositives : "—"}</b> measured false positives</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] p-1">
          {(["unprotected", "observe", "enforce"] as Mode[]).map((item) => (
            <button
              key={item}
              onClick={() => selectMode(item)}
              className={`rounded-full px-4 py-2 text-xs font-medium capitalize transition-all ${mode === item ? "bg-white/[0.11] text-white shadow-sm" : "text-white/40 hover:text-white/70"}`}
            >
              {item}
            </button>
          ))}
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.045] px-3 py-2 text-xs text-white/65">
          <span className="size-1.5 rounded-full bg-[#c8f560] shadow-[0_0_8px_#c8f560]" />
          Demo sandbox
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-4 p-4 lg:h-[calc(100vh-72px)] lg:grid-cols-[minmax(0,1fr)_360px] lg:p-5">
        <div className="relative min-h-[640px] overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0b0e11] lg:min-h-0">
          <div className="mesh-bg absolute inset-0 opacity-70" />
          <div className="absolute left-5 right-5 top-5 z-20 flex items-start justify-between md:left-7 md:right-7 md:top-7">
            <div className="min-w-0 flex-1 pr-3">
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
                <Activity className="size-3.5" /> {gatewayResponse ? "Recorded execution trace" : "Execution preview"}
              </div>
              <h1 className="max-w-xl text-[clamp(1.65rem,3vw,2.7rem)] font-medium leading-[1.05] tracking-[-0.045em]">Every AI action<br />must pass through AgniParixa.</h1>
              <div className="soc-scrollbar mt-4 flex max-w-full gap-2 overflow-x-auto whitespace-nowrap pb-2">
                {attackScenarios.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => selectScenario(item.id)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition ${scenarioId === item.id ? "border-[#c8f560]/35 bg-[#c8f560]/10 text-[#d9ff77]" : "border-white/[0.08] bg-black/20 text-white/38 hover:text-white/65"}`}
                  >
                    0{index + 1} · {item.name}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => submitToGateway()}
              disabled={running}
              className="group flex shrink-0 items-center gap-2 self-start rounded-full bg-[#c8f560] px-4 py-2.5 text-xs font-semibold text-[#11150c] transition hover:bg-[#d9ff77] disabled:opacity-65 md:px-5 md:py-3"
            >
              <Play className={`size-3.5 fill-current ${running ? "animate-pulse" : ""}`} />
              {running ? "Enforcing…" : "Run attack"}
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 top-[150px]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <defs>
                <linearGradient id="route" x1="0" x2="1">
                  <stop offset="0" stopColor="#98a7a1" stopOpacity="0.12" />
                  <stop offset="0.55" stopColor="#c8f560" stopOpacity="0.6" />
                  <stop offset="1" stopColor="#ff6b4a" stopOpacity="0.35" />
                </linearGradient>
              </defs>
              <path d="M135 280 C250 280 265 145 385 145 S555 280 635 280 S760 390 865 390" fill="none" stroke="url(#route)" strokeWidth="2" strokeDasharray="5 8" />
              <path d="M385 145 C485 145 515 75 635 75" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="1.5" />
              <path d="M635 280 C705 280 760 205 865 205" fill="none" stroke="#fff" strokeOpacity="0.09" strokeWidth="1.5" />
              {running && (
                <circle r="5" fill="#c8f560" className="route-dot">
                  <animateMotion dur="2.1s" fill="freeze" path="M135 280 C250 280 265 145 385 145 S555 280 635 280 S760 390 865 390" />
                </circle>
              )}
            </svg>

            <TraceNode icon={isUnknown ? <Radar /> : isToolEscalation ? <LockKeyhole /> : <FileWarning />} label={isUnknown ? "Agent session" : isGoalHijack ? "User request" : isToolEscalation ? "Injected request" : scenarioId === "memory-poisoning" ? "Poisoned invoice" : scenarioId === "loop-exhaustion" ? "Tool response" : "Support ticket"} meta={isUnknown ? "No signature match" : isGoalHijack ? "Outside assigned goal" : "Untrusted source"} className="left-[12%] top-[37%]" state="warning" />
            <TraceNode icon={<Sparkles />} label="Nova agent" meta="Task: summarize ticket" className="left-[31%] top-[13%]" state="active" />
            <TraceNode icon={isToolEscalation ? <LockKeyhole /> : <Database />} label={isUnknown ? "Context bundler" : isGoalHijack ? "Goal boundary" : isToolEscalation ? "Shell tool" : scenarioId === "memory-poisoning" ? "Agent memory" : scenarioId === "loop-exhaustion" ? "Iteration 9" : "Customer DB"} meta={isUnknown ? "Unseen tool sequence" : isGoalHijack ? "6% task relevance" : isToolEscalation ? "Not in capability set" : scenarioId === "loop-exhaustion" ? "Budget exceeded" : "Protected resource"} className="left-[57%] top-[37%]" state="warning" />
            <TraceNode icon={<Mail />} label={isUnknown ? "Approval gate" : isGoalHijack ? "Policy gateway" : isToolEscalation ? "Execution boundary" : scenarioId === "memory-poisoning" ? "Trust policy" : scenarioId === "loop-exhaustion" ? "Next tool call" : "External email"} meta={analystDecision === "contained" ? "Contained by analyst" : analystDecision === "safe" ? "Approved once" : requiresReview ? "Awaiting analyst" : evaluation.decision === "block" ? "Auto-contained" : "Action continued"} className="left-[79%] top-[62%]" state={evaluation.decision === "block" || analystDecision === "contained" ? "blocked" : analystDecision === "safe" ? "active" : "warning"} />

            <div className="absolute left-[53%] top-[10%] hidden w-[206px] rounded-2xl border border-white/[0.08] bg-[#101418]/90 p-4 shadow-2xl backdrop-blur-xl md:block">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">{isUnknown ? "Behavior drift" : isToolEscalation ? "Capability check" : "Task boundary"}</div>
              <div className="text-sm font-medium">{isUnknown ? `${String(noveltyFinding?.evidence.noveltyScore ?? 0)}/100 novelty` : isToolEscalation ? "Tool not granted" : `${Math.round(proposedAction.taskRelevance * 100)}% relevance`}</div>
              <p className="mt-1 text-xs leading-relaxed text-white/42">{scenario.summary}</p>
              {isUnknown && <div className="mt-3 border-t border-white/[0.07] pt-2 font-mono text-[9px] uppercase tracking-wider text-[#f4b860]">Known signature: none</div>}
            </div>

            <div className={`absolute bottom-5 left-5 right-5 flex items-center justify-between rounded-2xl border p-4 backdrop-blur-xl transition-colors md:bottom-7 md:left-7 md:right-7 ${evaluation.decision === "block" ? "border-[#ff6b4a]/25 bg-[#ff6b4a]/[0.07]" : evaluation.decision === "approval_required" ? "border-[#f4b860]/25 bg-[#f4b860]/[0.06]" : "border-white/[0.08] bg-white/[0.04]"}`}>
              <div className="flex items-center gap-3">
                <div className={`grid size-9 place-items-center rounded-xl ${evaluation.decision === "block" ? "bg-[#ff6b4a]/15 text-[#ff8064]" : evaluation.decision === "approval_required" ? "bg-[#f4b860]/15 text-[#f4b860]" : "bg-white/[0.06] text-white/65"}`}>
                  <ShieldCheck className="size-[18px]" />
                </div>
                <div>
                  <div className="text-sm font-medium">{decision.label} · Risk {decision.risk}/100</div>
                  <div className="text-xs text-white/40">{decision.copy}</div>
                </div>
              </div>
              <div className="hidden gap-2 sm:flex">
                {evaluation.findings.slice(0, 3).map((finding) => (
                  <span key={finding.id} className="rounded-full border border-white/[0.08] bg-black/20 px-3 py-1.5 text-[11px] text-white/48">{finding.id.replaceAll("-", " ")}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside ref={incidentPanelRef} className="soc-scrollbar flex min-h-[640px] flex-col overflow-x-hidden overflow-y-auto rounded-[26px] border border-white/[0.08] bg-[#0b0e11] p-5 lg:min-h-0">
          <div className="mb-5 flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.035] p-1 md:hidden">
            {(["unprotected", "observe", "enforce"] as Mode[]).map((item) => <button key={item} onClick={() => selectMode(item)} className={`flex-1 rounded-full px-2 py-2 text-[11px] font-medium capitalize ${mode === item ? "bg-white/[0.11] text-white" : "text-white/40"}`}>{item}</button>)}
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/30">Incident</div>
              <h2 className="mt-1 text-xl font-medium tracking-[-0.025em]">{scenarioTitles[scenario.id]}</h2>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${isUnknown ? "border-[#f4b860]/20 bg-[#f4b860]/10 text-[#f4b860]" : "border-[#ff6b4a]/20 bg-[#ff6b4a]/10 text-[#ff8064]"}`}>{isUnknown ? "Novel" : "Critical"}</span>
          </div>

          <div className="mt-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-white/38">Assigned task</span>
              <span className="rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-white/45">TASK-0042</span>
            </div>
            <p className="text-sm leading-relaxed text-white/78">Summarize the customer&apos;s billing issue and draft an internal response.</p>
          </div>

          <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="mb-3 flex items-center justify-between gap-2"><span className="text-[11px] font-medium text-white/60">Attack level</span><span className="text-[10px] text-white/30">Subtlety, not guaranteed success</span></div>
            <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1">{attackLevels.map((level) => <button key={level} onClick={() => { setAttackLevel(level); setPromptText(promptForLevel(scenarioId, level)); setGatewayResponse(null); }} className={`rounded-lg px-1 py-2 text-[10px] font-medium capitalize transition ${attackLevel === level ? "bg-[#c8f560]/15 text-[#d9ff77]" : "text-white/35 hover:text-white/70"}`}>{level}</button>)}</div>
            <div className="mt-3 flex items-center justify-between gap-3"><label htmlFor="demo-actor" className="text-[10px] text-white/40">Synthetic user</label><select id="demo-actor" value={actorId} onChange={(event) => setActorId(event.target.value)} className="rounded-lg border border-white/[0.08] bg-[#151a1d] px-2 py-1.5 text-[11px] text-white/70">{demoActors.map((actor) => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></div>
            <div className="my-4 border-t border-white/[0.06]" />
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="attack-prompt" className="text-[11px] font-medium text-white/60">Prompt / untrusted content</label>
              <span className="text-[10px] text-white/30">Stored verbatim on submit</span>
            </div>
            <textarea id="attack-prompt" value={promptText} onChange={(event) => setPromptText(event.target.value)} maxLength={10_000} spellCheck={false} className="soc-scrollbar min-h-24 w-full resize-y rounded-xl border border-white/[0.07] bg-black/20 p-3 text-xs leading-relaxed text-white/75 outline-none focus:border-[#c8f560]/35" />
            <p className="mt-2 text-[10px] leading-relaxed text-white/35">Edit freely. A deterministic mock agent extracts supported intents into the proposed tool action; use the action inspector for exact payloads. Unknown wording may be missed.</p>
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 font-mono text-[10px] text-white/45">Proposal → {proposedAction.tool}.{proposedAction.operation} · {proposedAction.destination ?? String(proposedAction.arguments.path ?? proposedAction.arguments.tenantId ?? "scoped")}</div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Attack flow</div><div className="mt-3 space-y-2 text-[11px]">{[["01", "Untrusted input", "Editable prompt enters sandbox"], ["02", "Mock agent proposal", `${proposedAction.tool}.${proposedAction.operation}`], ["03", "Policy gateway", `${evaluation.findings.length} findings · ${evaluation.decision}`], ["04", "Tool boundary", gatewayResponse ? gatewayResponse.execution.executed ? "Mock action executed" : "Action held" : "Awaiting run"], ["05", "SOC audit", gatewayResponse ? "Receipt stored for analyst" : "Prompt and receipt on run"]].map(([number, title, subtitle]) => <div key={number} className="flex gap-3"><span className="font-mono text-[#c8f560]/60">{number}</span><span><b className="block font-medium text-white/70">{title}</b><span className="text-[10px] text-white/35">{subtitle}</span></span></div>)}</div></div>

          <div className="mt-7 flex items-center justify-between">
            <h3 className="text-sm font-medium">Evidence trail</h3>
            <span className="text-[11px] text-white/30">{events.length} {events.length === 1 ? "event" : "events"} · {gatewayResponse?.latencyMs ?? "—"}ms</span>
          </div>

          {gatewayError && <div className="mt-4 rounded-xl border border-[#ff6b4a]/20 bg-[#ff6b4a]/[0.06] p-3 text-xs text-[#ff8064]">{gatewayError}</div>}

          <div className="mt-5 rounded-2xl border border-[#9fb8ff]/15 bg-[#9fb8ff]/[0.035] p-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#adc2ff]">Capability passport</span>
              <span className="rounded-full border border-[#9fb8ff]/15 px-2 py-1 font-mono text-[9px] text-[#adc2ff]/70">SERVER SCOPE</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-[10px]">
              <div><span className="block text-white/28">Tenant</span><b className="mt-0.5 block font-mono font-medium text-white/65">{demoTask.tenantId}</b></div>
              <div><span className="block text-white/28">Proposed tool</span><b className="mt-0.5 block font-mono font-medium text-white/65">{proposedAction.tool}</b></div>
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
              <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${mode === "unprotected" || requiresReview && analystDecision === "pending" ? "text-[#f4b860]" : "text-[#c8f560]/70"}`}>{mode === "unprotected" ? "Policy bypass mode" : requiresReview ? analystDecision === "pending" ? "Analyst decision needed" : "Analyst decision recorded" : "Automatically resolved"}</div>
              <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[9px] text-white/35">{mode === "unprotected" ? "Sandbox only" : requiresReview ? "Novel · ambiguous" : "Deterministic policy"}</span>
            </div>
            <p className="mt-2 text-[13px] font-medium leading-relaxed text-white/80">
              {responseCopy}
            </p>
            {requiresReview ? (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-3 text-[9px] text-white/42">
                  <span><b className="block text-white/70">1 action</b>send digest</span>
                  <span><b className="block text-white/70">5 minutes</b>auto expires</span>
                  <span><b className="block text-white/70">No new data</b>same scope</span>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => resolveReview("contained")} disabled={!gatewayResponse || analystDecision !== "pending"} className={`flex-1 rounded-xl px-3 py-2.5 text-[11px] font-semibold transition disabled:opacity-45 ${analystDecision === "contained" ? "bg-[#c8f560]/15 text-[#c8f560]" : "bg-[#c8f560] text-[#11150c] hover:bg-[#d9ff77]"}`}>
                    {analystDecision === "contained" ? "Session kept isolated" : "Keep isolated"}
                  </button>
                  <button onClick={() => resolveReview("safe")} disabled={!gatewayResponse || analystDecision !== "pending"} className="rounded-xl border border-white/[0.09] px-3 py-2.5 text-[11px] text-white/55 transition hover:bg-white/[0.05] disabled:opacity-45">
                    {analystDecision === "safe" ? "Approved once" : "Approve once"}
                  </button>
                </div>
              </>
            ) : (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2.5 text-[10px] text-white/40">
                <ShieldCheck className="size-3.5 text-[#c8f560]" /> {mode === "unprotected" ? "Policy bypassed" : "Policy applied"} · {gatewayResponse ? (gatewayResponse.execution.executed ? "mock tool executed" : "execution stopped") : "awaiting run"} · audit {gatewayResponse ? "stored" : "pending"}
              </div>
            )}
            <div className="mt-3 flex items-center gap-3 text-[9px] text-white/30">
              <TimerReset className="size-3" /><span>Scoped response</span><span>✓ preserve audit</span><span>✓ reversible</span>
            </div>
          </div>

          <div className="mt-6 border-t border-white/[0.07] pt-5">
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
            <AuditExplorer refreshKey={auditRefreshKey} />
            <Dialog>
              <DialogTrigger asChild><button className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] py-3 text-xs font-medium text-white/42 transition hover:bg-white/[0.07]"><History className="size-3.5" /> Recent raw list</button></DialogTrigger>
              <DialogContent className="max-h-[82vh] overflow-auto border-white/[0.1] bg-[#0d1114] text-white sm:max-w-3xl">
                <DialogHeader><DialogTitle>Prompt and execution log</DialogTitle><DialogDescription>Stored in the private sandbox database, including rejected prompt submissions. Recent 200 entries shown.</DialogDescription></DialogHeader>
                <a href="/api/audit/export" download className="inline-flex self-start rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-xs text-[#c8f560] hover:bg-white/[0.07]">Download full JSON log</a>
                <div className="space-y-2">
                  {auditData?.prompts.length ? auditData.prompts.map((prompt) => {
                    const run = auditData.runs.find((item) => item.promptId === prompt.id);
                    return <div key={prompt.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-3"><div className="flex flex-wrap items-center gap-2 text-[10px] text-white/40"><span className="font-mono">{new Date(prompt.createdAt).toLocaleString()}</span><span className="rounded bg-white/[0.06] px-1.5 py-0.5">{prompt.source}</span><span>{prompt.groundTruth}</span><span className="ml-auto text-[#c8f560]">{run?.decision ?? prompt.status}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-white/70">{prompt.prompt}</p>{prompt.error && <p className="mt-2 text-xs text-[#ff8064]">{prompt.error}</p>}{run && <div className="mt-2 font-mono text-[10px] text-white/35">{run.actionId} · risk {run.riskScore}/100 · tool {run.executed ? "executed" : "held"} · {run.receiptHash.slice(0, 16)}…</div>}</div>;
                  }) : <p className="rounded-xl border border-white/[0.08] p-6 text-sm text-white/45">No prompts recorded yet. Run a scenario or the full attack bench.</p>}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <button className="mt-5 w-full rounded-xl border border-white/[0.09] bg-white/[0.04] py-3 text-xs font-medium text-white/72 transition hover:bg-white/[0.07]">Open live action inspector</button>
              </DialogTrigger>
              <DialogContent className="max-h-[82vh] overflow-auto border-white/[0.1] bg-[#0d1114] text-white sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Live action inspector · {scenario.action.id}</DialogTitle>
                  <DialogDescription>Edit the proposed tool call, then submit it to the real server-side gateway.</DialogDescription>
                </DialogHeader>
                <textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} spellCheck={false} className="min-h-64 w-full resize-y rounded-xl border border-white/[0.08] bg-black/30 p-4 font-mono text-[11px] leading-relaxed text-white/65 outline-none focus:border-[#c8f560]/30" />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] text-white/35">Try changing a path, tenantId, table, destination, or data lineage.</span>
                  <button onClick={runCustomPayload} disabled={running} className="shrink-0 rounded-xl bg-[#c8f560] px-4 py-2.5 text-xs font-semibold text-[#11150c] disabled:opacity-50">Evaluate payload</button>
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
            </Dialog>
          </div>
        </aside>
      </section>
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

function TraceNode({ icon, label, meta, className, state }: { icon: React.ReactNode; label: string; meta: string; className: string; state: "active" | "warning" | "blocked" }) {
  return (
    <div className={`absolute -translate-x-1/2 -translate-y-1/2 ${className}`}>
      <div className={`relative grid size-[68px] place-items-center rounded-[22px] border shadow-2xl backdrop-blur-xl md:size-[78px] ${state === "blocked" ? "border-[#ff6b4a]/40 bg-[#2a1210] text-[#ff8064]" : state === "active" ? "border-[#c8f560]/35 bg-[#15200d] text-[#c8f560]" : "border-[#f4b860]/25 bg-[#1c1811] text-[#f4b860]"}`}>
        <span className="[&>svg]:size-5 md:[&>svg]:size-6">{icon}</span>
        <span className={`absolute -right-1 -top-1 size-3 rounded-full border-2 border-[#0b0e11] ${state === "blocked" ? "bg-[#ff6b4a]" : state === "active" ? "bg-[#c8f560]" : "bg-[#f4b860]"}`} />
      </div>
      <div className="mt-3 whitespace-nowrap text-center">
        <div className="text-xs font-medium text-white/78">{label}</div>
        <div className="mt-0.5 text-[10px] text-white/30">{meta}</div>
      </div>
    </div>
  );
}
