import assert from "node:assert/strict";
import test from "node:test";
import { executionFlow } from "../lib/security/execution-flow";
import { attackScenarios, demoTask } from "../lib/security/scenarios";
import { evaluateAction } from "../lib/security/policy-engine";

test("blocked real policy fixtures stop before the tool, including memory poisoning", () => {
  for (const scenario of attackScenarios) {
    const evaluation = evaluateAction(demoTask, scenario.action, "enforce");
    if (evaluation.decision !== "block") continue;
    const route = executionFlow({ decision: evaluation.decision, phase: "recorded", executed: false });
    assert.deepEqual(route.lights, ["reached", "reached", "stopped", "idle"], scenario.id);
    assert.equal(route.endpoint, 2);
  }
});
test("pending gateway and analyst review never light the tool green", () => {
  for (const phase of ["running", "recorded"] as const) {
    assert.deepEqual(executionFlow({ decision: "approval_required", phase, executed: false }).lights, ["reached", "reached", "waiting", "idle"]);
  }
});
test("an analyst approval shows the tool reached only after successful execution", () => {
  assert.equal(executionFlow({ decision: "approval_required", phase: "recorded", analystDecision: "safe", executed: true }).lights[3], "reached");
  assert.equal(executionFlow({ decision: "approval_required", phase: "recorded", analystDecision: "failed", executed: false }).lights[3], "stopped");
  assert.equal(executionFlow({ decision: "approval_required", phase: "recorded", analystDecision: "contained", executed: false }).endpoint, 2);
});
test("connector refusal is shown after the gateway instead of claiming success", () => {
  assert.deepEqual(executionFlow({ decision: "allow", phase: "recorded", executed: false }).lights, ["reached", "reached", "reached", "stopped"]);
});
test("allow and observe can reach the tool; previews are explicitly projected", () => {
  for (const decision of ["allow", "observe"] as const) {
    assert.deepEqual(executionFlow({ decision, phase: "recorded", executed: true }).lights, ["reached", "reached", "reached", "reached"]);
    assert.match(executionFlow({ decision, phase: "preview" }).caption, /Projected.*No execution/);
  }
});
