import { recordRun } from "./run-store";
import { executeTool } from "./connectors";
import { evaluateAction } from "./policy-engine";
import type { ActionRequest, EnforcementMode, GatewayResponse, TaskContext, ToolExecutionResult } from "./types";

export async function runGateway(task: TaskContext, action: ActionRequest, mode: EnforcementMode, promptId: string): Promise<GatewayResponse> {
  const startedAt = performance.now();
  const evaluation = evaluateAction(task, action, mode);
  let execution: ToolExecutionResult = {
    executed: false,
    tool: action.tool,
    operation: action.operation,
    safeAlternative: evaluation.decision === "approval_required" ? "Keep isolated and request a one-action approval." : "Action was contained before tool dispatch.",
  };

  if (evaluation.decision === "allow" || evaluation.decision === "observe") {
    try {
      execution = executeTool(task, action);
    } catch (error) {
      execution = { executed: false, tool: action.tool, operation: action.operation, safeAlternative: error instanceof Error ? error.message : "Connector rejected the action." };
    }
  }
  const receipt = await recordRun(promptId, evaluation, execution);
  return { evaluation, execution, receipt, latencyMs: Math.max(1, Math.round(performance.now() - startedAt)), promptId };
}
