import assert from "node:assert/strict";
import test from "node:test";
import { advanceFlowPlayback, flowGlowOpacity, playFlowPlayback, startFlowPlayback, type FlowPlayback, type FlowPlaybackRoute } from "../lib/security/flow-playback";
import type { FlowPhase } from "../lib/security/execution-flow";

function frames(state: FlowPlayback, until: number, phase: FlowPhase, endpoint: 2 | 3) {
  for (let now = state.lastFrame + 20; now <= until; now += 20) state = advanceFlowPlayback(state, now, phase, endpoint);
  return state;
}

test("a click immediately shows the source and a fast response continues the same pass", () => {
  let state = startFlowPlayback(0);
  assert.equal(state.opacity, 1);
  assert.equal(flowGlowOpacity(state.arrivals[0], 0), 1);
  state = frames(state, 100, "running", 2);
  const firstPosition = state.progress;
  state = advanceFlowPlayback(state, 120, "recorded", 3);
  assert.ok(state.progress > firstPosition);
  assert.equal(state.arrivals[0], 0);
  state = frames(state, 6100, "recorded", 3);
  assert.equal(state.progress, 3);
  assert.ok(state.arrivals.every(time => time !== null));
  assert.equal(state.status, "settling");
});

test("a blocked pass ends at the gateway and never activates the tool", () => {
  const state = frames(startFlowPlayback(0), 5100, "recorded", 2);
  assert.equal(state.progress, 2);
  assert.equal(state.arrivals[3], null);
  assert.equal(state.status, "finished");
  assert.equal(state.opacity, 0);
});

test("slow gateway results hold the dot instead of sending it to an unapproved tool", () => {
  let state = frames(startFlowPlayback(0), 12000, "running", 2);
  assert.equal(state.progress, 2);
  assert.equal(state.status, "waiting");
  assert.equal(state.opacity, 1);
  assert.equal(state.arrivals[3], null);
  state = frames(state, 14100, "recorded", 3);
  assert.equal(state.progress, 3);
  assert.equal(state.arrivals[0], 0);
  assert.ok(state.arrivals[3]! >= 14000);
});

test("a late denial settles visibly at the gateway with no replay", () => {
  let state = frames(startFlowPlayback(0), 12000, "running", 2);
  state = advanceFlowPlayback(state, 12020, "recorded", 2);
  assert.equal(state.status, "settling");
  assert.equal(flowGlowOpacity(state.arrivals[2], 12020), 1);
  state = frames(state, 13100, "recorded", 2);
  assert.equal(state.status, "finished");
  assert.equal(state.arrivals[3], null);
});

test("finished playback cannot restart on outcome or panel updates; a new click can", () => {
  const finished = frames(startFlowPlayback(0), 7100, "recorded", 3);
  assert.equal(finished.status, "finished");
  assert.equal(advanceFlowPlayback(finished, 20000, "recorded", 2), finished);
  assert.equal(advanceFlowPlayback(finished, 30000, "running", 2), finished);
  const nextRun = startFlowPlayback(30000);
  assert.equal(nextRun.progress, 0);
  assert.equal(nextRun.opacity, 1);
});

test("an approval hold completes one pass even if reviewed during its fade", () => {
  let state = frames(startFlowPlayback(0), 4100, "recorded", 2);
  assert.equal(state.status, "settling");
  state = frames(state, 5100, "recorded", 3);
  assert.equal(state.progress, 2);
  assert.equal(state.arrivals[3], null);
  assert.equal(state.status, "finished");
});

test("failed requests cancel playback and background pauses do not skip the journey", () => {
  let state = advanceFlowPlayback(startFlowPlayback(0), 10000, "running", 2);
  assert.ok(state.progress < 1);
  state = advanceFlowPlayback(state, 10020, "preview", 2);
  assert.equal(state.status, "cancelled");
  assert.equal(state.opacity, 0);
  assert.equal(advanceFlowPlayback(state, 20000, "recorded", 3), state);
});

test("arrival glow is brief and returns to normal", () => {
  assert.equal(flowGlowOpacity(null, 100), 0);
  assert.equal(flowGlowOpacity(2000, 2000), 1);
  assert.ok(flowGlowOpacity(2000, 2400) > 0);
  assert.equal(flowGlowOpacity(2000, 2700), 0);
});

test("the real frame scheduler paints immediately, survives a fast response, then stops requesting frames", () => {
  let now = 0, nextId = 1;
  let route: FlowPlaybackRoute = { phase: "running", endpoint: 2, terminal: "waiting" };
  const callbacks = new Map<number, (time: number) => void>();
  const paints: FlowPlayback[] = [];
  const stop = playFlowPlayback(() => route, state => paints.push(state), {
    now: () => now,
    request: callback => { const id = nextId++; callbacks.set(id, callback); return id; },
    cancel: id => { callbacks.delete(id); },
  });
  assert.equal(paints.length, 1);
  assert.equal(paints[0].opacity, 1);
  assert.equal(callbacks.size, 1);
  for (now = 20; now <= 10000; now += 20) {
    if (now === 100) route = { phase: "recorded", endpoint: 3, terminal: "reached" };
    const frame = [...callbacks.values()]; callbacks.clear();
    frame.forEach(callback => callback(now));
  }
  assert.equal(paints.filter(state => state.progress === 0).length, 1);
  assert.equal(paints.at(-1)!.status, "finished");
  assert.equal(paints.at(-1)!.progress, 3);
  assert.equal(callbacks.size, 0);
  const paintCount = paints.length;
  route = { phase: "recorded", endpoint: 2, terminal: "stopped" };
  assert.equal(paints.length, paintCount);
  stop();
});

test("idle previews request no frames, and cancelling an active run prevents later paints", () => {
  let route: FlowPlaybackRoute = { phase: "preview", endpoint: 2, terminal: "stopped" };
  let queued: ((now: number) => void) | undefined;
  let paints = 0;
  const clock = { now: () => 0, request: (callback: (now: number) => void) => { queued = callback; return 1; }, cancel: () => { queued = undefined; } };
  playFlowPlayback(() => route, () => { paints++; }, clock);
  assert.equal(queued, undefined);
  assert.equal(paints, 0);
  route = { phase: "running", endpoint: 2, terminal: "waiting" };
  const stop = playFlowPlayback(() => route, () => { paints++; }, clock);
  const staleFrame = queued!;
  stop();
  staleFrame(100);
  assert.equal(paints, 1);
  assert.equal(queued, undefined);
});
