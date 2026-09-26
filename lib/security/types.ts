export type EnforcementMode = "unprotected" | "observe" | "enforce";
export type TrustLevel = "trusted" | "user" | "untrusted";
export type Sensitivity = "public" | "internal" | "confidential" | "secret";
export type Decision = "allow" | "observe" | "block" | "approval_required";

export interface TaskContext {
  id: string;
  description: string;
  allowedTools: string[];
  allowedData: string[];
  allowedDestinations: string[];
}

export interface DataLineage {
  sourceId: string;
  sourceType: "user_prompt" | "retrieved_document" | "tool_result" | "memory";
  trust: TrustLevel;
  sensitivity: Sensitivity;
}

export interface ActionRequest {
  id: string;
  tool: string;
  operation: string;
  arguments: Record<string, unknown>;
  destination?: string;
  content?: string;
  requestedBy: DataLineage[];
  taskRelevance: number;
  changesAuthorization?: boolean;
  currentIteration?: number;
  behavior?: {
    toolSequence: string[];
    destinationSeenBefore: boolean;
    argumentShapeSeenBefore: boolean;
    sensitiveSourceCount: number;
  };
}

export interface PolicyFinding {
  id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  hardBlock: boolean;
  evidence: Record<string, unknown>;
}

export interface EvaluationResult {
  decision: Decision;
  riskScore: number;
  findings: PolicyFinding[];
  action: ActionRequest;
  task: TaskContext;
  mode: EnforcementMode;
  evaluatedAt: string;
}
