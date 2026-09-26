import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAction } from "../lib/security/policy-engine";
import { executeTool } from "../lib/security/connectors";
import { demoTask } from "../lib/security/scenarios";
import type { ActionRequest } from "../lib/security/types";

const base: ActionRequest = {
  id: "boundary-regression", tool: "send_email", operation: "send",
  arguments: {}, taskRelevance: 0.95,
  requestedBy: [{ sourceId: "analyst", sourceType: "user_prompt", trust: "user", sensitivity: "public" }],
};

test("a recipient supplied only through arguments still reaches egress policy", () => {
  const result = evaluateAction(demoTask, { ...base, arguments: { recipient: "attacker@outside.test" }, content: "api_key sk-demo_1234567890abcdef" }, "enforce");
  assert.equal(result.decision, "block");
  assert.ok(result.findings.some((finding) => finding.id === "sensitive-egress"));
});

test("conflicting recipient fields fail closed in policy and adapter", () => {
  const action = { ...base, destination: "soc@velloe.internal", arguments: { recipient: "attacker@outside.test" } };
  assert.equal(evaluateAction(demoTask, action, "enforce").decision, "block");
  assert.throws(() => executeTool(demoTask, action), /disagree/);
});

for (const target of ["/workspace/.env.local", "/workspace/drafts/a%00.txt", "/workspace/drafts/../../etc/passwd", "/workspace/drafts/run.ps1", "/workspace/policies/refunds.md"]) {
  test(`filesystem rejects protected write ${target}`, () => {
    const action = { ...base, tool: "filesystem", operation: "write", arguments: { path: target, content: "injected" } };
    assert.equal(evaluateAction(demoTask, action, "enforce").decision, "block");
    assert.throws(() => executeTool(demoTask, action));
  });
}

test("legitimate draft writes execute and can be read back", () => {
  const action = { ...base, tool: "filesystem", operation: "write", arguments: { path: "/workspace/drafts/verified.txt", content: "Billing review requested." } };
  assert.equal(evaluateAction(demoTask, action, "enforce").decision, "allow");
  assert.equal(executeTool(demoTask, action).executed, true);
  const read = executeTool(demoTask, { ...action, operation: "read" });
  assert.equal((read.output as { content: string }).content, "Billing review requested.");
});

test("prototype property names cannot act as database table grants", () => {
  const action = { ...base, tool: "database", operation: "select", arguments: { table: "constructor", columns: ["name"], tenantId: "velloe-demo", limit: 1 } };
  assert.equal(evaluateAction(demoTask, action, "enforce").decision, "block");
  assert.throws(() => executeTool(demoTask, action), /Table is not/);
});
