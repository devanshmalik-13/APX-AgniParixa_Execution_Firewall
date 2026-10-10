import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateCombinationReport } from "../lib/evaluation/combination-evaluation";

const report = generateCombinationReport();
const destination = path.resolve(process.env.COMBINATION_EVAL_OUTPUT ?? "output/combination-evaluation.json");
await mkdir(path.dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.table(report.baselines.map((baseline) => ({
  strategy: baseline.label,
  unsafeAuthorized: `${baseline.metrics.unsafeActionsAuthorized}/${baseline.metrics.unsafeProposedActions}`,
  legitimateBlocked: `${baseline.metrics.legitimateBlockedActions}/${baseline.metrics.legitimateActions}`,
  mixedSafeRetained: `${baseline.metrics.safeActionsRetainedInMixedAttacks}/${baseline.metrics.safeActionsInMixedAttacks}`,
  safeApprovals: baseline.metrics.safeApprovalActions,
})));
console.log(`Selected: ${report.recommendation.label}. Deterministic local proposals only; no connector or model executed.`);
console.log(`Evidence written to ${destination}`);

const selected = report.baselines.find((baseline) => baseline.id === report.recommendation.baselineId)!;
if (selected.metrics.unsafeActionsAuthorized || selected.metrics.legitimateBlockedActions) process.exitCode = 1;
