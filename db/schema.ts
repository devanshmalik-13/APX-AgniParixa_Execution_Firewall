import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const promptEvents = sqliteTable("prompt_events", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  prompt: text("prompt").notNull(),
  source: text("source").notNull(),
  scenarioId: text("scenario_id"),
  groundTruth: text("ground_truth").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  actorId: text("actor_id").notNull().default("legacy"),
  actorName: text("actor_name").notNull().default("Earlier demo runs"),
  attackLevel: text("attack_level"),
  analyzedAt: text("analyzed_at"),
});

export const auditRuns = sqliteTable("audit_runs", {
  id: text("id").primaryKey(),
  promptId: text("prompt_id").notNull().references(() => promptEvents.id),
  createdAt: text("created_at").notNull(),
  mode: text("mode").notNull(),
  actionId: text("action_id").notNull(),
  actionJson: text("action_json").notNull(),
  evaluationJson: text("evaluation_json").notNull(),
  executionJson: text("execution_json").notNull(),
  decision: text("decision").notNull(),
  executed: integer("executed", { mode: "boolean" }).notNull(),
  riskScore: integer("risk_score").notNull(),
  analystVerdict: text("analyst_verdict"),
  receiptHash: text("receipt_hash").notNull(),
});
