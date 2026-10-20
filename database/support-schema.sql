-- Sandbox support workflow. All rows are partitioned by authenticated visitor.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_tickets (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE IF NOT EXISTS support_invoices (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  refunded_cents INTEGER NOT NULL CHECK (refunded_cents >= 0 AND refunded_cents <= amount_cents),
  refundable_cents INTEGER NOT NULL CHECK (refundable_cents >= 0 AND refundable_cents <= amount_cents),
  status TEXT NOT NULL CHECK (status IN ('open', 'disputed', 'resolved')),
  version INTEGER NOT NULL CHECK (version >= 0),
  PRIMARY KEY (owner_id, id)
);
CREATE TABLE IF NOT EXISTS support_plans (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  immutable_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('staged', 'executed', 'recovered', 'rejected')),
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0, 1)),
  executed_at TEXT,
  recovered_at TEXT,
  invoice_after_json TEXT,
  ticket_before_json TEXT,
  execution_token TEXT,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, ticket_id) REFERENCES support_tickets(owner_id, id)
);
CREATE INDEX IF NOT EXISTS support_plans_owner_created ON support_plans(owner_id, created_at DESC);

-- A second ticket cannot replay an already issued refund for this invoice.
-- Removing this ledger entry is allowed only alongside an atomic recovery.
CREATE TABLE IF NOT EXISTS support_refunds (
  owner_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, invoice_id),
  FOREIGN KEY (owner_id, invoice_id) REFERENCES support_invoices(owner_id, id),
  FOREIGN KEY (owner_id, plan_id) REFERENCES support_plans(owner_id, id)
);
CREATE TABLE IF NOT EXISTS support_outbox (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'cancelled')),
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, plan_id) REFERENCES support_plans(owner_id, id)
);
CREATE TABLE IF NOT EXISTS support_events (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  at TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, plan_id) REFERENCES support_plans(owner_id, id)
);
CREATE INDEX IF NOT EXISTS support_events_owner_at ON support_events(owner_id, at DESC);

-- D1 batch is transactional. A failed conditional write must abort the entire
-- batch, including the claim, invoice change, outbox entry and audit event.
-- CHECK failures are assertions, not durable application data.
CREATE TABLE IF NOT EXISTS support_transaction_assertions (
  token TEXT PRIMARY KEY,
  passed INTEGER NOT NULL CHECK (passed = 1)
);

-- Limit paid model planning independently of browser state and process memory.
-- A failed model request retains the short cooldown to prevent retry storms.
CREATE TABLE IF NOT EXISTS support_live_reservations (
  owner_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Retrieved content is untrusted evidence, partitioned by visitor and ticket.
CREATE TABLE IF NOT EXISTS support_web_evidence (
  owner_id TEXT NOT NULL,
  id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  FOREIGN KEY (owner_id, ticket_id) REFERENCES support_tickets(owner_id, id)
);
CREATE TABLE IF NOT EXISTS support_web_reservations (
  owner_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
