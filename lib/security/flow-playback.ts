import type { FlowLight, FlowPhase } from "./execution-flow";

export const flowSegmentMs = 2000;
export const flowGlowMs = 650;
const finishFadeMs = 250;

export interface FlowPlayback {
  progress: number;
  lastFrame: number;
  arrivals: [number | null, number | null, number | null, number | null];
  completedAt: number | null;
  status: "travelling" | "waiting" | "settling" | "finished" | "cancelled";
  opacity: number;
}

export function startFlowPlayback(now: number): FlowPlayback {
  return { progress: 0, lastFrame: now, arrivals: [now, null, null, null], completedAt: null, status: "travelling", opacity: 1 };
}

/** One playback clock per attack. A result updates the route, never its start. */
export function advanceFlowPlayback(previous: FlowPlayback, now: number, phase: FlowPhase, endpoint: 2 | 3): FlowPlayback {
  if (previous.status === "finished" || previous.status === "cancelled") return previous;
  if (phase === "preview") return { ...previous, status: "cancelled", opacity: 0 };
  // Returning from a background tab must not skip the entire visible journey.
  const elapsed = Math.min(100, Math.max(0, now - previous.lastFrame));
  const limit = phase === "running" ? 2 : endpoint;
  const progress = previous.completedAt !== null ? previous.progress : Math.min(limit, previous.progress + elapsed / flowSegmentMs);
  const arrivals = [...previous.arrivals] as FlowPlayback["arrivals"];
  for (let stage = 1; stage <= limit; stage++) {
    if (previous.progress < stage && progress >= stage && arrivals[stage] === null) arrivals[stage] = now;
  }
  let completedAt = previous.completedAt;
  if (phase === "recorded" && progress >= endpoint && completedAt === null) {
    completedAt = now;
    // A slow result may arrive after the waiting glow faded at the gateway.
    arrivals[endpoint] = now;
  }
  const opacity = completedAt === null ? 1 : Math.max(0, 1 - Math.max(0, now - completedAt - flowGlowMs) / finishFadeMs);
  const status = opacity === 0 ? "finished" : completedAt !== null ? "settling" : progress >= limit ? "waiting" : "travelling";
  return { progress, lastFrame: now, arrivals, completedAt, status, opacity };
}

export function flowGlowOpacity(arrivedAt: number | null, now: number) {
  if (arrivedAt === null) return 0;
  const age = now - arrivedAt;
  if (age < 0 || age >= flowGlowMs) return 0;
  return age <= 140 ? 1 : (flowGlowMs - age) / (flowGlowMs - 140);
}

export interface FlowPlaybackRoute { phase: FlowPhase; endpoint: 2 | 3; terminal: FlowLight }
export interface FlowFrameClock {
  now: () => number;
  request: (callback: (now: number) => void) => number;
  cancel: (id: number) => void;
}

/** Paint immediately, then schedule only until this particular run finishes. */
export function playFlowPlayback(readRoute: () => FlowPlaybackRoute,
  paint: (state: FlowPlayback, now: number, route: FlowPlaybackRoute) => void, clock: FlowFrameClock) {
  if (readRoute().phase === "preview") return () => {};
  let playback = startFlowPlayback(clock.now());
  let frame = 0;
  let cancelled = false;
  function tick(now: number) {
    if (cancelled) return;
    const route = readRoute();
    playback = advanceFlowPlayback(playback, now, route.phase, route.endpoint);
    paint(playback, now, route);
    if (playback.status !== "finished" && playback.status !== "cancelled") frame = clock.request(tick);
  }
  paint(playback, playback.lastFrame, readRoute());
  frame = clock.request(tick);
  return () => { cancelled = true; clock.cancel(frame); };
}
