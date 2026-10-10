import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { observerCases } from "./observer-cases";
import type { ObserverReadiness, ObserverResult } from "../lib/observer/types";

const base = new URL(process.env.SUPPORT_BASE_URL ?? "http://localhost:5173");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "Observer development evaluation is restricted to the local sandbox");
const headers = { "content-type": "application/json", origin: base.origin, cookie: "__sites_local_auth=1" };
const generatedAt = new Date().toISOString();
const readinessResponse = await fetch(new URL("/api/observer", base), { headers });
assert.equal(readinessResponse.status, 200, "The authenticated observer configuration must load");
const { config } = await readinessResponse.json() as { config: ObserverReadiness };
await mkdir("output", { recursive: true });
if (!config.available) {
  await writeFile("output/observer-evaluation.json", JSON.stringify({ generatedAt, status: "not_run", reason: config.serviceStatus, cases: [], limitations: ["No model predictions were produced."] }, null, 2) + "\n");
  console.log("NOT RUN: configure a ready local observer service first.");
  process.exitCode = 1;
} else {
  const results: Array<{ id: string; expected: string; verdict: string; status: string; maxScore: number | null; adapterLatencyMs: number; roundTripMs: number; correct: boolean | null; model: ObserverResult["model"]; complete: boolean }> = [];
  for (const item of observerCases) {
    const started = performance.now();
    const response = await fetch(new URL("/api/observer", base), { method: "POST", headers, body: JSON.stringify({ modelKey: config.activeModel, texts: [{ id: item.id, source: "customer_context", text: item.text }] }) });
    assert.equal(response.status, 200, `Scan ${item.id} must return structured evidence`);
    const { observation } = await response.json() as { observation: ObserverResult };
    const classified = observation.status === "observed" && observation.coverage.complete && observation.verdict !== "unknown";
    results.push({ id: item.id, expected: item.expected, verdict: observation.verdict, status: observation.status, maxScore: observation.maxScore, adapterLatencyMs: observation.latencyMs, roundTripMs: Math.round(performance.now() - started), correct: classified ? observation.verdict === item.expected : null, model: observation.model, complete: observation.coverage.complete });
    console.log(`${item.id}: ${observation.verdict} (${observation.status})`);
  }
  const suspicious = results.filter((r) => r.expected === "suspicious");
  const benign = results.filter((r) => r.expected === "benign");
  const latencies = results.map((r) => r.roundTripMs).sort((a, b) => a - b);
  const percentile = (fraction: number) => latencies[Math.max(0, Math.ceil(latencies.length * fraction) - 1)];
  const report = {
    generatedAt, status: results.every((r) => r.correct !== null) ? "completed" : "incomplete", mode: "shadow", model: results[0]?.model, source: "12 authored development inputs with explicit expected labels",
    counts: { total: results.length, classified: results.filter((r) => r.correct !== null).length, suspiciousInputs: suspicious.length, benignInputs: benign.length, missedSuspiciousInputs: suspicious.filter((r) => r.correct === false).length, falseAlarms: benign.filter((r) => r.correct === false).length, unknown: results.filter((r) => r.correct === null).length },
    latency: { metric: "warm sequential app-to-service round trip on this local machine", p50Ms: percentile(0.5), p95Ms: percentile(0.95) },
    limitations: ["Development fixtures, not held-out attacks or a production detection estimate.", "No human review-time or automated execution benefit was measured.", "No comparator model was run unless it has its own separately recorded report.", "An incorrect label does not change application permission or approval decisions.", "Model scores and this development threshold are not calibrated probabilities of safety."], results,
  };
  await writeFile("output/observer-evaluation.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, counts: report.counts, latency: report.latency }, null, 2));
  if (report.status !== "completed") process.exitCode = 1;
}
