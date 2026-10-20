import type { ReactNode, Ref } from "react";
import { BarChart3, Database, Eye, FileText, FlaskConical, ShieldCheck, Sparkles, Ticket } from "lucide-react";

const workspaces = [
  { id: "support", label: "Workspace", href: "/support", icon: Ticket },
  { id: "compare", label: "Compare", href: "/evaluation", icon: BarChart3 },
  { id: "observer", label: "Observer", href: "/observer", icon: Eye },
  { id: "lab", label: "Attack lab", href: "/lab", icon: FlaskConical },
] as const;

export function WorkspaceHeader({ active }: { active: typeof workspaces[number]["id"] }) {
  return <header className="workspace-header">
    <a className="workspace-brand" href="/support" aria-label="APX support workspace">
      <span className="workspace-brand-mark"><ShieldCheck size={23} strokeWidth={1.7} /></span>
      <span><b>APX<span>.</span></b><small>AgniParixa / Execution firewall</small></span>
    </a>
    <nav className="workspace-navigation" aria-label="Main navigation">
      {workspaces.map(({ id, label, href, icon: Icon }) => <a key={id} href={href} aria-current={id === active ? "page" : undefined} aria-label={label}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></a>)}
    </nav>
    <span className="workspace-environment"><i />Demo sandbox</span>
  </header>;
}

export function WorkspaceHeading({ eyebrow, title, subtitle, icon, headingRef }: {
  eyebrow: string; title: string; subtitle: string; icon: ReactNode; headingRef?: Ref<HTMLHeadingElement>;
}) {
  return <div className="workspace-heading">
    <span className="workspace-heading-icon" aria-hidden="true">{icon}</span>
    <div><span className="workspace-kicker">{eyebrow}</span><h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h1><p>{subtitle}</p></div>
  </div>;
}

export function WorkspacePath({ observer = false }: { observer?: boolean }) {
  const nodes = observer ? [
    { label: "Customer text", detail: "Untrusted input", icon: FileText, tone: "amber" },
    { label: "Small observer", detail: "Checks for suspicious text", icon: Eye, tone: "lime" },
    { label: "Model evidence", detail: "Advisory prediction", icon: BarChart3, tone: "blue" },
    { label: "Task permissions", detail: "Still enforced independently", icon: ShieldCheck, tone: "lime" },
  ] : [
    { label: "Customer request", detail: "One assigned task", icon: Ticket, tone: "amber" },
    { label: "AI proposal", detail: "No changes yet", icon: Sparkles, tone: "lime" },
    { label: "Permission check", detail: "Trusted limits", icon: ShieldCheck, tone: "blue" },
    { label: "Sandbox changes", detail: "After your execution decision", icon: Database, tone: "lime" },
  ];
  return <figure className={`workspace-path ${observer ? "workspace-path-observer" : ""}`}>
    <figcaption><span className="workspace-kicker">{observer ? "OBSERVATION PATH" : "EXECUTION PATH"}</span><b>{observer ? "A signal. Never a permission." : "A proposal before a change."}</b><small>Workflow illustration</small></figcaption>
    <div className="workspace-path-canvas">
      <svg viewBox="0 0 400 260" preserveAspectRatio="none" aria-hidden="true"><path d="M75 80 C145 80 130 45 245 45 S315 150 155 150 S220 218 320 218" /></svg>
      {nodes.map(({ label, detail, icon: Icon, tone }, index) => <div key={label} className={`workspace-path-node workspace-path-node-${index}`} data-tone={tone}><span><Icon size={24} strokeWidth={1.6} /></span><b>{label}</b><small>{detail}</small></div>)}
    </div>
  </figure>;
}
