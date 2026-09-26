import assert from "node:assert/strict";
import test from "node:test";
import { constrainDemoIngress } from "../lib/security/ingress";
import type { ActionRequest } from "../lib/security/types";

const action: ActionRequest = {
  id: "client-supplied", tool: "send_email", operation: "send",
  arguments: { recipient: "soc@velloe.internal" }, destination: "soc@velloe.internal",
  taskRelevance: 1,
  requestedBy: [
    { sourceId: "uploaded-file", sourceType: "retrieved_document", trust: "trusted", sensitivity: "public" },
    { sourceId: "user", sourceType: "user_prompt", trust: "trusted", sensitivity: "public" },
  ],
};

test("custom API submissions cannot turn off enforcement or self-attest trusted retrieval", () => {
  const result = constrainDemoIngress(action, "unprotected", false);
  assert.equal(result.mode, "enforce");
  assert.deepEqual(result.action.requestedBy.map((source) => source.trust), ["untrusted", "user"]);
  assert.equal(action.requestedBy[0].trust, "trusted");
});

test("exact synthetic fixtures retain side-by-side demonstration modes", () => {
  const result = constrainDemoIngress(action, "observe", true);
  assert.equal(result.mode, "observe");
  assert.equal(result.action, action);
});
