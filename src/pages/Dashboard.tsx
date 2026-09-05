/**
 * Dashboard — PRODUCTION: live data from the Node.js/Express backend.
 * Core dashboard widgets require dashboard:view. Optional lead-source analytics
 * are loaded only when the signed-in role also has reports:view.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  Target, Flame, Filter as FilterIcon, TrendingUp, Users, Briefcase, Wallet, AlertTriangle,
  PhoneCall, Clock, ArrowUpRight, Plus, FileText, CheckCircle2, ServerCrash, RefreshCw,
} from "lucide-react";
import { useStore } from "../store";
import { DEMO_MODE, dashboardApi, reportApi } from "../lib/api";
import type { ApiActivity, ApiAgenda, ApiDashboard, ApiHotLead } from "../lib/apiTypes";
import { fromApiDashboard, fromApiHotLead } from "../lib/mappers";
import type { UiDashboard } from "../lib/mappers";
import { inr, fmtD, timeAgo } from "../lib/format";
import { Badge, Btn, EmptyState, Reveal, Skeleton, Money } from "../components/ui";

const CHART_COLORS = ["#0F766E", "#F2C879", "#4D9C87", "#DB9B28", "#82BCAB", "#99A193", "#24836D", "#C4C9BB"];
const tooltipStyle = { borderRadius: 8, border: "1px solid #dee1d7", fontSize: 12, fontFamily: "IBM Plex Sans" } as const;

function StatTile({ label, value, sub, icon: Icon, tone = "teal", delay, onClick }: {
  label: string; value: string; sub?: string; icon: typeof Target; tone?: "teal" | "amber" | "red" | "green" | "slate"; delay: number; onClick?: () => void;
}) {
  const iconCls = { teal: "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300", amber: "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300", red: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300", green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300", slate: "bg-ink-100 text-ink-500 dark:bg-ink-800 dark:text-ink-300" }[tone];
  return (
    <Reveal delay={delay}>
      <button onClick={onClick} className={`card group flex w-full items-center gap-3 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${onClick ? "" : "cursor-default"}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconCls}`}><Icon size={17} /></span>
        <span className="min-w-0">
          <span className="block truncate text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-400">{label}</span>
          <span className="num block text-[19px] font-semibold leading-tight text-ink-900 dark:text-ink-50">{value}</span>
          {sub && <span className="block truncate text-[10.5px] text-ink-400">{sub}</span>}
        </span>
      </button>
    </Reveal>
  );
}

interface DashData {
  kpi: UiDashboard;
  hot: ReturnType<typeof fromApiHotLead>[];
  agenda: ApiAgenda;
  activity: ApiActivity[];
  sources: { name: string; value: number }[];
}

export default function Dashboard() {
  const { user, can, booting } = useStore();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<DashData | null>(null);
  const canViewReports = can("reports", "view");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    if (!DEMO_MODE) {
      try {
        const [dash, hot, agenda, activity] = await Promise.all([
          dashboardApi.get(), dashboardApi.hotLeads(), dashboardApi.agenda(), dashboardApi.activity(),
        ]);
        let bySource: Record<string, number> = {};
        if (canViewReports) {
          try {
            const rep = await reportApi.leads({ page_size: 1 });
            bySource = (rep.data as { by_source?: Record<string, number> }).by_source || {};
          } catch {
            // Reports analytics are optional on the dashboard. A report permission
            // issue must never make the whole employee dashboard look offline.
            bySource = {};
          }
        }
        setData({
          kpi: fromApiDashboard(dash.data as ApiDashboard),
          hot: (hot.data as ApiHotLead[]).map(fromApiHotLead),
          agenda: agenda.data as ApiAgenda,
          activity: activity.data as ApiActivity[],
          sources: Object.entries(bySource).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unable to load dashboard.");
      } finally { setLoading(false); }
      return;
    }
    // DEMO MODE fallback — embedded sample workspace
    const { getDB } = await import("../lib/db");
    const svc = await import("../lib/services");
    const d = getDB();
    const m = svc.dashMetrics(d);
    setData({
      kpi: { totalLeads: m.totalLeads, newLeads: m.newToday, hot: m.hot, qualified: m.qualified, converted: m.converted,
             customers: m.customers, pipelineValue: m.pipelineValue, revenue: m.revenue, outstanding: m.outstanding,
             fuToday: m.fuToday, fuOverdue: m.fuOverdue, tasksDue: d.tasks.filter((t) => t.status !== "Completed").length,
             overdueTasks: 0, meetingsToday: d.meetings.filter((x) => x.date === svc.todayISO()).length,
             conversionRate: m.conversionRate, winRate: m.winRate,
             pipelineByStage: d.dealStages.filter((s) => s.kind === "open").map((s) => ({ stage: s.name, count: d.deals.filter((x) => x.stageId === s.id).length, value: d.deals.filter((x) => x.stageId === s.id).reduce((a, b) => a + b.value, 0) })),
             leadsByMonth: svc.leadGrowth(d).map((w) => ({ month: w.week, leads: w.leads })) },
      hot: d.leads.filter((l) => l.temperature === "Hot" && !["Converted", "Lost", "Won"].includes(l.status)).slice(0, 6)
        .map((l) => ({ id: l.id, businessName: l.businessName, city: l.city, industry: l.industry, score: l.score, estimatedValue: l.estimatedValue, recommendedAction: l.recommendedAction })),
      agenda: { followups: d.followups.filter((f) => f.date === svc.todayISO() && f.status === "Scheduled").slice(0, 6).map((f) => ({ id: 0, type: f.type, time: f.time, entity_type: f.entityType, entity_id: null, name: d.leads.find((l) => l.id === f.entityId)?.businessName || d.customers.find((c) => c.id === f.entityId)?.company || "—", employee: d.users.find((u) => u.id === f.employeeId)?.name || "" })), meetings: [] },
      activity: d.activities.slice(0, 14).map((a) => ({ id: 0, user: d.users.find((u) => u.id === a.userId)?.name || "System", action: a.action, detail: a.detail, at: a.at })),
      sources: (() => { const mp = new Map<string, number>(); d.leads.forEach((l) => mp.set(l.source, (mp.get(l.source) || 0) + 1)); return [...mp.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7); })(),
    });
    setLoading(false);
  }, [canViewReports]);

  useEffect(() => { if (!booting) void load(); }, [booting, load]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const userName = user?.name.split(" ")[0] || "";
  const k = data?.kpi;
  const maxStage = useMemo(() => Math.max(...(k?.pipelineByStage.map((s) => s.value) || [1]), 1), [k]);

  if (booting || loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4 p-4 md:p-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)}</div>
        <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72 lg:col-span-2" /><Skeleton className="h-72" /></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-center p-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-red-300 text-red-500"><ServerCrash size={26} /></span>
        <h1 className="hd mt-4 text-[20px]">Unable to load dashboard</h1>
        <p className="mt-1 max-w-md text-[13px] text-ink-500">{error} — check your connection and assigned CRM permissions, then retry.</p>
        <Btn className="mt-4" onClick={() => void load()}><RefreshCw size={14} /> Retry connection</Btn>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="hd text-[24px]">{greet}, {userName} <span className="align-middle text-[13px] font-normal text-ink-400">· {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span></h1>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {DEMO_MODE ? "Demo workspace — sample data in your browser." : "Live from the company database — every figure computed server-side."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("followups", "create") && <Btn variant="outline" size="sm" onClick={() => nav("/followups?new=1")}><PhoneCall size={14} /> Follow-up</Btn>}
          {can("quotations", "create") && <Btn variant="outline" size="sm" onClick={() => nav("/quotations?new=1")}><FileText size={14} /> Quotation</Btn>}
          {can("leads", "create") && <Btn size="sm" onClick={() => nav("/leads?new=1")}><Plus size={15} /> Add Lead</Btn>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <StatTile delay={0} label="Total Leads" value={String(k!.totalLeads)} sub={`${k!.newLeads} new`} icon={Target} onClick={() => nav("/leads")} />
        <StatTile delay={40} label="Hot Leads" value={String(k!.hot)} sub="act within 48h" icon={Flame} tone="red" onClick={() => nav("/leads?filter=hot")} />
        <StatTile delay={80} label="Qualified" value={String(k!.qualified)} sub={`${k!.converted} converted`} icon={FilterIcon} tone="slate" onClick={() => nav("/leads")} />
        <StatTile delay={120} label="Conversion" value={`${k!.conversionRate}%`} sub={`win rate ${k!.winRate}%`} icon={TrendingUp} tone="green" onClick={() => canViewReports && nav("/reports")} />
        <StatTile delay={160} label="Customers" value={String(k!.customers)} sub="active accounts" icon={Users} onClick={() => nav("/customers")} />
        <StatTile delay={200} label="Pipeline" value={inr(k!.pipelineValue)} sub="open deals" icon={Briefcase} onClick={() => nav("/pipeline")} />
        <StatTile delay={240} label="Revenue (month)" value={inr(k!.revenue)} sub="payments received" icon={Wallet} tone="green" onClick={() => nav("/invoices?tab=payments")} />
        <StatTile delay={280} label="Outstanding" value={inr(k!.outstanding)} sub="invoices unpaid" icon={Clock} tone="amber" onClick={() => nav("/invoices")} />
        <StatTile delay={320} label="Follow-ups Today" value={String(k!.fuToday)} sub={`${k!.fuOverdue} overdue`} icon={PhoneCall} onClick={() => nav("/followups")} />
        <StatTile delay={360} label="Tasks Due" value={String(k!.tasksDue)} sub={`${k!.overdueTasks} overdue · ${k!.meetingsToday} meetings today`} icon={AlertTriangle} tone={k!.overdueTasks ? "red" : "slate"} onClick={() => nav("/tasks")} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2" delay={120}>
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div><h3 className="hd text-[15px]">Lead Growth</h3><p className="text-[11.5px] text-ink-400">Last 6 months · created leads</p></div>
              <Badge tone="teal">server-side</Badge>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={k!.leadsByMonth}>
                <defs><linearGradient id="gLead" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0F766E" stopOpacity={0.35} /><stop offset="100%" stopColor="#0F766E" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#dee1d7" vertical={false} opacity={0.5} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6e766a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#6e766a" }} axisLine={false} tickLine={false} width={26} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area dataKey="leads" stroke="#0F766E" strokeWidth={2} fill="url(#gLead)" name="Leads" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div className="card flex h-full flex-col p-4">
            <h3 className="hd text-[15px]">Lead Sources</h3>
            <p className="text-[11.5px] text-ink-400">{canViewReports ? "Where leads come from" : "Reports permission required for source analytics"}</p>
            <div className="min-h-0 flex-1">
              <ResponsiveContainer width="100%" height={210}>
                <PieChart>
                  <Pie data={data.sources} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3} strokeWidth={0}>
                    {data.sources.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {data.sources.slice(0, 6).map((s, i) => (
                <div key={s.name} className="flex items-center gap-1.5 text-[11px] text-ink-500">
                  <span className="h-2 w-2 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="truncate">{s.name}</span><span className="num ml-auto text-ink-400">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Reveal delay={80}>
          <div className="card p-4">
            <h3 className="hd text-[15px]">Open Pipeline</h3>
            <p className="text-[11.5px] text-ink-400">Value by stage</p>
            <div className="mt-3 space-y-2.5">
              {k!.pipelineByStage.map((s, i) => (
                <div key={s.stage}>
                  <div className="mb-1 flex items-center justify-between text-[11.5px]">
                    <span className="font-medium text-ink-600 dark:text-ink-300">{s.stage} <span className="num text-ink-400">({s.count})</span></span>
                    <Money v={s.value} className="text-[11.5px] font-semibold text-ink-700 dark:text-ink-200" />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
                    <div className="a-bar h-full rounded-full" style={{ width: `${(s.value / maxStage) * 100}%`, background: CHART_COLORS[i % 4], animationDelay: `${i * 70}ms` }} />
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => nav("/pipeline")} className="mt-3 flex items-center gap-1 text-[12px] font-semibold text-brand-600 hover:text-brand-700">Open pipeline <ArrowUpRight size={13} /></button>
          </div>
        </Reveal>

        <Reveal delay={160}>
          <div className="card flex h-full flex-col p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="hd text-[15px]">Today's Agenda</h3>
              <Badge tone={data.agenda.followups.length ? "amber" : "slate"}>{data.agenda.followups.length + data.agenda.meetings.length} items</Badge>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {data.agenda.meetings.map((mm) => (
                <button key={`m${mm.id}`} onClick={() => nav("/meetings")} className="flex w-full items-center gap-3 rounded-md border border-ink-100 bg-white/60 p-2.5 text-left transition-all hover:border-brand-300 hover:shadow-sm dark:border-ink-800 dark:bg-ink-800/50">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300"><Users size={15} /></span>
                  <span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">{mm.title}</span>
                    <span className="num text-[11px] text-ink-400">{mm.start}–{mm.end} · {mm.location}</span></span>
                </button>
              ))}
              {data.agenda.followups.map((f, i) => (
                <button key={`f${f.id || i}`} onClick={() => nav(f.entity_type === "lead" ? `/leads?open=${f.entity_id}` : "/followups")} className="flex w-full items-center gap-3 rounded-md border border-ink-100 bg-white/60 p-2.5 text-left transition-all hover:border-brand-300 hover:shadow-sm dark:border-ink-800 dark:bg-ink-800/50">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300"><PhoneCall size={15} /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">{f.type} · {f.name}</span>
                    <span className="num text-[11px] text-ink-400">{f.time} · {f.employee}</span></span>
                </button>
              ))}
              {data.agenda.followups.length + data.agenda.meetings.length === 0 && (
                <EmptyState icon={<CheckCircle2 size={24} />} title="Nothing scheduled today" body="Enjoy the calm — or get ahead on tomorrow's follow-ups." />
              )}
            </div>
          </div>
        </Reveal>

        <Reveal delay={240}>
          <div className="card flex h-full flex-col p-4">
            <h3 className="hd text-[15px]">Hot Leads</h3>
            <p className="mb-2 text-[11.5px] text-ink-400">Highest scores first</p>
            <div className="flex-1 space-y-2 overflow-y-auto">
              {data.hot.map((l) => (
                <button key={l.id} onClick={() => nav(`/leads?open=${l.id}`)} className="group w-full rounded-md border border-ink-100 bg-white/50 p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-ink-800 dark:bg-ink-800/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12.5px] font-semibold text-ink-800 group-hover:text-brand-700 dark:text-ink-100 dark:group-hover:text-brand-300">{l.businessName}</span>
                    <span className="num shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10.5px] font-bold text-red-600 dark:bg-red-900/30 dark:text-red-300">{l.score ?? "—"}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-400">
                    <span className="truncate">{l.city} · {l.industry}</span>
                    <span className="font-medium text-brand-600">{l.recommendedAction}</span>
                  </div>
                </button>
              ))}
              {data.hot.length === 0 && <EmptyState title="No hot leads right now" body="Score or import leads to heat up the funnel." />}
            </div>
          </div>
        </Reveal>
      </div>

      <Reveal delay={100}>
        <div className="card mt-4 p-4">
          <h3 className="hd text-[15px]">Activity Thread</h3>
          <p className="mb-2 text-[11.5px] text-ink-400">Latest actions across the CRM</p>
          <div className="grid gap-x-6 md:grid-cols-2">
            {data.activity.map((a, i) => (
              <div key={`${a.id}-${i}`} className="flex gap-2.5 border-l-2 border-ink-100 py-1.5 pl-3 transition-colors hover:border-brand-400 dark:border-ink-800">
                <div className="min-w-0">
                  <div className="text-[12.5px] leading-snug text-ink-700 dark:text-ink-200"><span className="font-semibold">{a.user}</span> · {a.action}</div>
                  {a.detail && <div className="truncate text-[11px] text-ink-400">{a.detail}</div>}
                  <div className="num text-[10px] text-ink-400">{timeAgo(a.at)} · {fmtD(a.at)}</div>
                </div>
              </div>
            ))}
          </div>
          {data.activity.length === 0 && <EmptyState title="No activity yet" />}
        </div>
      </Reveal>
    </div>
  );
}
