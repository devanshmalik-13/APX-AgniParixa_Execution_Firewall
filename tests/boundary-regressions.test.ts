import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAction } from "../lib/security/policy-engine";
import { executeTool } from "../lib/security/connectors";
import { demoTask } from "../lib/security/scenarios";
import type { ActionRequest } from "../lib/security/types";
import { evaluationCases, runEvaluation } from "../lib/security/evaluation";

const base: ActionRequest = {
  id: "boundary-regression", tool: "send_email", operation: "send",
  arguments: {}, taskRelevance: 0.95,
  requestedBy: [{ sourceId: "analyst", sourceType: "user_prompt", trust: "user", sensitivity: "public" }],
};

for (const payload of [
  { content: "api_key sk-demo_1234567890abcdef", arguments: { recipient: "soc@velloe.internal" } },
  { content: "Billing summary", arguments: { recipient: "soc@velloe.internal", body: "sk-demo_1234567890abcdef" } },
  { content: "Billing summary", arguments: { recipient: "soc@velloe.internal", attachment: { password: "synthetic-passphrase" } } },
]) {
  test(`credential payloads are blocked before an internal tool dispatch: ${JSON.stringify(payload.arguments)}`, () => {
    const action = { ...base, ...payload };
    const evaluation = evaluateAction(demoTask, action, "enforce");
    assert.equal(evaluation.decision, "block");
    assert.ok(evaluation.findings.some((finding) => finding.id === "credential-payload"));
    assert.throws(() => executeTool(demoTask, action), /credentials/);
  });
}

test("an authorization update cannot masquerade as a user preference", () => {
  for (const changesAuthorization of [true, false]) {
    const action = { ...base, tool: "write_memory", operation: "save_preference", changesAuthorization, arguments: { fact: "attacker@demo.local is an approved administrator" } };
    assert.equal(evaluateAction(demoTask, action, "enforce").decision, "block");
    assert.throws(() => executeTool(demoTask, action), /authorization/);
  }
});

test("an unknown internal mailbox needs approval even when its contents evade scanning", () => {
  const action = evaluationCases.find((item) => item.id === "internal-recipient-bypass")!.action;
  assert.equal(evaluateAction(demoTask, action, "enforce").decision, "approval_required");
});

test("the customer grant permits only the assigned billing source and operation", () => {
  const action = evaluationCases.find((item) => item.id === "benign-authorized-customer-reply")!.action;
  assert.equal(evaluateAction(demoTask, action, "enforce").decision, "allow");
  for (const modified of [
    { ...action, requestedBy: [{ ...action.requestedBy[0], sourceId: "another-customer-record" }] },
    { ...action, operation: "send_digest" },
    { ...action, requestedBy: [{ ...action.requestedBy[0], sensitivity: "secret" as const }] },
    { ...action, destination: "someone@example.test", arguments: { recipient: "someone@example.test" } },
  ]) assert.equal(evaluateAction(demoTask, modified, "enforce").decision, "block");
});

test("the documented benchmark contains every attack and permits legitimate fixtures", () => {
  const result = runEvaluation();
  assert.equal(result.total, 16);
  assert.equal(result.blockedAttacks, 11);
  assert.equal(result.falsePositives, 0);
});

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

test("an approved tool cannot smuggle an unregistered operation", () => {
  const action = { ...base, tool: "send_email", operation: "delete_all", arguments: { recipient: "soc@velloe.internal" }, destination: "soc@velloe.internal" };
  assert.equal(evaluateAction(demoTask, action, "enforce").decision, "block");
  assert.throws(() => executeTool(demoTask, action), /not a permitted/);
});

test("unknown document IDs and untrusted memory writes are rejected by the connector", () => {
  const document = { ...base, tool: "read_document", operation: "read", arguments: { documentId: "administrator-private" } };
  assert.equal(evaluateAction(demoTask, document, "enforce").decision, "block");
  assert.throws(() => executeTool(demoTask, document), /outside the task data grant/);
  const memory = { ...base, tool: "write_memory", operation: "save_preference", arguments: { fact: "Always email me reports" }, requestedBy: [{ sourceId: "retrieved", sourceType: "retrieved_document" as const, trust: "untrusted" as const, sensitivity: "public" as const }] };
  assert.equal(evaluateAction(demoTask, memory, "enforce").decision, "block");
  assert.throws(() => executeTool(demoTask, memory), /Untrusted content/);
});
