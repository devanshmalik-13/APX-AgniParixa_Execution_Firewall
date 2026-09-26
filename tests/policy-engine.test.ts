import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAction } from "../lib/security/policy-engine.ts";
import { attackScenarios, demoTask } from "../lib/security/scenarios.ts";
import { scanForSecrets } from "../lib/security/secret-scanner.ts";

test("enforce mode blocks indirect injection with sensitive egress", () => {
  const scenario = attackScenarios.find((item) => item.id === "indirect-injection");
  assert.ok(scenario);

  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "block");
  assert.equal(result.riskScore, 100);
  assert.ok(result.findings.some((finding) => finding.id === "task-mismatch"));
  assert.ok(result.findings.some((finding) => finding.id === "sensitive-egress"));
});

test("unprotected mode records risk but permits the same action", () => {
  const scenario = attackScenarios[0];
  const result = evaluateAction(demoTask, scenario.action, "unprotected");

  assert.equal(result.decision, "allow");
  assert.equal(result.riskScore, 100);
  assert.ok(result.findings.length >= 3);
});

test("untrusted content cannot write authorization memory", () => {
  const scenario = attackScenarios.find((item) => item.id === "memory-poisoning");
  assert.ok(scenario);

  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some((finding) => finding.id === "memory-poisoning" && finding.hardBlock));
});

test("iteration budget contains runaway agents", () => {
  const scenario = attackScenarios.find((item) => item.id === "loop-exhaustion");
  assert.ok(scenario);

  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some((finding) => finding.id === "iteration-budget"));
});

test("unknown execution shape is held for analyst approval without a known signature", () => {
  const scenario = attackScenarios.find((item) => item.id === "unknown-behavior");
  assert.ok(scenario);

  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "approval_required");
  assert.equal(result.findings.some((finding) => finding.id === "novel-behavior"), true);
  assert.equal(result.findings.some((finding) => finding.hardBlock), false);
});

test("normal in-scope internal action is allowed", () => {
  const result = evaluateAction(demoTask, {
    id: "legitimate-001",
    tool: "send_email",
    operation: "draft",
    arguments: { recipient: "analyst@velloe.internal" },
    destination: "analyst@velloe.internal",
    content: "Customer reports that invoice 42 appears twice.",
    taskRelevance: 0.93,
    requestedBy: [{ sourceId: "analyst", sourceType: "user_prompt", trust: "user", sensitivity: "internal" }],
  }, "enforce");

  assert.equal(result.decision, "allow");
  assert.equal(result.riskScore, 0);
});

test("secret scanner finds direct and base64-encoded secrets", () => {
  const encoded = Buffer.from("api_key=sk-demo_1234567890abcdef").toString("base64");
  const matches = scanForSecrets(`token sk-demo_1234567890abcdef encoded ${encoded}`);

  assert.ok(matches.some((match) => match.type === "api_key"));
  assert.ok(matches.some((match) => match.type === "encoded_secret"));
});
