"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { FileWarning, ShieldCheck, Sparkles } from "lucide-react";
import { executionFlow, type FlowPhase } from "@/lib/security/execution-flow";
import { flowGlowOpacity, playFlowPlayback, type FlowPlayback, type FlowPlaybackRoute } from "@/lib/security/flow-playback";
import type { Decision } from "@/lib/security/types";

// Both the route and the HTML node centers use these coordinates (1000 x 400).
const positions = [{ x: 140, y: 180 }, { x: 380, y: 80 }, { x: 620, y: 180 }, { x: 860, y: 260 }];
const segments = [
  "M140 180 C240 180 280 80 380 80",
  "M380 80 C480 80 520 180 620 180",
  "M620 180 C720 180 760 260 860 260",
];
const lightLabels = { reached: "Reached", stopped: "Stopped here", waiting: "Waiting", idle: "Not reached" };
type StageTone = "amber" | "lime" | "blue" | "coral";

export function LabExecutionFlow({ decision, phase, executed, analystDecision, inputLabel, toolLabel, toolIcon, toolTone = "amber", traceKey }: {
  decision: Decision; phase: FlowPhase; executed?: boolean;
  analystDecision: "pending" | "contained" | "safe" | "failed";
  inputLabel: string; toolLabel: string; toolIcon: ReactNode; toolTone?: StageTone; traceKey: string;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const latestRouteRef = useRef<FlowPlaybackRoute>({ phase, endpoint: 2, terminal: "waiting" });
  const gradientId = useId().replace(/:/g, "");
  const flow = executionFlow({ decision, phase, executed, analystDecision });
  const terminal = flow.lights[flow.endpoint];
  const endpointColor = terminal === "stopped" ? "#ff8064" : terminal === "waiting" ? "#f4b860" : "#c8f560";
  const stages = [
    { label: inputLabel, detail: "Untrusted input", icon: <FileWarning />, tone: "amber" },
    { label: "Nova agent", detail: "Proposed action", icon: <Sparkles />, tone: "lime" },
    { label: "Policy gateway", detail: "Checks task permissions", icon: <ShieldCheck />, tone: "blue" },
    { label: toolLabel, detail: "Sandbox tool boundary", icon: toolIcon, tone: toolTone },
  ];
  useEffect(() => {
    latestRouteRef.current = { phase, endpoint: flow.endpoint, terminal };
  }, [phase, flow.endpoint, terminal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || latestRouteRef.current.phase === "preview") return;
    const dot = canvas.querySelector<SVGGElement>(".lab-flow-pulse");
    const paths = Array.from(canvas.querySelectorAll<SVGPathElement>("[data-route-segment]"));
    const flashes = Array.from(canvas.querySelectorAll<SVGGElement>("[data-stage-flash]"));
    if (!dot || paths.length !== 3) return;
    const lengths = paths.map(path => path.getTotalLength());
    function paint(state: FlowPlayback, now: number, route: FlowPlaybackRoute) {
      const segment = Math.min(2, Math.floor(state.progress));
      const point = paths[segment].getPointAtLength((state.progress - segment) * lengths[segment]);
      dot!.setAttribute("transform", `translate(${point.x} ${point.y})`);
      dot!.style.opacity = String(state.opacity);
      const colour = state.progress >= route.endpoint ? route.terminal === "stopped" ? "#ff8064" : route.terminal === "waiting" ? "#f4b860" : "#c8f560" : "#c8f560";
      dot!.style.setProperty("--pulse-color", colour);
      flashes.forEach((flash, index) => { flash.style.opacity = String(state.status === "cancelled" ? 0 : flowGlowOpacity(state.arrivals[index], now)); });
      canvas!.dataset.playback = state.status;
    }

    // Paint the source immediately; a fast HTTP response cannot hide the dot.
    canvas.dataset.animated = "true";
    const stop = playFlowPlayback(() => latestRouteRef.current, paint,
      { now: () => performance.now(), request: callback => requestAnimationFrame(callback), cancel: id => cancelAnimationFrame(id) });
    return () => { stop(); dot.style.opacity = "0"; delete canvas.dataset.animated; };
  }, [traceKey]);

  return <figure className="lab-execution-flow" data-phase={phase} aria-label={`${phase === "preview" ? "Projected" : "Gateway"} execution route`}>
    <div className="lab-flow-canvas" key={traceKey} ref={canvasRef}>
      <svg className="lab-flow-routes" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id={gradientId}><stop offset="0" stopColor="#c8f560" /><stop offset="0.78" stopColor="#c8f560" /><stop offset="1" stopColor={endpointColor} /></linearGradient></defs>
        {segments.map((path) => <path key={path} d={path} data-route-segment="" className="lab-flow-route-base" />)}
        {segments.slice(0, flow.endpoint).map((path, index) => <path key={path} d={path} className="lab-flow-route-reached" stroke={index === flow.endpoint - 1 ? `url(#${gradientId})` : "#c8f560"} />)}
        <g className="lab-flow-pulse" transform="translate(140 180)"><circle r="12" opacity="0.2" /><circle r="5" /></g>
      </svg>
      {stages.map((stage, index) => <div key={index} className="lab-flow-node" data-tone={stage.tone} data-light={flow.lights[index]} style={{ left: `${positions[index].x / 10}%`, top: `${positions[index].y / 4}%` }}>
        <span className="lab-flow-node-icon" aria-hidden="true">{stage.icon}<i /><svg className="lab-flow-node-flash" viewBox="0 0 64 64"><g data-stage-flash={index} opacity="0"><rect x="1.5" y="1.5" width="61" height="61" rx="19" /><circle cx="62" cy="2" r="4" /></g></svg></span>
        <b>{stage.label}</b><small>{stage.detail}</small><span className="lab-flow-node-state">{phase === "preview" && flow.lights[index] === "reached" ? "Would reach" : lightLabels[flow.lights[index]]}</span>
      </div>)}
    </div>
    <figcaption><p aria-live="polite">{flow.caption}</p><div className="lab-flow-legend"><span data-light="reached"><i />{phase === "preview" ? "Would reach" : "Reached"}</span><span data-light="stopped"><i />Stopped</span><span data-light="waiting"><i />Waiting</span><span data-light="idle"><i />Not reached</span></div></figcaption>
  </figure>;
}
