import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ReportRecord } from "./run-store";

const ink = rgb(0.09, 0.14, 0.17);
const muted = rgb(0.38, 0.44, 0.47);
const danger = rgb(0.72, 0.19, 0.15);
const A4: [number, number] = [595.28, 841.89];
const margin = 47;
const width = A4[0] - margin * 2;

// Standard PDF fonts cannot encode arbitrary Unicode. Keep generation fail-safe;
// the original Unicode prompt remains unchanged in D1 and the JSON export.
function safe(value: unknown): string {
  return String(value ?? "-").normalize("NFKD").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e\n\r\t]/g, "?");
}

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return null; }
}

export function explainOutcome(record: ReportRecord): string {
  if (record.status === "rejected") return `Submission rejected before tool execution: ${record.error ?? "invalid action envelope"}.`;
  if (record.decision === "block") return record.executed
    ? "Policy returned block, but the stored result says the mock tool executed. Escalate this inconsistency."
    : "Blocked by the gateway before mock tool dispatch. The policy findings below identify the violated boundaries.";
  if (record.decision === "approval_required") return record.executed
    ? "Initially held for analyst review, then the exact action was approved and the mock tool executed."
    : "Not automatically blocked as malicious; held at the tool boundary for analyst review. No mock tool execution occurred.";
  if (record.decision === "observe" || record.mode === "unprotected") return record.executed
    ? "Findings were recorded, but observe/unprotected mode permitted mock execution. This is not containment."
    : "Findings were recorded without enforcement; the connector itself did not execute the action.";
  if (record.decision === "allow") return record.groundTruth === "attack"
    ? "Known attack missed by this policy set: no hard boundary fired, so the mock action was allowed. Treat this as a measured bypass."
    : "Allowed because no blocking rule fired for the proposed action. This does not prove the prompt is harmless.";
  return "No completed policy decision is stored for this prompt; inspect the submission status and error.";
}

export async function createIncidentReport(records: ReportRecord[], scope: "prompt" | "user"): Promise<Uint8Array> {
  if (!records.length) throw new Error("No stored prompts exist for this report.");
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const generatedAt = new Date().toISOString();
  let page: PDFPage;
  let y = 0;
  function newPage() {
    page = doc.addPage(A4);
    page.drawRectangle({ x: 0, y: A4[1] - 72, width: A4[0], height: 72, color: ink });
    page.drawText("APX  /  AGNIPARIXA", { x: margin, y: A4[1] - 43, font: bold, size: 15, color: rgb(0.78, 0.94, 0.43) });
    page.drawText("SOC EVIDENCE REPORT", { x: A4[0] - margin - 126, y: A4[1] - 41, font: regular, size: 8, color: rgb(0.8, 0.84, 0.83) });
    y = A4[1] - 105;
  }
  function ensure(height: number) { if (y - height < 53) newPage(); }
  function textLine(value: string, size = 10, font: PDFFont = regular, color = ink, spaceAfter = 3) {
    ensure(size + spaceAfter + 5);
    page.drawText(safe(value), { x: margin, y, size, font, color });
    y -= size + spaceAfter + 3;
  }
  function wrapped(value: unknown, size = 10, font: PDFFont = regular, color = ink, indent = 0) {
    const max = width - indent;
    const chunks = safe(value).split(/\s+/);
    let line = "";
    for (const word of chunks) {
      const proposed = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(proposed, size) <= max) { line = proposed; continue; }
      if (line) { ensure(size + 6); page.drawText(line, { x: margin + indent, y, size, font, color }); y -= size + 6; line = ""; }
      if (font.widthOfTextAtSize(word, size) <= max) { line = word; continue; }
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > max && line) { ensure(size + 6); page.drawText(line, { x: margin + indent, y, size, font, color }); y -= size + 6; line = ""; }
        line += char;
      }
    }
    if (line) { ensure(size + 6); page.drawText(line, { x: margin + indent, y, size, font, color }); y -= size + 6; }
    y -= 4;
  }
  function section(title: string) {
    ensure(34); y -= 11;
    page.drawLine({ start: { x: margin, y: y + 7 }, end: { x: margin + width, y: y + 7 }, thickness: 0.7, color: rgb(0.85, 0.89, 0.87) });
    textLine(title.toUpperCase(), 9, bold, muted, 6);
  }
  newPage();
  const actor = records[0].actorName;
  textLine(scope === "user" ? "User activity report" : "Prompt incident report", 22, bold, ink, 9);
  wrapped(`Synthetic user: ${actor}  |  Generated: ${generatedAt}`, 9, regular, muted);
  if (scope === "user") {
    const flagged = records.filter((r) => r.decision === "block" || r.decision === "approval_required" || r.status === "rejected").length;
    const blocked = records.filter((r) => r.decision === "block" && !r.executed).length;
    const allowedAttacks = records.filter((r) => r.groundTruth === "attack" && r.executed).length;
    const analyzed = records.filter((r) => r.analyzedAt).length;
    section("Scope and counts");
    wrapped(`${records.length} prompts  |  ${flagged} flagged  |  ${blocked} blocked  |  ${allowedAttacks} known attacks executed  |  ${analyzed} analyzed`);
    wrapped("Counts are for this synthetic user's stored records, not a general detection-rate claim. Every prompt follows with its own decision and evidence.", 9, regular, muted);
  }
  records.forEach((record, index) => {
    if (scope === "user") newPage();
    section(`Incident ${index + 1} of ${records.length}`);
    wrapped(`Prompt ID: ${record.id}`, 8.5, mono, muted);
    wrapped(`Recorded: ${record.createdAt}  |  User: ${record.actorName} (${record.actorId})`, 9);
    wrapped(`Scenario: ${record.scenarioId ?? "custom"}  |  Level: ${record.attackLevel ?? "manual"}  |  Source: ${record.source}`, 9);
    wrapped(`Decision: ${record.decision ?? record.status}  |  Risk: ${record.riskScore ?? "n/a"}/100  |  Mode: ${record.mode ?? "n/a"}`, 9, bold, record.decision === "block" ? danger : ink);
    wrapped(`Ground truth: ${record.groundTruth}  |  Analyzed: ${record.analyzedAt ?? "not yet"}`, 9);
    section("Original prompt");
    wrapped(record.prompt, 10);
    section("Why this happened");
    wrapped(explainOutcome(record), 10, regular, record.decision === "block" ? danger : ink);
    const evaluation = parse(record.evaluationJson);
    const findings = Array.isArray(evaluation?.findings) ? evaluation.findings as Array<Record<string, unknown>> : [];
    if (findings.length) {
      for (const finding of findings) {
        wrapped(`${finding.title ?? finding.id} (${finding.severity ?? "unknown"})`, 9.5, bold);
        wrapped(finding.description ?? "No description recorded.", 9);
        wrapped(`Evidence: ${JSON.stringify(finding.evidence ?? {})}`, 8, mono, muted, 11);
      }
    } else wrapped(record.error ?? "No policy findings were recorded. This is not proof of safety.", 9, regular, muted);
    const action = parse(record.actionJson);
    const execution = parse(record.executionJson);
    section("Tool boundary and analyst action");
    wrapped(`Proposed: ${action?.tool ?? "none"}.${action?.operation ?? "none"}  |  Destination: ${action?.destination ?? (action?.arguments as Record<string, unknown> | undefined)?.recipient ?? "none"}`, 9);
    wrapped(`Mock tool executed: ${record.executed === null ? "not recorded" : record.executed ? "yes" : "no"}  |  Analyst verdict: ${record.analystVerdict ?? "none"}`, 9);
    if (execution?.safeAlternative) wrapped(`Containment: ${execution.safeAlternative}`, 9);
    if (execution?.output) wrapped(`Mock result: ${JSON.stringify(execution.output)}`, 8.5, mono, muted);
    section("Audit integrity");
    wrapped(`Receipt SHA-256: ${record.receiptHash ?? "none - request rejected before run"}`, 8, mono, muted);
  });
  section("Coverage and limitations");
  wrapped("This report describes stored sandbox evidence. The agent and tools are synthetic; policy findings are deterministic. An allow decision is not a guarantee of safety, and manual prompts without labels do not count toward measured attack rates.", 8.5, regular, muted);
  const pages = doc.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 39 }, end: { x: margin + width, y: 39 }, thickness: 0.6, color: rgb(0.85, 0.89, 0.87) });
    item.drawText(`APX / PRIVATE SANDBOX     ${index + 1} / ${pages.length}`, { x: margin, y: 25, size: 8, font: regular, color: muted });
  });
  return doc.save();
}
