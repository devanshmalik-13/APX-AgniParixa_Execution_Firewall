import { scanForSecrets } from "./secret-scanner";
import { detectBehaviorNovelty } from "./novelty-detector";
import { emailBoundary, emailRecipient, filesystemBoundary, operationBoundary } from "./boundaries";
import type {
  ActionRequest,
  EnforcementMode,
  EvaluationResult,
  PolicyFinding,
  TaskContext,
} from "./types";

export interface PolicyOptions {
  relevanceThreshold: number;
  maxIterations: number;
  approvalRiskThreshold: number;
  blockRiskThreshold: number;
}

export const defaultPolicy: PolicyOptions = {
  relevanceThreshold: 0.35,
  maxIterations: 8,
  approvalRiskThreshold: 40,
  blockRiskThreshold: 65,
};

function canonicalPosixPath(value: string): string {
  const segments: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

function outsideAllowedDestinations(destination: string | undefined, allowed: string[]): boolean {
  if (!destination) return false;
  return !allowed.some((entry) => destination === entry || destination.endsWith(`@${entry}`));
}

export function evaluateAction(
  task: TaskContext,
  action: ActionRequest,
  mode: EnforcementMode,
  policy: PolicyOptions = defaultPolicy,
): EvaluationResult {
  const findings: PolicyFinding[] = [];
  const untrustedSources = action.requestedBy.filter((source) => source.trust === "untrusted");
  const sensitiveSources = action.requestedBy.filter((source) => ["confidential", "secret"].includes(source.sensitivity));
  const secretMatches = scanForSecrets(action.content);
  const destination = action.tool === "send_email" ? emailRecipient(action) : action.destination;
  const externalDestination = outsideAllowedDestinations(destination, task.allowedDestinations);
  const novelty = detectBehaviorNovelty(task, action);

  // Retrieved content is data, never authority. Explicit attempts from an
  // untrusted source to destroy or alter protected security material are a
  // hard block even when the proposed tool action looks superficially safe.
  const content = action.content ?? "";
  const destructiveInstruction = /\b(?:delete|remove|erase|destroy|overwrite|wipe|modify)\b/i.test(content);
  const protectedResource = /(?:\.env(?:\.[\w-]+)?|credentials?|private[_ -]?key|api[_ -]?key|audit\s*(?:log|trail)|security\s*(?:policy|config))/i.test(content);
  if (untrustedSources.length > 0 && destructiveInstruction && protectedResource) {
    findings.push({
      id: "untrusted-destructive-instruction",
      title: "Untrusted content requested destructive security action",
      description: "Retrieved content cannot authorize deletion or modification of protected security resources.",
      severity: "critical",
      score: 100,
      hardBlock: true,
      evidence: { sources: untrustedSources.map((source) => source.sourceId) },
    });
  }

  if (task.expiresAt && Date.parse(task.expiresAt) <= Date.now()) {
    findings.push({
      id: "capability-expired",
      title: "Capability passport has expired",
      description: "Expired task authority cannot be reused or replayed.",
      severity: "critical",
      score: 100,
      hardBlock: true,
      evidence: { expiresAt: task.expiresAt },
    });
  }

  if (action.tool === "filesystem") {
    const rawPath = typeof action.arguments.path === "string" ? action.arguments.path : "";
    let resolvedPath = "invalid";
    try {
      resolvedPath = canonicalPosixPath(decodeURIComponent(rawPath));
    } catch {
      // Malformed encodings are rejected below.
    }
    const root = canonicalPosixPath(task.filesystem?.root ?? "/workspace");
    const boundaryError = filesystemBoundary(task, action);
    if (boundaryError) {
      findings.push({
        id: "filesystem-boundary",
        title: "Filesystem sandbox boundary violated",
        description: boundaryError,
        severity: "critical",
        score: 100,
        hardBlock: true,
        evidence: { requestedPath: rawPath, canonicalPath: resolvedPath, sandboxRoot: root },
      });
    }
  }

  if (action.tool === "send_email" && emailBoundary(action)) {
    findings.push({ id: "recipient-boundary", title: "Invalid or conflicting recipient", description: emailBoundary(action)!, severity: "critical", score: 100, hardBlock: true, evidence: { destination: destination ?? null } });
  }

  if (action.tool === "database") {
    const table = String(action.arguments.table ?? "");
    const columns = Array.isArray(action.arguments.columns) ? action.arguments.columns.map(String) : [];
    const tenantId = String(action.arguments.tenantId ?? "");
    const limit = Number(action.arguments.limit ?? 0);
    const allowedColumns = task.database && Object.hasOwn(task.database.tables, table) ? task.database.tables[table] : undefined;
    const invalidScope = !allowedColumns || columns.length === 0 || columns.some((column) => !allowedColumns.includes(column));
    const crossTenant = Boolean(task.tenantId) && tenantId !== task.tenantId;
    const excessiveRows = Boolean(task.database) && (!Number.isInteger(limit) || limit < 1 || limit > task.database!.maxRows);
    const destructive = !task.database?.operations.includes(action.operation as "select" | "insert" | "update");
    if (invalidScope || crossTenant || excessiveRows || destructive) {
      findings.push({
        id: "database-boundary",
        title: "Database capability scope violated",
        description: "The structured query exceeds its table, column, tenant, operation, or row-level grant.",
        severity: "critical",
        score: 100,
        hardBlock: true,
        evidence: { table, columns, tenantId, expectedTenant: task.tenantId, limit, invalidScope, crossTenant, excessiveRows, destructive },
      });
    }
  }

  if (action.tool === "read_document") {
    const documentId = String(action.arguments.documentId ?? "");
    if (!task.allowedData.includes(documentId)) {
      findings.push({ id: "document-out-of-scope", title: "Document is outside the task grant", description: "The requested document is not in the task data allowlist.", severity: "critical", score: 100, hardBlock: true, evidence: { documentId } });
    }
  }

  if (!task.allowedTools.includes(action.tool)) {
    findings.push({
      id: "tool-out-of-scope",
      title: "Tool is outside the assigned task",
      description: `${action.tool} is not approved for task ${task.id}.`,
      severity: "critical",
      score: 55,
      hardBlock: true,
      evidence: { tool: action.tool, allowedTools: task.allowedTools },
    });
  }

  const invalidOperation = operationBoundary(action);
  if (invalidOperation) {
    findings.push({ id: "operation-out-of-scope", title: "Operation is outside the connector grant", description: invalidOperation, severity: "critical", score: 100, hardBlock: true, evidence: { tool: action.tool, operation: action.operation } });
  }

  if (action.taskRelevance < policy.relevanceThreshold) {
    const consequentialMismatch = action.taskRelevance < 0.15 && action.tool !== "read_document";
    findings.push({
      id: "task-mismatch",
      title: "Action is unrelated to the assigned task",
      description: consequentialMismatch
        ? "A consequential tool action cannot expand the agent beyond its assigned objective."
        : `Task relevance is ${Math.round(action.taskRelevance * 100)}%, below the ${Math.round(policy.relevanceThreshold * 100)}% policy threshold.`,
      severity: consequentialMismatch ? "critical" : "medium",
      score: consequentialMismatch ? 65 : 25,
      hardBlock: consequentialMismatch,
      evidence: { relevance: action.taskRelevance, threshold: policy.relevanceThreshold, consequentialMismatch },
    });
  }

  if (untrustedSources.length > 0 && action.tool !== "read_document") {
    findings.push({
      id: "untrusted-authority",
      title: "Untrusted content attempted to authorize an action",
      description: "Retrieved content may provide data, but it cannot grant tool authority.",
      severity: "high",
      score: 30,
      hardBlock: false,
      evidence: { sources: untrustedSources.map((source) => source.sourceId) },
    });
  }

  if (externalDestination && (secretMatches.length > 0 || sensitiveSources.length > 0)) {
    findings.push({
      id: "sensitive-egress",
      title: "Sensitive data is leaving an approved boundary",
      description: "Confidential data cannot be sent to an unapproved destination.",
      severity: "critical",
      score: 65,
      hardBlock: true,
      evidence: { destination: action.destination, secretTypes: secretMatches.map((match) => match.type), sensitiveSources: sensitiveSources.map((source) => source.sourceId) },
    });
  } else if (externalDestination) {
    findings.push({
      id: "external-egress",
      title: "External destination requires approval",
      description: `${action.destination} is not in the task allowlist.`,
      severity: "medium",
      // Unknown egress must never execute silently. Keep the score at the
      // approval threshold even when content inspection finds no secret.
      score: 40,
      hardBlock: false,
      evidence: { destination: action.destination, allowedDestinations: task.allowedDestinations },
    });
  }

  if (action.tool === "write_memory" && untrustedSources.length > 0) {
    findings.push({
      id: "memory-poisoning",
      title: "Untrusted content attempted to change authorization memory",
      description: "Security facts cannot be written to memory from an untrusted source.",
      severity: "critical",
      score: 70,
      hardBlock: true,
      evidence: { sources: untrustedSources.map((source) => source.sourceId), operation: action.operation },
    });
  }

  if ((action.currentIteration ?? 0) > policy.maxIterations) {
    findings.push({
      id: "iteration-budget",
      title: "Agent iteration budget exceeded",
      description: `Execution exceeded the ${policy.maxIterations}-iteration safety budget.`,
      severity: "critical",
      score: 100,
      hardBlock: true,
      evidence: { currentIteration: action.currentIteration, maximum: policy.maxIterations },
    });
  }

  if (novelty) {
    findings.push({
      id: "novel-behavior",
      title: "Execution behavior is novel for this task",
      description: novelty.explanation,
      severity: "high",
      // Novelty alone requests human review; it does not prove maliciousness.
      score: 45,
      hardBlock: false,
      evidence: {
        noveltyScore: novelty.score,
        fingerprint: novelty.fingerprint,
        signals: novelty.signals.map((signal) => signal.id),
      },
    });
  }

  const riskScore = Math.min(100, findings.reduce((total, finding) => total + finding.score, 0));
  const mustBlock = findings.some((finding) => finding.hardBlock) || riskScore >= policy.blockRiskThreshold;
  const needsApproval = riskScore >= policy.approvalRiskThreshold;

  const decision = mode === "unprotected"
    ? "allow"
    : mode === "observe"
      ? "observe"
      : mustBlock
        ? "block"
        : needsApproval
          ? "approval_required"
          : "allow";

  return {
    decision,
    riskScore,
    findings,
    action,
    task,
    mode,
    evaluatedAt: new Date().toISOString(),
  };
}
