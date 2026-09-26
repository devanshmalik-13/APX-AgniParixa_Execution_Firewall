import { scanForSecrets } from "./secret-scanner";
import { detectBehaviorNovelty } from "./novelty-detector";
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
  const externalDestination = outsideAllowedDestinations(action.destination, task.allowedDestinations);
  const novelty = detectBehaviorNovelty(task, action);

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

  if (action.taskRelevance < policy.relevanceThreshold) {
    findings.push({
      id: "task-mismatch",
      title: "Action is unrelated to the assigned task",
      description: `Task relevance is ${Math.round(action.taskRelevance * 100)}%, below the ${Math.round(policy.relevanceThreshold * 100)}% policy threshold.`,
      severity: "high",
      score: 30,
      hardBlock: false,
      evidence: { relevance: action.taskRelevance, threshold: policy.relevanceThreshold },
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
      score: 20,
      hardBlock: false,
      evidence: { destination: action.destination, allowedDestinations: task.allowedDestinations },
    });
  }

  if (action.changesAuthorization && untrustedSources.length > 0) {
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
