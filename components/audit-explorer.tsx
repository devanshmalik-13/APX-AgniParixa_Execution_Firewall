"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, History, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type User = { actorId: string; actorName: string; total: number; flagged: number; latestAt: string };
type Log = { id: string; createdAt: string; prompt: string; source: string; groundTruth: string; status: string; error: string | null; actorName: string; attackLevel: string | null; runId: string | null; decision: string | null; riskScore: number | null; executed: boolean | null; analystVerdict: string | null };
type Detail = Log & { mode: string | null; receiptHash: string | null; actionJson: string | null; evaluationJson: string | null; executionJson: string | null; scenarioId: string | null };
const flagged = (log: Log) => log.decision === "block" || log.decision === "approval_required" || log.status === "rejected";

export function AuditExplorer({ refreshKey }: { refreshKey: number }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState<User | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    fetch("/api/audit/users", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw Error("Could not load users"); return await r.json() as { users: User[] }; })
      .then((data) => setUsers(data.users)).catch((e) => setError(String(e)));
  }, [open, refreshKey]);
  useEffect(() => {
    if (!open || !selected) return;
    fetch(`/api/audit/users/${encodeURIComponent(selected.actorId)}?page=${page}`, { cache: "no-store" })
      .then(async (r) => { if (!r.ok) throw Error("Could not load user logs"); return await r.json() as { logs: Log[]; total: number }; })
      .then((data) => { setLogs(data.logs); setTotal(data.total); }).catch((e) => setError(String(e)));
  }, [open, selected, page, refreshKey]);
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
  return <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) { setDetail(null); setSelected(null); setPage(0); } }}>
    <DialogTrigger asChild><button className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.09] bg-white/[0.04] py-3 text-xs font-medium text-white/72 transition hover:bg-white/[0.07]"><History className="size-3.5" /> Review user-wise prompt logs</button></DialogTrigger>
    <DialogContent className="soc-scrollbar max-h-[86vh] overflow-y-auto border-white/[0.1] bg-[#0d1114] text-white sm:max-w-3xl">
      <DialogHeader><DialogTitle>{detail ? "Prompt incident" : selected ? `${selected.actorName} · all prompts` : "User-wise audit log"}</DialogTitle><DialogDescription>{detail ? "Full prompt, decision, reasons and mock tool result." : selected ? `${total} stored prompts · newest first · 50 per page` : "Synthetic demo identities, ranked by flagged prompts. Red means a gateway hold or rejected submission."}</DialogDescription></DialogHeader>
      <div className="flex items-center justify-between gap-3 text-[11px]">
        {(selected || detail) ? <button onClick={() => { if (detail) setDetail(null); else { setSelected(null); setPage(0); } }} className="flex items-center gap-1 text-white/55 hover:text-white"><ArrowLeft className="size-3.5" /> Back</button> : <span className="text-white/35">{users.length} users</span>}
        <a href="/api/audit/export" download className="rounded-lg border border-white/[0.09] bg-white/[0.04] px-3 py-2 text-[#c8f560]">Download full JSON</a>
      </div>
      {error && <p className="rounded-lg bg-[#ff6b4a]/10 p-3 text-xs text-[#ff8064]">{error}</p>}
      {detail ? <div className="space-y-4 text-xs">
        <div className={`rounded-xl border p-4 ${flagged(detail) ? "border-[#ff6b4a]/25 bg-[#ff6b4a]/[0.055]" : "border-white/[0.08] bg-white/[0.025]"}`}>
          <div className="flex flex-wrap gap-3 text-[10px] text-white/45"><span>{detail.actorName}</span><span>{new Date(detail.createdAt).toLocaleString()}</span><span>{detail.source}</span><span>{detail.attackLevel ?? "manual"}</span></div>
          <div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-white/40">Original prompt</div>
          <p className={`mt-2 whitespace-pre-wrap break-words leading-relaxed ${flagged(detail) ? "text-[#ff8064]" : "text-white/80"}`}>{detail.prompt}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Decision", detail.decision ?? detail.status], ["Risk", detail.riskScore === null ? "—" : `${detail.riskScore}/100`], ["Mock tool", detail.executed === null ? "—" : detail.executed ? "Executed" : "Held"], ["Ground truth", detail.groundTruth]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><div className="text-[10px] text-white/35">{label}</div><div className="mt-1 font-medium text-white/80">{value}</div></div>)}</div>
        <section><h3 className="mb-2 font-semibold text-white/70">Why it was flagged</h3>{evaluation?.findings?.length ? evaluation.findings.map((finding: { id: string; title: string; description: string; severity: string; evidence: unknown }) => <div key={finding.id} className="mb-2 rounded-xl border border-[#ff6b4a]/15 bg-[#ff6b4a]/[0.04] p-3"><div className="font-medium text-[#ff8064]">{finding.title} · {finding.severity}</div><p className="mt-1 text-white/55">{finding.description}</p><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-white/35">{JSON.stringify(finding.evidence, null, 2)}</pre></div>) : <p className="rounded-xl border border-white/[0.07] p-3 text-white/40">{detail.error ?? "No policy findings recorded."}</p>}</section>
        <section className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3"><h3 className="font-semibold text-white/70">Attack flow</h3><div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/55"><span>1 · {detail.source} input</span><ChevronRight className="size-3" /><span>2 · {action?.tool ?? "invalid action"} proposal</span><ChevronRight className="size-3" /><span>3 · {detail.decision ?? "rejected"} by gateway</span><ChevronRight className="size-3" /><span>4 · {detail.executed ? "mock tool executed" : "tool contained"}</span><ChevronRight className="size-3" /><span>5 · audit receipt</span></div></section>
        <div className="grid gap-3 sm:grid-cols-2"><section className="rounded-xl border border-white/[0.07] p-3"><h3 className="mb-2 font-semibold text-white/70">Proposed tool action</h3><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-white/45">{JSON.stringify(action ?? { status: detail.status }, null, 2)}</pre></section><section className="rounded-xl border border-white/[0.07] p-3"><h3 className="mb-2 font-semibold text-white/70">Tool result and analyst</h3><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-white/45">{JSON.stringify({ execution, analystVerdict: detail.analystVerdict }, null, 2)}</pre></section></div>
        <div className="break-all font-mono text-[10px] text-white/30">Receipt SHA-256: {detail.receiptHash ?? "none (submission rejected)"}</div>
      </div> : selected ? <div className="space-y-2">{logs.map((log) => <button key={log.id} onClick={() => openDetail(log.id)} className={`w-full rounded-xl border p-3 text-left transition hover:bg-white/[0.05] ${flagged(log) ? "border-[#ff6b4a]/20 bg-[#ff6b4a]/[0.04]" : "border-white/[0.07] bg-white/[0.02]"}`}><div className="flex items-center justify-between gap-2 text-[10px] text-white/40"><span>{new Date(log.createdAt).toLocaleString()} · {log.attackLevel ?? log.source}</span><span className={flagged(log) ? "text-[#ff8064]" : "text-[#c8f560]"}>{log.decision ?? log.status}</span></div><p className={`mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs ${flagged(log) ? "text-[#ff8064]" : "text-white/70"}`}>{log.prompt}</p></button>)}<div className="flex items-center justify-between pt-2 text-xs text-white/45"><button disabled={page === 0} onClick={() => setPage(page - 1)} className="disabled:opacity-30">Previous</button><span>Page {page + 1} of {Math.max(1, Math.ceil(total / 50))}</span><button disabled={(page + 1) * 50 >= total} onClick={() => setPage(page + 1)} className="disabled:opacity-30">Next</button></div></div> : <div className="space-y-2">{users.map((user) => <button key={user.actorId} onClick={() => { setSelected(user); setPage(0); }} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-left transition hover:bg-white/[0.06]"><span className={`grid size-9 place-items-center rounded-full ${user.flagged ? "bg-[#ff6b4a]/15 text-[#ff8064]" : "bg-white/[0.07] text-white/45"}`}><UserRound className="size-4" /></span><span className="flex-1"><b className={`block text-sm ${user.flagged ? "text-[#ff8064]" : "text-white/80"}`}>{user.actorName}</b><span className="text-[10px] text-white/35">{user.total} prompts · latest {new Date(user.latestAt).toLocaleString()}</span></span><span className={`rounded-full px-2 py-1 text-xs ${user.flagged ? "bg-[#ff6b4a]/12 text-[#ff8064]" : "bg-white/[0.05] text-white/35"}`}>{user.flagged} flagged</span><ChevronRight className="size-4 text-white/25" /></button>)}{!users.length && <p className="p-5 text-sm text-white/40">No prompts recorded yet. Run a scenario or the benchmark.</p>}</div>}
    </DialogContent>
  </Dialog>;
}
