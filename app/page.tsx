"use client";

import {
  Activity,
  ChevronDown,
  Database,
  FileWarning,
  Mail,
  Play,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { evaluateAction } from "@/lib/security/policy-engine";
import { runEvaluation } from "@/lib/security/evaluation";
import { attackScenarios, demoTask } from "@/lib/security/scenarios";

type Mode = "unprotected" | "observe" | "enforce";

const scenarioTitles: Record<string, string> = {
  "indirect-injection": "Possible data exfiltration",
  "memory-poisoning": "Persistent trust manipulation",
  "loop-exhaustion": "Runaway agent execution",
  "unknown-behavior": "Unrecognized behavior drift",
};

type AnalystDecision = "pending" | "contained" | "safe";

export default function Home() {
  const [mode, setMode] = useState<Mode>("enforce");
  const [scenarioId, setScenarioId] = useState(attackScenarios[0].id);
  const [running, setRunning] = useState(false);
  const [analystDecision, setAnalystDecision] = useState<AnalystDecision>("pending");
  const benchmark = useMemo(() => runEvaluation(), []);
  const scenario = attackScenarios.find((item) => item.id === scenarioId) ?? attackScenarios[0];
  const evaluation = useMemo(() => evaluateAction(demoTask, scenario.action, mode), [mode, scenario]);
  const decision = {
    label: evaluation.decision === "block" ? "Blocked" : evaluation.decision === "observe" ? "Observed" : evaluation.decision === "approval_required" ? "Approval required" : "Allowed",
    risk: evaluation.riskScore,
    copy: mode === "unprotected" ? "Protection disabled" : `${evaluation.findings.length} policy ${evaluation.findings.length === 1 ? "violation" : "violations"}`,
  };
  const events = evaluation.findings.slice(0, 3).map((finding, index) => ({
    time: `10:42:08.${117 + index * 211}`,
    title: finding.title,
    detail: Object.values(finding.evidence).flat().slice(0, 2).join(" · ") || finding.description,
    tone: finding.severity === "critical" ? "red" : "amber",
  }));
  const isUnknown = scenario.id === "unknown-behavior";
  const noveltyFinding = evaluation.findings.find((finding) => finding.id === "novel-behavior");

  useEffect(() => setAnalystDecision("pending"), [scenarioId, mode]);

  function runAttack() {
    setRunning(true);
    window.setTimeout(() => setRunning(false), 2300);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#07090b] text-[#eff3ef]">
      <header className="flex h-[72px] items-center justify-between border-b border-white/[0.08] px-5 md:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl border border-[#c8f560]/25 bg-[#c8f560]/[0.08]">
            <ShieldCheck className="size-[18px] text-[#c8f560]" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">AgentShield</div>
            <div className="text-[11px] text-white/40">SOC decision support · Human-led response</div>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] p-1 md:flex">
          {(["unprotected", "observe", "enforce"] as Mode[]).map((item) => (
            <button
              key={item}
              onClick={() => setMode(item)}
              className={`rounded-full px-4 py-2 text-xs font-medium capitalize transition-all ${mode === item ? "bg-white/[0.11] text-white shadow-sm" : "text-white/40 hover:text-white/70"}`}
            >
              {item}
            </button>
          ))}
        </div>

        <button className="flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.045] px-3 py-2 text-xs text-white/65">
          <span className="size-1.5 rounded-full bg-[#c8f560] shadow-[0_0_8px_#c8f560]" />
          Nova online
          <ChevronDown className="size-3.5" />
        </button>
      </header>

      <section className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-4 p-4 lg:h-[calc(100vh-72px)] lg:grid-cols-[minmax(0,1fr)_360px] lg:p-5">
        <div className="relative min-h-[640px] overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0b0e11] lg:min-h-0">
          <div className="mesh-bg absolute inset-0 opacity-70" />
          <div className="absolute left-5 right-5 top-5 z-20 flex items-start justify-between md:left-7 md:right-7 md:top-7">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/35">
                <Activity className="size-3.5" /> Live execution trace
              </div>
              <h1 className="max-w-xl text-[clamp(1.65rem,3vw,2.7rem)] font-medium leading-[1.05] tracking-[-0.045em]">Trace the intent.<br />Stop the impact.</h1>
              <div className="mt-4 flex max-w-[78vw] gap-2 overflow-x-auto pb-1 sm:flex-wrap">
                {attackScenarios.map((item, index) => (
                  <button
                    key={item.id}
                    onClick={() => setScenarioId(item.id)}
                    className={`rounded-full border px-3 py-1.5 text-[11px] transition ${scenarioId === item.id ? "border-[#c8f560]/35 bg-[#c8f560]/10 text-[#d9ff77]" : "border-white/[0.08] bg-black/20 text-white/38 hover:text-white/65"}`}
                  >
                    0{index + 1} · {item.name}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={runAttack}
              disabled={running}
              className="group flex items-center gap-2 rounded-full bg-[#c8f560] px-4 py-2.5 text-xs font-semibold text-[#11150c] transition hover:bg-[#d9ff77] disabled:opacity-65 md:px-5 md:py-3"
            >
              <Play className={`size-3.5 fill-current ${running ? "animate-pulse" : ""}`} />
              {running ? "Replaying" : "Replay attack"}
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

            <TraceNode icon={isUnknown ? <Radar /> : <FileWarning />} label={isUnknown ? "Agent session" : scenarioId === "memory-poisoning" ? "Poisoned invoice" : scenarioId === "loop-exhaustion" ? "Tool response" : "Support ticket"} meta={isUnknown ? "No signature match" : "Untrusted source"} className="left-[12%] top-[37%]" state="warning" />
            <TraceNode icon={<Sparkles />} label="Nova agent" meta="Task: summarize ticket" className="left-[31%] top-[13%]" state="active" />
            <TraceNode icon={<Database />} label={isUnknown ? "Context bundler" : scenarioId === "memory-poisoning" ? "Agent memory" : scenarioId === "loop-exhaustion" ? "Iteration 9" : "Customer DB"} meta={isUnknown ? "Unseen tool sequence" : scenarioId === "loop-exhaustion" ? "Budget exceeded" : "Protected resource"} className="left-[57%] top-[37%]" state="warning" />
            <TraceNode icon={<Mail />} label={isUnknown ? "Approval gate" : scenarioId === "memory-poisoning" ? "Trust policy" : scenarioId === "loop-exhaustion" ? "Next tool call" : "External email"} meta={analystDecision === "contained" ? "Contained by analyst" : evaluation.decision === "approval_required" ? "Awaiting analyst" : evaluation.decision === "block" ? "Execution stopped" : "Action continued"} className="left-[79%] top-[62%]" state={evaluation.decision === "block" || analystDecision === "contained" ? "blocked" : "warning"} />

            <div className="absolute left-[53%] top-[10%] hidden w-[206px] rounded-2xl border border-white/[0.08] bg-[#101418]/90 p-4 shadow-2xl backdrop-blur-xl md:block">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">{isUnknown ? "Behavior drift" : "Task boundary"}</div>
              <div className="text-sm font-medium">{isUnknown ? `${String(noveltyFinding?.evidence.noveltyScore ?? 0)}/100 novelty` : `${Math.round(scenario.action.taskRelevance * 100)}% relevance`}</div>
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

        <aside className="soc-scrollbar flex min-h-[640px] flex-col overflow-x-hidden overflow-y-auto rounded-[26px] border border-white/[0.08] bg-[#0b0e11] p-5 lg:min-h-0">
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

          <div className="mt-7 flex items-center justify-between">
            <h3 className="text-sm font-medium">Evidence trail</h3>
            <span className="text-[11px] text-white/30">{events.length} {events.length === 1 ? "event" : "events"} · 575ms</span>
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

          <div className="mt-5 rounded-2xl border border-[#c8f560]/15 bg-[#c8f560]/[0.035] p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#c8f560]/65">Analyst decision</div>
              <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[9px] text-white/35">AI recommends · Human approves</span>
            </div>
            <p className="mt-2 text-[13px] font-medium leading-relaxed text-white/80">
              {isUnknown ? "Pause this agent session and inspect the unseen tool chain before allowing delivery." : "Preserve the evidence bundle and confirm containment of this agent session."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setAnalystDecision("contained")}
                className={`flex-1 rounded-xl px-3 py-2.5 text-[11px] font-semibold transition ${analystDecision === "contained" ? "bg-[#c8f560]/15 text-[#c8f560]" : "bg-[#c8f560] text-[#11150c] hover:bg-[#d9ff77]"}`}
              >
                {analystDecision === "contained" ? "Containment approved" : "Approve containment"}
              </button>
              <button onClick={() => setAnalystDecision("safe")} className="rounded-xl border border-white/[0.09] px-3 py-2.5 text-[11px] text-white/55 transition hover:bg-white/[0.05]">
                {analystDecision === "safe" ? "Marked safe" : "Mark safe"}
              </button>
            </div>
            <div className="mt-3 flex gap-3 text-[9px] text-white/30">
              <span>✓ revoke scoped token</span><span>✓ preserve audit</span><span>✓ stage rollback</span>
            </div>
          </div>

          <div className="mt-6 border-t border-white/[0.07] pt-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs text-white/38">Security posture</span>
              <span className="text-xs font-medium text-[#c8f560]">Measured locally</span>
            </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#6a812f] to-[#c8f560]" style={{ width: `${benchmark.defenseRate * 100}%` }} />
              </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Metric value={`${Math.round(benchmark.defenseRate * 1000) / 10}%`} label="Defense rate" />
              <Metric value={String(benchmark.bypasses)} label="Known bypass" tone="amber" />
              <Metric value={`${Math.round(benchmark.falsePositiveRate * 100)}%`} label="False positive" tone="amber" />
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <button className="mt-5 w-full rounded-xl border border-white/[0.09] bg-white/[0.04] py-3 text-xs font-medium text-white/72 transition hover:bg-white/[0.07]">Open full audit record</button>
              </DialogTrigger>
              <DialogContent className="max-h-[82vh] overflow-auto border-white/[0.1] bg-[#0d1114] text-white sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Audit record · {scenario.action.id}</DialogTitle>
                  <DialogDescription>Structured evidence captured at the policy boundary.</DialogDescription>
                </DialogHeader>
                <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/30 p-4 text-[11px] leading-relaxed text-white/60">{JSON.stringify(evaluation, null, 2)}</pre>
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
