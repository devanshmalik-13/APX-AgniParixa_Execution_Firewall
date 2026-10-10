import assert from "node:assert/strict";
import test from "node:test";
import { createObserverClient, observerRequestSchema, redactObserverText } from "../lib/observer/server";
import type { ObserverEvidence } from "../lib/observer/types";

const model = { key: "piguard" as const, id: "leolee99/PIGuard", revision: "dd78b24e330193a22d2293ac66922dd4f982f563", device: "cpu" };
const input = { texts: [{ id: "customer", source: "customer_context" as const, text: "Explain the invoice." }] };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const evidence = (value = 0.1): ObserverEvidence => ({ schemaVersion: 1, mode: "shadow", status: "observed", verdict: value >= 0.9 ? "suspicious" : "benign", model,
  threshold: 0.9, maxScore: value, segments: [{ textId: "customer", startToken: 0, endToken: 5, score: value, label: value >= 0.9 ? "suspicious" : "benign" }],
  coverage: { complete: true, windowTokens: 512, overlapTokens: 64, totalTokens: 5, segments: 1 }, latencyMs: 4, reason: "Service explanation" });
const client = (fetcher: typeof fetch, extra = {}) => createObserverClient({ url: "https://observer.example/base", token: "server-token", modelKey: "piguard", fetch: fetcher, ...extra });

test("unconfigured observer is honestly unknown and never calls a provider", async () => {
  const observer = createObserverClient({ fetch: async () => { throw new Error("Must not fetch"); } });
  const config = await observer.getConfig();
  assert.equal(config.serviceStatus, "not_configured");
  assert.equal(config.available, false);
  assert.ok(config.models.every((entry) => !entry.available));
  const result = await observer.observe(input);
  assert.equal(result.status, "not_configured");
  assert.equal(result.verdict, "unknown");
  assert.equal(result.model, null);
  assert.equal(result.maxScore, null);
});

test("authenticated readiness identifies only the actually loaded allowlisted model", async () => {
  const observer = client(async (url, init) => {
    assert.equal(String(url), "https://observer.example/base/health");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer server-token");
    assert.equal(init?.redirect, "manual");
    return json({ schemaVersion: 1, status: "ready", model, windowTokens: 512, overlapTokens: 64, threshold: 0.9 });
  });
  const config = await observer.getConfig();
  assert.equal(config.serviceStatus, "ready");
  assert.equal(config.activeModel, "piguard");
  assert.deepEqual(config.models.filter((entry) => entry.available).map((entry) => entry.key), ["piguard"]);
  assert.ok(!JSON.stringify(config).includes("server-token"));
  assert.ok(!JSON.stringify(config).includes("observer.example"));
});

test("unknown model, moving revision, unhealthy service and incorrect selected model fail closed", async () => {
  for (const replacement of [{ ...model, key: "another-model" }, { ...model, id: "attacker/fake" }, { ...model, revision: "main" }, { ...model, revision: "a".repeat(40) }, { ...model, device: "server-token" }, { key: "prompt-guard-22m", id: "meta-llama/Llama-Prompt-Guard-2-22M", revision: model.revision, device: "cpu" }]) {
    const config = await client(async () => json({ schemaVersion: 1, status: "ready", model: replacement, windowTokens: 512, overlapTokens: 64, threshold: 0.9 })).getConfig();
    assert.equal(config.serviceStatus, "unavailable");
    assert.equal(config.available, false);
  }
  assert.equal((await client(async () => new Response("secret provider error", { status: 500 })).observe(input)).status, "unavailable");
});

test("remote HTTP, embedded credentials, query and fragment are rejected before fetching", async () => {
  for (const url of ["http://observer.example", "https://user:password@observer.example", "https://observer.example?token=secret", "https://observer.example/#token", "http://127.0.0.1:8091", "https://localhost:8091"]) {
    let calls = 0;
    const result = await client(async () => { calls += 1; return json(evidence()); }, { url }).observe(input);
    assert.equal(result.status, "unavailable");
    assert.equal(calls, 0);
  }
});

test("HTTP loopback is available only with explicit local configuration", async () => {
  const result = await client(async (url) => { assert.equal(String(url), "http://127.0.0.1:8091/v1/observe"); return json(evidence()); }, { url: "http://127.0.0.1:8091", allowLocal: true }).observe(input);
  assert.equal(result.status, "observed");
});

test("redirect responses are refused without forwarding credentials to another host", async () => {
  let calls = 0;
  const result = await client(async (_url, init) => {
    calls += 1;
    assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 307, headers: { Location: "https://another-host.example/collect" } });
  }).observe(input);
  assert.equal(calls, 1);
  assert.equal(result.status, "unavailable");
});

test("outgoing prose is redacted and remote explanations cannot enter durable evidence", async () => {
  const maliciousReason = "server-token sk-proj-credentialABCDEFGHIJKLMNOP";
  const observer = client(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)) as { modelKey: string; texts: { text: string }[] };
    assert.equal(payload.modelKey, "piguard");
    assert.ok(!payload.texts[0].text.includes("sk-proj-syntheticCredential1234567890"));
    assert.ok(!payload.texts[0].text.includes("customer@example.test"));
    return json({ ...evidence(), reason: maliciousReason });
  });
  const result = await observer.observe({ texts: [{ ...input.texts[0], text: "customer@example.test key: sk-proj-syntheticCredential1234567890" }] });
  assert.equal(result.status, "observed");
  assert.ok(!JSON.stringify(result).includes(maliciousReason));
  assert.ok(redactObserverText("\u0000hello").startsWith("hello"));
});

test("suspicion is evidence without any execution permission fields", async () => {
  const result = await client(async () => json(evidence(0.99))).observe(input);
  assert.equal(result.verdict, "suspicious");
  assert.equal(result.mode, "shadow");
  assert.equal("approve" in result, false);
  assert.equal("decision" in result, false);
});

test("service predictions, coverage, window labels and requested models must agree", async () => {
  for (const changed of [
    { ...evidence(), verdict: "suspicious" }, { ...evidence(), maxScore: 0.9 },
    { ...evidence(), coverage: { ...evidence().coverage, segments: 2 } },
    { ...evidence(), coverage: { ...evidence().coverage, totalTokens: 0 } },
    { ...evidence(), segments: [{ ...evidence().segments[0], startToken: 1 }] },
    { ...evidence(), segments: [{ ...evidence().segments[0], textId: "unsubmitted" }] },
    { ...evidence(), segments: [{ ...evidence().segments[0], label: "suspicious" }] },
    { ...evidence(), model: { ...model, revision: "latest" } },
  ]) assert.equal((await client(async () => json(changed)).observe(input)).status, "unavailable");
  let calls = 0;
  assert.equal((await client(async () => { calls += 1; return json(evidence()); }).observe({ ...input, modelKey: "prompt-guard-86m" })).status, "unavailable");
  assert.equal(calls, 0);
});

test("incomplete bounded scans remain unknown even when partial windows look benign", async () => {
  const result = await client(async () => json({ ...evidence(), verdict: "unknown", coverage: { ...evidence().coverage, complete: false, totalTokens: 600 } })).observe(input);
  assert.equal(result.status, "observed");
  assert.equal(result.verdict, "unknown");
  assert.equal(result.coverage.complete, false);
});

test("streamed responses are bounded even without a Content-Length header", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); }, cancel() { cancelled = true; } }), { headers: { "Content-Type": "application/json" } });
  assert.equal((await client(async () => response).observe(input)).status, "unavailable");
  assert.equal(cancelled, true);
  assert.equal((await client(async () => new Response("{}", { headers: { "Content-Type": "text/html" } })).observe(input)).status, "unavailable");
});

test("a stalled provider is aborted and produces unknown without revealing diagnostics", async () => {
  const observer = client(async (_url, init) => new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("secret provider diagnostic")), { once: true }); }), { timeoutMs: 500 });
  const result = await observer.observe(input);
  assert.equal(result.status, "unavailable");
  assert.equal(result.verdict, "unknown");
  assert.ok(!JSON.stringify(result).includes("diagnostic"));
});

test("ingress rejects excess text, duplicates, unsupported fields and unsafe identifiers", () => {
  for (const changed of [
    { ...input, approve: true }, { ...input, modelKey: "unknown" },
    { texts: [{ ...input.texts[0], id: "credential:secret" }] },
    { texts: [input.texts[0], input.texts[0]] },
    { texts: Array.from({ length: 9 }, (_, index) => ({ ...input.texts[0], id: `text${index}` })) },
    { texts: [{ ...input.texts[0], text: "x".repeat(6001) }] },
    { texts: Array.from({ length: 3 }, (_, index) => ({ ...input.texts[0], id: `text${index}`, text: "x".repeat(5000) })) },
  ]) assert.equal(observerRequestSchema.safeParse(changed).success, false);
});
