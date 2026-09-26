import assert from "node:assert/strict";
import test from "node:test";
import { attackLevels, promptForLevel, proposeAction } from "../lib/security/attack-lab";
import { isExactDemoFixture } from "../lib/security/demo-fixture";
import { constrainDemoIngress } from "../lib/security/ingress";
import { simulateUnprotectedTool } from "../lib/security/connectors";
import { attackScenarios } from "../lib/security/scenarios";

for (const scenario of attackScenarios) {
  for (const level of attackLevels) {
    test(`${scenario.id} ${level} remains an exact comparison replay`, () => {
      const prompt = promptForLevel(scenario.id, level);
      const action = proposeAction(scenario.id, level, prompt);
      assert.equal(isExactDemoFixture(scenario.id, level, prompt, action), true);
      assert.equal(constrainDemoIngress(action, "unprotected", true).mode, "unprotected");
    });
  }
}

test("edited prompt or forged action cannot disable enforcement", () => {
  const scenario = attackScenarios[0];
  const prompt = promptForLevel(scenario.id, "hard");
  const action = proposeAction(scenario.id, "hard", prompt);
  assert.equal(isExactDemoFixture(scenario.id, "hard", `${prompt} altered`, action), false);
  assert.equal(isExactDemoFixture(scenario.id, "hard", prompt, { ...action, destination: "forged@outside.test" }), false);
  assert.equal(constrainDemoIngress(action, "unprotected", false).mode, "enforce");
});

test("unprotected comparison is a counterfactual without a real connector call", () => {
  const action = attackScenarios.find((item) => item.id === "tool-escalation")!.action;
  const result = simulateUnprotectedTool(action);
  assert.equal(result.executed, true);
  assert.deepEqual(result.output, {
    simulated: true,
    counterfactual: true,
    explanation: "In the unprotected demo, this proposed action would reach its tool. No real tool or data was accessed.",
  });
});
