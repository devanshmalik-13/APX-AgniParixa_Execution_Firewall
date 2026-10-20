import { contentHash, TinyFishError } from "./client";
import { sourceMatches, webEvidenceSchema, type WebEvidence } from "./types";

export async function saveWebEvidence(db: D1Database, owner: string, ticketId: string, evidence: WebEvidence) {
  await db.prepare("INSERT INTO support_web_evidence(owner_id,id,ticket_id,evidence_json) VALUES (?,?,?,?)").bind(owner, evidence.id, ticketId, JSON.stringify(evidence)).run();
}
export async function loadWebEvidence(db: D1Database, owner: string, ticketId: string, id: string, now = Date.now()) {
  const row = await db.prepare("SELECT evidence_json FROM support_web_evidence WHERE owner_id=? AND ticket_id=? AND id=?").bind(owner, ticketId, id).first<{evidence_json:string}>();
  if (!row) throw new TinyFishError(404, "That web reference is not available for this account and ticket. Fetch it again.");
  const evidence = webEvidenceSchema.parse(JSON.parse(row.evidence_json));
  if (Date.parse(evidence.expiresAt) <= now || Date.parse(evidence.fetchedAt) > now || !sourceMatches(evidence.sourceId, evidence.url) || !sourceMatches(evidence.sourceId, evidence.finalUrl) || await contentHash(evidence.text) !== evidence.sha256) {
    throw new TinyFishError(409, "The web reference expired or failed verification. Fetch it again before staging.");
  }
  return evidence;
}

/** Durable per-account cooldown, shared across server isolates. */
export async function reserveWebFetch(db: D1Database, owner: string, now = Date.now()) {
  const token = crypto.randomUUID();
  await db.prepare("INSERT INTO support_web_reservations(owner_id,token,expires_at) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE support_web_reservations.expires_at<=?")
    .bind(owner, token, now + 30000, now).run();
  const row = await db.prepare("SELECT token FROM support_web_reservations WHERE owner_id=?").bind(owner).first<{token:string}>();
  if (row?.token !== token) throw new TinyFishError(429, "Wait 30 seconds between TinyFish fetches for this account.");
}
