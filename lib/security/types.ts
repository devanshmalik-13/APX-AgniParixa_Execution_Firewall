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
  tenantId?: string;
  expiresAt?: string;
  filesystem?: {
    root: string;
    operations: Array<"read" | "list" | "write">;
  };
  database?: {
    tables: Record<string, string[]>;
    operations: Array<"select" | "insert" | "update">;
    maxRows: number;
  };
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

export interface ToolExecutionResult {
  executed: boolean;
  tool: string;
  operation: string;
  output?: unknown;
  safeAlternative?: string;
}

export interface AuditReceipt {
  id: string;
  sequence: number;
  previousHash: string;
  hash: string;
  timestamp: string;
  taskId: string;
  actionId: string;
  decision: Decision;
  riskScore: number;
  policyIds: string[];
  executed: boolean;
}

export interface GatewayResponse {
  auditIdentity?: { promptId: string; actorId: string; actorName: string } | null;
  evaluation: EvaluationResult;
  execution: ToolExecutionResult;
  receipt: AuditReceipt;
  latencyMs: number;
  promptId: string;
}
