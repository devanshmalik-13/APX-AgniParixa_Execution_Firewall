"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ChevronRight, RefreshCw, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type User = { actorId: string; actorName: string; total: number; flagged: number; analyzed: number; latestAt: string };
type Log = { id: string; createdAt: string; prompt: string; source: string; groundTruth: string; status: string; error: string | null; actorName: string; attackLevel: string | null; analyzedAt: string | null; runId: string | null; decision: string | null; riskScore: number | null; executed: boolean | null; analystVerdict: string | null };
type Detail = Log & { mode: string | null; receiptHash: string | null; actionJson: string | null; evaluationJson: string | null; executionJson: string | null; scenarioId: string | null };
const flagged = (log: Log) => log.decision === "block" || log.decision === "approval_required" || log.status === "rejected";

export function AuditExplorer({ refreshKey, active = true }: { refreshKey: number; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [reviewView, setReviewView] = useState<"pending" | "analyzed">("pending");
  const [localRefresh, setLocalRefresh] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [usersError, setUsersError] = useState("");
  const [usersLoading, setUsersLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setUsersLoading(true); setUsersError("");
    fetch("/api/audit/users", { cache: "no-store", signal: controller.signal }).then(async (r) => { if (!r.ok) throw Error("Could not load recorded identities. Try refreshing the audit list."); return await r.json() as { users: User[] }; })
      .then((data) => { if (!controller.signal.aborted) setUsers(data.users); })
      .catch((e) => { if (!controller.signal.aborted) setUsersError(e instanceof Error ? e.message : "Could not load the audit list."); })
      .finally(() => { if (!controller.signal.aborted) setUsersLoading(false); });
    return () => controller.abort();
  }, [active, refreshKey, localRefresh]);
  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController();
    setLogsLoading(true); setError("");
    fetch(`/api/audit/users/${encodeURIComponent(selected.actorId)}?page=${page}&view=${reviewView}`, { cache: "no-store", signal: controller.signal })
      .then(async (r) => { if (!r.ok) throw Error("Could not load user logs"); return await r.json() as { logs: Log[]; total: number }; })
      .then((data) => { if (!controller.signal.aborted) { setLogs(data.logs); setTotal(data.total); } })
      .catch((e) => { if (!controller.signal.aborted) setError(String(e)); })
      .finally(() => { if (!controller.signal.aborted) setLogsLoading(false); });
    return () => controller.abort();
  }, [open, selected, page, reviewView, refreshKey, localRefresh]);
  async function markAnalyzed(id: string) {
    try {
      const response = await fetch(`/api/audit/prompts/${encodeURIComponent(id)}`, { method: "PATCH" });
      if (!response.ok) throw Error("Could not mark this prompt analyzed");
      setDetail(null);
      setLocalRefresh((value) => value + 1);
    } catch (e) { setError(String(e)); }
  }
  async function openDetail(id: string) {
    try {
      const response = await fetch(`/api/audit/prompts/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw Error("Could not load incident detail");
      setDetail(await response.json());
    } catch (e) { setError(String(e)); }
  }
  const evaluation = detail?.evaluationJson ? JSON.parse(detail.evaluationJson) : null;
  const action = detail?.actionJson ? JSON.parse(detail.actionJson) : null;
  const execution = detail?.executionJson ? JSON.parse(detail.executionJson) : null;
  function closeExplorer() { setOpen(false); setDetail(null); setSelected(null); setPage(0); setError(""); }
  function selectUser(user: User, button: HTMLButtonElement) {
    returnFocusRef.current = button;
    setSelected(user); setDetail(null); setLogs([]); setTotal(0); setPage(0); setReviewView("pending"); setError(""); setLogsLoading(true); setOpen(true);
  }
  return <>
    <div className="lab-audit-explorer">
      <header className="lab-audit-heading"><div><span className="workspace-kicker">AUDIT DATABASE</span><h2>User-wise audit log</h2><p className="lab-help">Synthetic demo identities, ranked by flagged prompts. Red means a gateway hold or rejected submission. Select an identity to review its prompts and execution receipts.</p></div><div className="lab-audit-actions"><button className="lab-button" disabled={usersLoading} onClick={() => setLocalRefresh(value => value + 1)}><RefreshCw size={15} className={usersLoading ? "apx-spin" : ""} />Refresh</button><a href="/api/audit/export" download className="lab-button"><ArrowDownToLine size={15} />Download full audit JSON</a></div></header>
      <div className="lab-audit-summary" aria-live="polite"><span><b>{usersLoading && !users.length ? "—" : users.length}</b> identities</span><span><b>{usersLoading && !users.length ? "—" : users.reduce((sum, user) => sum + user.total, 0)}</b> recorded prompts</span><span className="lab-audit-flagged"><b>{usersLoading && !users.length ? "—" : users.reduce((sum, user) => sum + user.flagged, 0)}</b> flagged</span><span><b>{usersLoading && !users.length ? "—" : users.reduce((sum, user) => sum + user.analyzed, 0)}</b> analyzed</span></div>
      {usersError && <p className="lab-error" role="alert">{usersError}</p>}
      {usersLoading && !users.length ? <div className="lab-audit-loading" role="status">Loading recorded identities…</div> : users.length ? <AuditUserList users={users} onSelect={selectUser} /> : !usersError && <div className="lab-audit-empty"><UserRound size={26} /><b>No prompts recorded yet</b><p>Run an attack or the benchmark. The recorded identity and its prompt counts will appear here.</p></div>}
    </div>
    <Dialog open={open} onOpenChange={(value) => value ? setOpen(true) : closeExplorer()}>
    <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusRef.current?.focus(); }} className="soc-scrollbar max-h-[86vh] overflow-y-auto border-white/[0.1] bg-[#0d1114] text-white sm:max-w-3xl">
      <DialogHeader><DialogTitle>{detail ? "Prompt incident" : selected ? `${selected.actorName} · ${reviewView === "pending" ? "to review" : "analyzed logs"}` : "User-wise audit log"}</DialogTitle><DialogDescription>{detail ? "Full prompt, decision, reasons and mock tool result." : selected ? logsLoading ? "Loading recorded prompts…" : `${total} ${reviewView === "pending" ? "to review" : "analyzed"} prompts · newest first · 50 per page` : "Synthetic demo identities, ranked by flagged prompts. Red means a gateway hold or rejected submission."}</DialogDescription></DialogHeader>
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <button onClick={() => { if (detail) setDetail(null); else closeExplorer(); }} className="flex items-center gap-1 text-white/55 hover:text-white"><ArrowLeft className="size-3.5" />{detail ? "Back to prompts" : "Back to identities"}</button>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {detail && <a href={`/api/reports/prompt/${encodeURIComponent(detail.id)}`} download className="rounded-lg border border-[#c8f560]/25 bg-[#c8f560]/10 px-3 py-2 text-[#c8f560]">Generate prompt PDF</a>}
          {selected && <a href={`/api/reports/user/${encodeURIComponent(selected.actorId)}`} download className="rounded-lg border border-[#c8f560]/25 bg-[#c8f560]/10 px-3 py-2 text-[#c8f560]">Generate user PDF</a>}
        </div>
      </div>
      {error && <p className="rounded-lg bg-[#ff6b4a]/10 p-3 text-xs text-[#ff8064]">{error}</p>}
      {selected && !detail && <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1 text-xs">{(["pending", "analyzed"] as const).map((view) => <button key={view} onClick={() => { setReviewView(view); setPage(0); }} className={`rounded-lg py-2 capitalize ${reviewView === view ? "bg-white/[0.09] text-white" : "text-white/40"}`}>{view === "pending" ? "To review" : "Analyzed logs"}</button>)}</div>}
      {detail ? <div className="space-y-4 text-xs">
        <div className={`rounded-xl border p-4 ${flagged(detail) ? "border-[#ff6b4a]/25 bg-[#ff6b4a]/[0.055]" : "border-white/[0.08] bg-white/[0.025]"}`}>
          <div className="flex flex-wrap gap-3 text-[10px] text-white/45"><span>{detail.actorName}</span><span>{new Date(detail.createdAt).toLocaleString()}</span><span>{detail.source}</span><span>{detail.attackLevel ?? "manual"}</span></div>
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">Stored prompt · known secrets redacted</div>
          <p className={`mt-2 whitespace-pre-wrap break-words leading-relaxed ${flagged(detail) ? "text-[#ff8064]" : "text-white/80"}`}>{detail.prompt}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Decision", detail.decision ?? detail.status], ["Risk", detail.riskScore === null ? "—" : `${detail.riskScore}/100`], ["Mock tool", detail.executed === null ? "—" : detail.executed ? "Executed" : "Held"], ["Ground truth", detail.groundTruth]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="text-[10px] text-white/35">{label}</div><div className="mt-1 font-medium text-white/80">{value}</div></div>)}</div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] p-3"><span className="text-white/45">{detail.analyzedAt ? `Analyzed ${new Date(detail.analyzedAt).toLocaleString()}` : "Awaiting analyst review"}</span>{!detail.analyzedAt && <button onClick={() => markAnalyzed(detail.id)} className="rounded-lg bg-[#c8f560] px-3 py-2 font-semibold text-[#11150c]">Mark analyzed</button>}</div>
        <section><h3 className="mb-2 font-semibold text-white/70">Why it was flagged</h3>{evaluation?.findings?.length ? evaluation.findings.map((finding: { id: string; title: string; description: string; severity: string; evidence: unknown }) => <div key={finding.id} className="mb-2 rounded-xl border border-[#ff6b4a]/15 bg-[#ff6b4a]/[0.04] p-3"><div className="font-medium text-[#ff8064]">{finding.title} · {finding.severity}</div><p className="mt-1 text-white/55">{finding.description}</p><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-white/35">{JSON.stringify(finding.evidence, null, 2)}</pre></div>) : <p className="rounded-xl border border-white/[0.07] p-3 text-white/40">{detail.error ?? "No policy findings recorded."}</p>}</section>
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><h3 className="font-semibold text-white/70">Attack flow</h3><div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/55"><span>1 · {detail.source} input</span><ChevronRight className="size-3" /><span>2 · {action?.tool ?? "invalid action"} proposal</span><ChevronRight className="size-3" /><span>3 · {detail.decision ?? "rejected"} by gateway</span><ChevronRight className="size-3" /><span>4 · {detail.executed ? "mock tool executed" : "tool contained"}</span><ChevronRight className="size-3" /><span>5 · audit receipt</span></div></section>
        <div className="grid gap-3 sm:grid-cols-2"><section className="rounded-xl border border-white/[0.07] p-3"><h3 className="mb-2 font-semibold text-white/70">Proposed tool action</h3><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-white/45">{JSON.stringify(action ?? { status: detail.status }, null, 2)}</pre></section><section className="rounded-xl border border-white/[0.07] p-3"><h3 className="mb-2 font-semibold text-white/70">Tool result and analyst</h3><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-white/45">{JSON.stringify({ execution, analystVerdict: detail.analystVerdict }, null, 2)}</pre></section></div>
        <div className="break-all font-mono text-[10px] text-white/30">Receipt SHA-256: {detail.receiptHash ?? "none (submission rejected)"}</div>
      </div> : selected ? <div className="space-y-2" aria-busy={logsLoading}>{logsLoading && <p role="status" className="p-3 text-xs text-white/45">Loading prompt logs…</p>}{logs.map((log) => <div key={log.id} className={`rounded-xl border p-3 ${flagged(log) ? "border-[#ff6b4a]/20 bg-[#ff6b4a]/[0.04]" : "border-white/[0.07] bg-white/[0.02]"}`}><button onClick={() => openDetail(log.id)} className="w-full text-left"><div className="flex items-center justify-between gap-2 text-[10px] text-white/40"><span>{new Date(log.createdAt).toLocaleString()} · {log.attackLevel ?? log.source}</span><span className={flagged(log) ? "text-[#ff8064]" : "text-[#c8f560]"}>{log.decision ?? log.status}</span></div><p className={`mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs ${flagged(log) ? "text-[#ff8064]" : "text-white/70"}`}>{log.prompt}</p></button><div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[10px] text-white/30"><span>{log.analyzedAt ? `Analyzed ${new Date(log.analyzedAt).toLocaleString()}` : "Full evidence retained"}</span>{!log.analyzedAt && <button onClick={() => markAnalyzed(log.id)} className="rounded-lg border border-[#c8f560]/25 px-2.5 py-1.5 font-semibold text-[#c8f560] hover:bg-[#c8f560]/10">Analyzed</button>}</div></div>)}{!logsLoading && !logs.length && <p className="rounded-xl border border-white/[0.07] p-4 text-xs text-white/40">No {reviewView === "pending" ? "prompts awaiting review" : "analyzed prompts"} for this user.</p>}<div className="flex items-center justify-between pt-2 text-xs text-white/45"><button disabled={logsLoading || page === 0} onClick={() => setPage(page - 1)} className="disabled:opacity-30">Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(total / 50))}</span><button disabled={logsLoading || (page + 1) * 50 >= total} onClick={() => setPage(page + 1)} className="disabled:opacity-30">Next</button></div></div> : null}
    </DialogContent>
  </Dialog></>;
}

export function AuditUserList({ users, onSelect }: { users: User[]; onSelect: (user: User, button: HTMLButtonElement) => void }) {
  return <div className="lab-audit-user-grid" role="list" aria-label="Recorded demo identities">{users.map((user, index) => <div key={user.actorId} role="listitem"><button className="lab-audit-user" data-flagged={user.flagged > 0} onClick={event => onSelect(user, event.currentTarget)}>
    <span className="lab-audit-avatar" aria-hidden="true"><UserRound size={20} /></span>
    <span className="lab-audit-user-info"><span className="lab-audit-name"><small>{String(index + 1).padStart(2, "0")}</small><b>{user.actorName}</b></span><span className="lab-audit-counts">{user.total} prompts <i>·</i> {user.analyzed} analyzed</span><span className="lab-audit-latest">Latest <time dateTime={user.latestAt}>{new Date(user.latestAt).toLocaleString()}</time></span></span>
    <span className="lab-audit-user-end"><span className="lab-audit-flag-count">{user.flagged} flagged</span><ChevronRight size={17} aria-hidden="true" /></span>
  </button></div>)}</div>;
}
