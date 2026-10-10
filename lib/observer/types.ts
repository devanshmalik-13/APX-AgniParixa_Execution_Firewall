export type ObserverModelKey = "prompt-guard-22m" | "prompt-guard-86m" | "piguard";
export interface ObserverInputText {
  id: string;
  source: "customer_context" | "proposed_reply";
  text: string;
}
export interface ObserverModel {
  key: ObserverModelKey;
  id: string;
  /** Resolved immutable Hugging Face commit, never a moving branch name. */
  revision: string;
  device: string;
  precision?: "float32" | "bfloat16";
}
export interface ObserverEvidence {
  schemaVersion: 1;
  mode: "shadow";
  status: "observed" | "not_configured" | "unavailable";
  verdict: "benign" | "suspicious" | "unknown";
  model: ObserverModel | null;
  threshold: number;
  maxScore: number | null;
  segments: { textId: string; startToken: number; endToken: number; score: number; label: "benign" | "suspicious" }[];
  coverage: { complete: boolean; windowTokens: 512; overlapTokens: 64; totalTokens: number; segments: number };
  latencyMs: number;
  reason: string;
}
export interface ObserverConfigView {
  mode: "shadow";
  configured: boolean;
  available: boolean;
  activeModel: ObserverModelKey | null;
  models: { key: ObserverModelKey; label: string; available: boolean; status: "ready" | "not_loaded" | "unavailable" | "not_configured" }[];
  serviceStatus: "not_configured" | "ready" | "unavailable";
  limitations: string[];
}
export type ObserverResult = ObserverEvidence;
export type ObserverReadiness = ObserverConfigView;
export type ModelKey = ObserverModelKey;
