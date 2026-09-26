import { env } from "cloudflare:workers";
import { executeTool } from "./connectors";
import { demoTask } from "./scenarios";
import type { ActionRequest } from "./types";
import type { AuditReceipt, EvaluationResult, ToolExecutionResult } from "./types";

export type GroundTruth = "attack" | "legitimate" | "unknown";

export interface PromptRecord {
  id: string;
  createdAt: string;
  prompt: string;
  source: "benchmark" | "replay" | "custom";
  scenarioId: string | null;
  groundTruth: GroundTruth;
  status: string;
  error: string | null;
}

export interface StoredRun {
  id: string;
  promptId: string;
  createdAt: string;
  mode: string;
  actionId: string;
  decision: string;
  executed: boolean;
  riskScore: number;
  analystVerdict: string | null;
  receiptHash: string;
  prompt: string;
  source: string;
  scenarioId: string | null;
  groundTruth: GroundTruth;
}

export interface RunMetrics {
  attempts: number;
  attacks: number;
  contained: number;
  defenseRate: number | null;
  legitimate: number;
  falsePositives: number;
  falsePositiveRate: number | null;
}

function database(): D1Database {
  if (!env.DB) throw new Error("Audit database is unavailable; the gateway stopped before execution.");
  return env.DB;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function recordPrompt(input: {
  prompt: string;
  source: "benchmark" | "replay" | "custom";
  scenarioId?: string;
  groundTruth?: GroundTruth;
}): Promise<PromptRecord> {
  const row: PromptRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    prompt: input.prompt,
    source: input.source,
    scenarioId: input.scenarioId ?? null,
    groundTruth: input.groundTruth ?? "unknown",
    status: "received",
    error: null,
  };
  await database().prepare(
    "INSERT INTO prompt_events (id, created_at, prompt, source, scenario_id, ground_truth, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(row.id, row.createdAt, row.prompt, row.source, row.scenarioId, row.groundTruth, row.status, row.error).run();
  return row;
}

export async function markPromptRejected(id: string, reason: string): Promise<void> {
  await database().prepare("UPDATE prompt_events SET status = 'rejected', error = ? WHERE id = ?")
    .bind(reason.slice(0, 500), id).run();
}

export async function recordRun(
  promptId: string,
  evaluation: EvaluationResult,
  execution: ToolExecutionResult,
): Promise<AuditReceipt> {
  const db = database();
  const prior = await db.prepare("SELECT receipt_hash FROM audit_runs ORDER BY rowid DESC LIMIT 1")
    .first<{ receipt_hash: string }>();
  const count = await db.prepare("SELECT COUNT(*) AS count FROM audit_runs").first<{ count: number }>();
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const previousHash = prior?.receipt_hash ?? "GENESIS";
  const payload = JSON.stringify({ id, promptId, timestamp, evaluation, execution, previousHash });
  const hash = await sha256(payload);
  await db.batch([
    db.prepare("INSERT INTO audit_runs (id, prompt_id, created_at, mode, action_id, action_json, evaluation_json, execution_json, decision, executed, risk_score, analyst_verdict, receipt_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, promptId, timestamp, evaluation.mode, evaluation.action.id, JSON.stringify(evaluation.action), JSON.stringify(evaluation), JSON.stringify(execution), evaluation.decision, execution.executed ? 1 : 0, evaluation.riskScore, null, hash),
    db.prepare("UPDATE prompt_events SET status = 'evaluated' WHERE id = ?").bind(promptId),
  ]);
  return {
    id,
    sequence: (count?.count ?? 0) + 1,
    previousHash,
    hash,
    timestamp,
    taskId: evaluation.task.id,
    actionId: evaluation.action.id,
    decision: evaluation.decision,
    riskScore: evaluation.riskScore,
    policyIds: evaluation.findings.map((finding) => finding.id),
    executed: execution.executed,
  };
}

export async function listPromptRecords(limit = 100): Promise<PromptRecord[]> {
  const { results } = await database().prepare(
    "SELECT id, created_at AS createdAt, prompt, source, scenario_id AS scenarioId, ground_truth AS groundTruth, status, error FROM prompt_events ORDER BY created_at DESC, id DESC LIMIT ?",
  ).bind(Math.min(Math.max(limit, 1), 500)).all<PromptRecord>();
  return results;
}

export async function listRuns(limit = 100): Promise<StoredRun[]> {
  const { results } = await database().prepare(
    "SELECT r.id, r.prompt_id AS promptId, r.created_at AS createdAt, r.mode, r.action_id AS actionId, r.decision, r.executed, r.risk_score AS riskScore, r.analyst_verdict AS analystVerdict, r.receipt_hash AS receiptHash, p.prompt, p.source, p.scenario_id AS scenarioId, p.ground_truth AS groundTruth FROM audit_runs r JOIN prompt_events p ON p.id = r.prompt_id ORDER BY r.created_at DESC, r.id DESC LIMIT ?",
  ).bind(Math.min(Math.max(limit, 1), 500)).all<StoredRun>();
  return results.map((row) => ({ ...row, executed: Boolean(row.executed) }));
}

export async function getRunMetrics(): Promise<RunMetrics> {
  const row = await database().prepare(`
    SELECT
      COUNT(*) AS attempts,
      SUM(CASE WHEN p.ground_truth = 'attack' THEN 1 ELSE 0 END) AS attacks,
      SUM(CASE WHEN p.ground_truth = 'attack' AND r.executed = 0 THEN 1 ELSE 0 END) AS contained,
      SUM(CASE WHEN p.ground_truth = 'legitimate' THEN 1 ELSE 0 END) AS legitimate,
      SUM(CASE WHEN p.ground_truth = 'legitimate' AND r.executed = 0 THEN 1 ELSE 0 END) AS falsePositives
    FROM audit_runs r JOIN prompt_events p ON p.id = r.prompt_id
    WHERE p.source = 'benchmark' AND r.mode = 'enforce'
  `).first<{ attempts: number; attacks: number | null; contained: number | null; legitimate: number | null; falsePositives: number | null }>();
  const attempts = row?.attempts ?? 0;
  const attacks = row?.attacks ?? 0;
  const contained = row?.contained ?? 0;
  const legitimate = row?.legitimate ?? 0;
  const falsePositives = row?.falsePositives ?? 0;
  return {
    attempts,
    attacks,
    contained,
    defenseRate: attacks ? contained / attacks : null,
    legitimate,
    falsePositives,
    falsePositiveRate: legitimate ? falsePositives / legitimate : null,
  };
}

export async function exportAllAuditRecords(): Promise<{ prompts: PromptRecord[]; runs: Array<StoredRun & { actionJson: string; evaluationJson: string; executionJson: string }> }> {
  const db = database();
  const prompts: PromptRecord[] = [];
  let promptCursor = 0;
  while (true) {
    const batch = await db.prepare("SELECT rowid AS cursor, id, created_at AS createdAt, prompt, source, scenario_id AS scenarioId, ground_truth AS groundTruth, status, error FROM prompt_events WHERE rowid > ? ORDER BY rowid ASC LIMIT 500")
      .bind(promptCursor).all<PromptRecord & { cursor: number }>();
    prompts.push(...batch.results);
    if (batch.results.length < 500) break;
    promptCursor = batch.results.at(-1)!.cursor;
  }
  const runs: Array<StoredRun & { actionJson: string; evaluationJson: string; executionJson: string }> = [];
  let runCursor = 0;
  while (true) {
    const batch = await db.prepare("SELECT r.rowid AS cursor, r.id, r.prompt_id AS promptId, r.created_at AS createdAt, r.mode, r.action_id AS actionId, r.action_json AS actionJson, r.evaluation_json AS evaluationJson, r.execution_json AS executionJson, r.decision, r.executed, r.risk_score AS riskScore, r.analyst_verdict AS analystVerdict, r.receipt_hash AS receiptHash, p.prompt, p.source, p.scenario_id AS scenarioId, p.ground_truth AS groundTruth FROM audit_runs r JOIN prompt_events p ON p.id = r.prompt_id WHERE r.rowid > ? ORDER BY r.rowid ASC LIMIT 500")
      .bind(runCursor).all<StoredRun & { cursor: number; actionJson: string; evaluationJson: string; executionJson: string }>();
    runs.push(...batch.results.map((row) => ({ ...row, executed: Boolean(row.executed) })));
    if (batch.results.length < 500) break;
    runCursor = batch.results.at(-1)!.cursor;
  }
  return { prompts, runs };
}

export async function setAnalystVerdict(id: string, verdict: "contained" | "safe"): Promise<{ updated: boolean; execution?: ToolExecutionResult; reason?: string }> {
  const db = database();
  const row = await db.prepare("SELECT action_json, created_at, decision, analyst_verdict FROM audit_runs WHERE id = ?")
    .bind(id).first<{ action_json: string; created_at: string; decision: string; analyst_verdict: string | null }>();
  if (!row || row.decision !== "approval_required" || row.analyst_verdict) return { updated: false, reason: "This request is not pending analyst review." };
  if (Date.now() - Date.parse(row.created_at) > 5 * 60_000) return { updated: false, reason: "The five-minute approval window expired." };
  const claim = await db.prepare("UPDATE audit_runs SET analyst_verdict = ? WHERE id = ? AND analyst_verdict IS NULL")
    .bind(verdict, id).run();
  if ((claim.meta.changes ?? 0) === 0) return { updated: false, reason: "This request has already been resolved." };
  if (verdict === "contained") return { updated: true };
  let execution: ToolExecutionResult;
  try {
    execution = executeTool(demoTask, JSON.parse(row.action_json) as ActionRequest);
  } catch (error) {
    execution = { executed: false, tool: "unknown", operation: "approval", safeAlternative: error instanceof Error ? error.message : "Connector refused execution." };
  }
  await db.prepare("UPDATE audit_runs SET executed = ?, execution_json = ?, analyst_verdict = ? WHERE id = ?")
    .bind(execution.executed ? 1 : 0, JSON.stringify(execution), execution.executed ? "safe" : "execution_failed", id).run();
  return { updated: true, execution };
}
