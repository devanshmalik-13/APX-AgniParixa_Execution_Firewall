-- Portable, idempotent schema for APX's Cloudflare D1/SQLite audit store.
-- This is the final shape represented by the versioned drizzle/ migrations.
CREATE TABLE IF NOT EXISTS prompt_events (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL,
  prompt TEXT NOT NULL,
  source TEXT NOT NULL,
  scenario_id TEXT,
  ground_truth TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  actor_id TEXT NOT NULL DEFAULT 'legacy',
  actor_name TEXT NOT NULL DEFAULT 'Earlier demo runs',
  attack_level TEXT,
  analyzed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_id TEXT NOT NULL REFERENCES prompt_events(id),
  created_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_json TEXT NOT NULL,
  evaluation_json TEXT NOT NULL,
  execution_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  executed INTEGER NOT NULL,
  risk_score INTEGER NOT NULL,
  analyst_verdict TEXT,
  receipt_hash TEXT NOT NULL
);
