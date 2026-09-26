import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAction } from "../lib/security/policy-engine";
import { attackScenarios, demoTask } from "../lib/security/scenarios";
import { scanForSecrets } from "../lib/security/secret-scanner";
import { executeTool } from "../lib/security/connectors";
import type { ActionRequest } from "../lib/security/types";

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

test("a consequential action outside the assigned goal is blocked", () => {
  const scenario = attackScenarios.find((item) => item.id === "goal-hijack");
  assert.ok(scenario);

  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some((finding) => finding.id === "task-mismatch" && finding.hardBlock));
});

test("a capability absent from the task allowlist cannot be approved", () => {
  const scenario = attackScenarios.find((item) => item.id === "tool-escalation");
  assert.ok(scenario);

  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some((finding) => finding.id === "tool-out-of-scope" && finding.hardBlock));
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

test("secret scanner finds the documented ROT13-like secret phrase", () => {
  const matches = scanForSecrets("The encoded blue phrase is: oyhr cuenfr sebz lrfgreqnl");
  assert.ok(matches.some((match) => match.type === "encoded_secret"));
});

test("unknown external destinations require approval even without a detected secret", () => {
  const result = evaluateAction(demoTask, {
    id: "external-egress-approval",
    tool: "send_email",
    operation: "send",
    arguments: { recipient: "new@outside.test" },
    destination: "new@outside.test",
    content: "Routine-looking content",
    taskRelevance: 0.9,
    requestedBy: [{ sourceId: "user", sourceType: "user_prompt", trust: "user", sensitivity: "public" }],
  }, "enforce");

  assert.equal(result.decision, "approval_required");
});

test("canonical path enforcement blocks traversal before filesystem dispatch", () => {
  const scenario = attackScenarios.find((item) => item.id === "filesystem-escape");
  assert.ok(scenario);
  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some((finding) => finding.id === "filesystem-boundary" && finding.hardBlock));
});

test("database passport blocks cross-tenant reads", () => {
  const scenario = attackScenarios.find((item) => item.id === "cross-tenant-query");
  assert.ok(scenario);
  const result = evaluateAction(demoTask, scenario.action, "enforce");
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some((finding) => finding.id === "database-boundary"));
});

test("scoped database connector returns only the current tenant", () => {
  const action: ActionRequest = {
    id: "legitimate-database-001",
    tool: "database",
    operation: "select",
    arguments: { table: "customers", columns: ["id", "plan", "billing_status"], tenantId: "velloe-demo", limit: 2 },
    content: "Look up the current billing status for this tenant.",
    taskRelevance: 0.96,
    requestedBy: [{ sourceId: "support-agent", sourceType: "user_prompt", trust: "user", sensitivity: "internal" }],
  };
  const evaluation = evaluateAction(demoTask, action, "enforce");
  assert.equal(evaluation.decision, "allow");
  const execution = executeTool(demoTask, action);
  assert.equal(execution.executed, true);
  assert.deepEqual((execution.output as { rows: Array<{ id: string }> }).rows.map((row) => row.id), ["cus_42"]);
});

test("filesystem connector rejects sandbox escape even if called directly", () => {
  const scenario = attackScenarios.find((item) => item.id === "filesystem-escape");
  assert.ok(scenario);
  assert.throws(() => executeTool(demoTask, scenario.action), /Sandbox escape rejected/);
});
