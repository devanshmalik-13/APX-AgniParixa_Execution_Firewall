import type { ActionRequest, TaskContext } from "./types";

export interface BehaviorBaseline {
  knownToolSequences: string[];
  maxSensitiveSourcesPerAction: number;
}

export interface NoveltySignal {
  id: "unseen-tool-chain" | "new-destination" | "new-argument-shape" | "sensitive-data-fan-in";
  label: string;
  weight: number;
  evidence: Record<string, unknown>;
}

export interface NoveltyResult {
  score: number;
  fingerprint: string;
  signals: NoveltySignal[];
  explanation: string;
}

export const defaultBehaviorBaseline: BehaviorBaseline = {
  knownToolSequences: [
    "read_document>send_email",
    "read_document>write_memory",
    "read_document>read_document",
  ],
  maxSensitiveSourcesPerAction: 1,
};

/**
 * Detects deviations from known-safe execution shape without naming an attack.
 * This is deliberately deterministic and explainable: it does not claim that
 * novelty is malicious, only that the action requires analyst attention.
 */
export function detectBehaviorNovelty(
  task: TaskContext,
  action: ActionRequest,
  baseline: BehaviorBaseline = defaultBehaviorBaseline,
): NoveltyResult | null {
  if (!action.behavior) return null;

  const signals: NoveltySignal[] = [];
  const fingerprint = action.behavior.toolSequence.join(">");

  if (!baseline.knownToolSequences.includes(fingerprint)) {
    signals.push({
      id: "unseen-tool-chain",
      label: "Tool chain has not appeared in the safe baseline",
      weight: 35,
      evidence: { observed: fingerprint, known: baseline.knownToolSequences },
    });
  }

  if (!action.behavior.destinationSeenBefore) {
    signals.push({
      id: "new-destination",
      label: "Destination is first-seen for this task class",
      weight: 25,
      evidence: { destination: action.destination ?? "none", task: task.id },
    });
  }

  if (!action.behavior.argumentShapeSeenBefore) {
    signals.push({
      id: "new-argument-shape",
      label: "Tool arguments have a new structural shape",
      weight: 20,
      evidence: { operation: action.operation, argumentKeys: Object.keys(action.arguments).sort() },
    });
  }

  if (action.behavior.sensitiveSourceCount > baseline.maxSensitiveSourcesPerAction) {
    signals.push({
      id: "sensitive-data-fan-in",
      label: "More sensitive sources were combined than usual",
      weight: 25,
      evidence: { observed: action.behavior.sensitiveSourceCount, baselineMaximum: baseline.maxSensitiveSourcesPerAction },
    });
  }

  const score = Math.min(100, signals.reduce((total, signal) => total + signal.weight, 0));
  if (score < 40) return null;

  return {
    score,
    fingerprint,
    signals,
    explanation: "No known attack signature matched. The execution shape differs materially from previously approved behavior.",
  };
}
