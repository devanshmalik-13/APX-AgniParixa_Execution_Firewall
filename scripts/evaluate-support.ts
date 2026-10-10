import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { evaluateSupportActions } from "../lib/support/policy";
import { caseInputs, evaluationNow, supportEvaluationCases } from "./support-cases";

const rows = supportEvaluationCases.map((item) => {
  const input = caseInputs(item);
  const started = performance.now();
  const result = evaluateSupportActions(input.ticket, input.invoice, input.actions, input.profile, evaluationNow);
  const latencyMs = performance.now() - started;
  const decisions = result.actions.map((entry) => entry.decision);
  const unsafeActionsAuthorized = result.actions.filter((entry) => item.unsafeActionIds.includes(entry.action.id) && entry.decision !== "block").length;
  const matchesGroundTruth = JSON.stringify(decisions) === JSON.stringify(item.expectedDecisions)
    && result.invoiceAfter.refundedCents === item.expectedRefundCents;
  return {
    id: item.id, category: item.category, description: item.description, profile: input.profile,
    proposedActions: input.actions.length, unsafeProposedActions: item.unsafeActionIds.length,
    unsafeActionsAuthorized, decisions, expectedDecisions: item.expectedDecisions,
    reasons: result.actions.map((entry) => ({ id: entry.action.id, reasons: entry.reasons })),
    expectedRefundCents: item.expectedRefundCents, projectedRefundCents: result.invoiceAfter.refundedCents,
    matchesGroundTruth, latencyMs: Number(latencyMs.toFixed(3)),
  };
});

// Repeat a fixed workload to characterize policy overhead, separate from model
// latency and database execution. No network or model is involved in this suite.
const samples: number[] = [];
for (let iteration = 0; iteration < 30; iteration += 1) {
  for (const item of supportEvaluationCases) {
    const input = caseInputs(item); const started = performance.now();
    evaluateSupportActions(input.ticket, input.invoice, input.actions, input.profile, evaluationNow);
    samples.push(performance.now() - started);
  }
}
samples.sort((left, right) => left - right);
const percentile = (value: number) => Number(samples[Math.floor((samples.length - 1) * value)].toFixed(3));
const attacks = rows.filter((row) => row.category === "attack");
const legitimate = rows.filter((row) => row.category === "legitimate");
const unsafeProposed = attacks.reduce((sum, row) => sum + row.unsafeProposedActions, 0);
const unsafeAuthorized = attacks.reduce((sum, row) => sum + row.unsafeActionsAuthorized, 0);
const legitimateBlocked = legitimate.reduce((sum, row) => sum + row.decisions.filter((decision) => decision === "block").length, 0);
const legitimateActions = legitimate.reduce((sum, row) => sum + row.proposedActions, 0);
const result = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), evaluationAt: new Date(evaluationNow).toISOString(),
  scope: "Deterministic action-policy fixtures with explicit ground truth. This is not a live-model attack benchmark or a measured unprotected execution baseline.",
  reproduction: "npm run evaluate:support",
  metrics: {
    cases: rows.length, attackCases: attacks.length, legitimateCases: legitimate.length,
    casesMatchingGroundTruth: rows.filter((row) => row.matchesGroundTruth).length,
    unsafeProposedActions: unsafeProposed, unsafeActionsAuthorized: unsafeAuthorized,
    unsafeAuthorizationRate: unsafeProposed ? unsafeAuthorized / unsafeProposed : 0,
    attackCasesContained: attacks.filter((row) => row.unsafeActionsAuthorized === 0).length,
    legitimateActions, legitimateBlockedActions: legitimateBlocked,
    legitimateFalseBlockRate: legitimateActions ? legitimateBlocked / legitimateActions : 0,
    legitimateCasesPermitted: legitimate.filter((row) => row.decisions.every((decision) => decision !== "block")).length,
    legitimateApprovalActions: legitimate.reduce((sum, row) => sum + row.decisions.filter((decision) => decision === "approval_required").length, 0),
    policyLatencyMs: { samples: samples.length, p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) },
  },
  cases: rows,
  limitations: [
    "Unsafe proposals are deliberately supplied to the policy; this suite does not measure how often a model generates them.",
    "Permitted and approval-required previews do not prove task execution. Use the HTTP integration suite to verify persistence, idempotency, concurrency, and recovery.",
    "Attack cases and legitimate cases are synthetic and bounded to the included support sandbox.",
  ],
};
const destination = path.resolve(process.env.SUPPORT_EVAL_OUTPUT ?? "output/support-evaluation.json");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(`Support evaluation: ${result.metrics.casesMatchingGroundTruth}/${rows.length} cases match ground truth; ${unsafeAuthorized}/${unsafeProposed} unsafe actions authorized; ${legitimateBlocked}/${legitimateActions} legitimate actions blocked. Policy p95 ${result.metrics.policyLatencyMs.p95} ms.`);
console.log(`Evidence written to ${destination}`);
if (rows.some((row) => !row.matchesGroundTruth) || unsafeAuthorized > 0 || legitimateBlocked > 0) process.exitCode = 1;
