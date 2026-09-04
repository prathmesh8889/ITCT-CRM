import { useMemo, useState } from "react";
import { Download, BarChart3, Trophy, TrendingUp, Target, Percent, Wallet, Scale, PiggyBank } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line } from "recharts";
import { useStore } from "../store";
import { useDB } from "../lib/db";
import { dashMetrics, monthlyRevenue, docTotals, paidFor, perfOf, toCSV, downloadFile, fmtD, todayISO, inr } from "../lib/services";
import { Btn, Badge, Field, Input, Select, Tabs, Money, Reveal } from "../components/ui";
import type { DB } from "../lib/types";

interface Filters { from: string; to: string; employee: string; status: string; }
interface ReportDef { id: string; name: string; desc: string; cols: string[]; rows: (d: DB, f: Filters) => (string | number | null)[][]; }

const inRange = (iso: string, f: Filters) => (!f.from || iso.slice(0, 10) >= f.from) && (!f.to || iso.slice(0, 10) <= f.to);

const REPORTS: ReportDef[] = [
  { id: "leads", name: "Lead Report", desc: "All leads with score, status and owner", cols: ["Business", "City", "Category", "Source", "Status", "Score", "Temp", "Owner", "Value", "Created"],
    rows: (d, f) => d.leads.filter((l) => inRange(l.createdAt, f) && (!f.employee || l.assigneeId === f.employee) && (!f.status || l.status === f.status)).map((l) => [l.businessName, l.city, l.category, l.source, l.status, l.score, l.temperature, d.users.find((u) => u.id === l.assigneeId)?.name || "", l.estimatedValue, l.createdAt.slice(0, 10)]) },
  { id: "source", name: "Lead Source Report", desc: "Leads and conversions grouped by source", cols: ["Source", "Leads", "Converted", "Hot", "Conversion %"],
    rows: (d) => { const map = new Map<string, { n: number; c: number; h: number }>(); d.leads.forEach((l) => { const m = map.get(l.source) || { n: 0, c: 0, h: 0 }; m.n++; if (l.status === "Converted") m.c++; if (l.temperature === "Hot") m.h++; map.set(l.source, m); }); return [...map.entries()].map(([s, m]) => [s, m.n, m.c, m.h, m.n ? Math.round((m.c / m.n) * 100) : 0]); } },
  { id: "conversion", name: "Lead Conversion", desc: "Funnel across lead statuses", cols: ["Status", "Leads", "% of total"],
    rows: (d) => d.leadStatuses.map((s) => { const n = d.leads.filter((l) => l.status === s).length; return [s, n, d.leads.length ? Math.round((n / d.leads.length) * 100) : 0]; }) },
  { id: "score", name: "Lead Score Report", desc: "Score bands and recommended actions", cols: ["Band", "Leads", "Avg estimated value"],
    rows: (d) => [["0–39", d.leads.filter((l) => (l.score || 0) < 40), "cold"], ["40–69", d.leads.filter((l) => (l.score || 0) >= 40 && (l.score || 0) < 70), "warm"], ["70–100", d.leads.filter((l) => (l.score || 0) >= 70), "hot"]].map(([band, arr]) => { const a = arr as typeof d.leads; return [band as string, a.length, a.length ? Math.round(a.reduce((s, l) => s + l.estimatedValue, 0) / a.length) : 0]; }) },
  { id: "sales", name: "Sales Report", desc: "Won deals and collected revenue by month", cols: ["Month", "Invoiced", "Collected", "Deals won"],
    rows: (d) => monthlyRevenue(d).map((m) => [m.month, m.invoiced, m.revenue, 0]) },
  { id: "pipeline", name: "Pipeline Report", desc: "Open deals by stage", cols: ["Stage", "Deals", "Value", "Expected this month"],
    rows: (d) => d.dealStages.map((s) => { const deals = d.deals.filter((x) => x.stageId === s.id && s.kind === "open"); const now = new Date(); return [s.name, deals.length, deals.reduce((a, b) => a + b.value, 0), deals.filter((x) => new Date(x.expectedClose).getMonth() === now.getMonth()).length]; }) },
  { id: "followup", name: "Follow-up Report", desc: "Completed vs missed follow-ups by employee", cols: ["Employee", "Scheduled", "Completed", "Missed", "Completion %"],
    rows: (d) => d.users.filter((u) => u.isSales).map((u) => { const fus = d.followups.filter((f) => f.employeeId === u.id); const c = fus.filter((f) => f.status === "Completed").length; const m = fus.filter((f) => f.status === "Missed").length; return [u.name, fus.length, c, m, c + m ? Math.round((c / (c + m)) * 100) : 0]; }) },
  { id: "customers", name: "Customer Report", desc: "Customers with lifetime value and outstanding", cols: ["Company", "City", "Manager", "Status", "Lifetime value", "Outstanding"],
    rows: (d) => d.customers.map((c) => [c.company, c.city, d.users.find((u) => u.id === c.managerId)?.name || "", c.status, d.payments.filter((p) => p.customerId === c.id).reduce((a, b) => a + b.amount, 0), d.invoices.filter((i) => i.customerId === c.id && !["Cancelled", "Draft", "Paid"].includes(i.status)).reduce((a, i) => a + Math.max(0, docTotals(i.items, i.discountPct).total - paidFor(d, i.id)), 0)]) },
  { id: "quotes", name: "Quotation Report", desc: "Quotations by status with totals", cols: ["Number", "Customer", "Status", "Total", "Date"],
    rows: (d) => d.quotations.map((q) => [q.number, d.customers.find((c) => c.id === q.customerId)?.company || "", q.status, docTotals(q.items, q.discountPct).total, q.date]) },
  { id: "invoices", name: "Invoice Report", desc: "Invoices with paid and balance", cols: ["Number", "Customer", "Status", "Total", "Paid", "Balance", "Due"],
    rows: (d) => d.invoices.map((i) => { const t = docTotals(i.items, i.discountPct).total; const p = paidFor(d, i.id); return [i.number, d.customers.find((c) => c.id === i.customerId)?.company || "", i.status, t, p, Math.max(0, t - p), i.dueDate]; }) },
  { id: "payments", name: "Payment Report", desc: "All received payments", cols: ["Date", "Invoice", "Customer", "Mode", "Amount"],
    rows: (d, f) => d.payments.filter((p) => inRange(p.date, f)).map((p) => [p.date, d.invoices.find((i) => i.id === p.invoiceId)?.number || "", d.customers.find((c) => c.id === p.customerId)?.company || "", p.mode, p.amount]) },
  { id: "outstanding", name: "Outstanding Report", desc: "Unpaid balances by customer", cols: ["Customer", "Invoice", "Total", "Paid", "Balance", "Due date", "Days overdue"],
    rows: (d) => d.invoices.filter((i) => !["Cancelled", "Draft", "Paid"].includes(i.status)).map((i) => { const t = docTotals(i.items, i.discountPct).total; const p = paidFor(d, i.id); const days = Math.max(0, Math.floor((Date.now() - new Date(i.dueDate).getTime()) / 86400e3)); return [d.customers.find((c) => c.id === i.customerId)?.company || "", i.number, t, p, Math.max(0, t - p), i.dueDate, t - p > 0 ? days : 0]; }) },
  { id: "expenses", name: "Expense Report", desc: "Spend by category", cols: ["Category", "Count", "Total"],
    rows: (d) => { const map = new Map<string, { n: number; t: number }>(); d.expenses.forEach((x) => { const m = map.get(x.category) || { n: 0, t: 0 }; m.n++; m.t += x.amount; map.set(x.category, m); }); return [...map.entries()].map(([c, m]) => [c, m.n, m.t]); } },
];

export default function Reports() {
  const { user, can } = useStore();
  const d = useDB();
  const [tab, setTab] = useState("analytics");
  const [repId, setRepId] = useState("leads");
  const [filters, setFilters] = useState<Filters>({ from: "", to: "", employee: "", status: "" });
  const m = useMemo(() => dashMetrics(d), [d]);
  const revenue = useMemo(() => monthlyRevenue(d), [d]);
  const rep = REPORTS.find((r) => r.id === repId)!;
  const rows = useMemo(() => rep.rows(d, filters), [rep, d, filters]);
  const funnel = useMemo(() => d.dealStages.map((s) => ({ name: s.name, count: d.deals.filter((x) => x.stageId === s.id).length })), [d]);
  const scoreDist = useMemo(() => [
    { band: "0–39", n: d.leads.filter((l) => (l.score || 0) < 40).length },
    { band: "40–69", n: d.leads.filter((l) => (l.score || 0) >= 40 && (l.score || 0) < 70).length },
    { band: "70–100", n: d.leads.filter((l) => (l.score || 0) >= 70).length },
  ], [d.leads]);
  const perf = useMemo(() => d.users.filter((u) => u.isSales).map((u) => perfOf(d, u)).sort((a, b) => b.revenue - a.revenue), [d]);
  const tooltipStyle = { borderRadius: 8, border: "1px solid #dee1d7", fontSize: 12 } as const;

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Reports & Analytics</h1><p className="text-[12.5px] text-ink-500">Every figure below is computed live from the CRM database.</p></div>
        <Tabs tabs={[{ key: "analytics", label: "Analytics" }, { key: "reports", label: "Reports" }, { key: "performance", label: "Team Performance" }]} active={tab} onChange={setTab} />
      </div>

      {tab === "analytics" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {[{ l: "Conversion", v: `${m.conversionRate}%`, i: Percent, t: "converted / total leads" }, { l: "Win rate", v: `${m.winRate}%`, i: Trophy, t: "won / closed deals" }, { l: "Avg deal", v: inr(m.avgDeal), i: Target, t: "won revenue / wins" }, { l: "Pipeline", v: inr(m.pipelineValue), i: BarChart3, t: `${m.openDeals} open deals` }, { l: "Revenue", v: inr(m.revenue), i: Wallet, t: "payments received" }, { l: "Outstanding", v: inr(m.outstanding), i: Scale, t: "total − payments" }, { l: "Expenses", v: inr(m.expenses), i: PiggyBank, t: "recorded spend" }, { l: "Est. profit", v: inr(m.profit), i: TrendingUp, t: "revenue − expenses" }].map((c, i) => (
              <Reveal key={c.l} delay={i * 40}>
                <div className="card p-3.5">
                  <div className="flex items-center gap-2 text-ink-400"><c.i size={14} /><span className="text-[10px] font-bold uppercase tracking-wider">{c.l}</span></div>
                  <div className="num mt-1.5 text-[17px] font-bold text-ink-900 dark:text-ink-50">{c.v}</div>
                  <div className="text-[10px] text-ink-400">{c.t}</div>
                </div>
              </Reveal>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal><div className="card p-4">
              <h3 className="hd text-[15px]">Collections Trend</h3>
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={revenue}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dee1d7" vertical={false} opacity={0.5} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6e766a" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#6e766a" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `₹${Math.round(v / 1000)}k`} width={46} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number | string) => inr(Number(v))} />
                  <Line dataKey="revenue" stroke="#0F766E" strokeWidth={2.5} dot={{ r: 3.5 }} name="Collected" />
                  <Line dataKey="invoiced" stroke="#DB9B28" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Invoiced" />
                </LineChart>
              </ResponsiveContainer>
            </div></Reveal>
            <Reveal delay={80}><div className="card p-4">
              <h3 className="hd text-[15px]">Deals by Stage</h3>
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={funnel}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#dee1d7" vertical={false} opacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#6e766a" }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={52} />
                  <YAxis tick={{ fontSize: 10, fill: "#6e766a" }} axisLine={false} tickLine={false} allowDecimals={false} width={26} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="#24836D" radius={[4, 4, 0, 0]} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </div></Reveal>
          </div>
          <Reveal><div className="card p-4">
            <h3 className="hd text-[15px]">Lead Score Distribution</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {scoreDist.map((s, i) => {
                const max = Math.max(...scoreDist.map((x) => x.n), 1);
                const colors = ["#99A193", "#DB9B28", "#D64545"];
                return (
                  <div key={s.band}>
                    <div className="mb-1 flex justify-between text-[12px]"><span className="font-semibold text-ink-600 dark:text-ink-300">{s.band}</span><span className="num text-ink-400">{s.n} leads</span></div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800"><div className="a-bar h-full rounded-full" style={{ width: `${(s.n / max) * 100}%`, background: colors[i], animationDelay: `${i * 90}ms` }} /></div>
                  </div>
                );
              })}
            </div>
          </div></Reveal>
        </div>
      )}

      {tab === "reports" && (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <div className="card h-fit p-2">
            {REPORTS.map((r) => (
              <button key={r.id} onClick={() => setRepId(r.id)} className={`mb-0.5 block w-full rounded-md px-3 py-2 text-left transition-all ${repId === r.id ? "bg-brand-600 text-white shadow-sm" : "text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"}`}>
                <span className="block text-[12.5px] font-semibold">{r.name}</span>
                <span className={`block text-[10.5px] ${repId === r.id ? "text-white/70" : "text-ink-400"}`}>{r.desc}</span>
              </button>
            ))}
          </div>
          <div>
            <div className="card mb-3 flex flex-wrap items-end gap-3 p-3">
              <Field label="From"><Input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></Field>
              <Field label="To"><Input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></Field>
              <Field label="Employee"><Select value={filters.employee} onChange={(e) => setFilters((f) => ({ ...f, employee: e.target.value }))} className="!w-auto"><option value="">All</option>{d.users.filter((u) => u.isSales).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
              <Field label="Status"><Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="!w-auto"><option value="">All</option>{d.leadStatuses.map((s) => <option key={s}>{s}</option>)}</Select></Field>
              {can("reports", "export") && <Btn variant="outline" size="sm" className="mb-0.5" onClick={() => downloadFile(`${rep.id}-report-${todayISO()}.csv`, toCSV(rep.cols, rows))}><Download size={13} /> Export CSV</Btn>}
            </div>
            <div className="card overflow-hidden">
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 border-b border-ink-200/70 bg-ink-100/95 backdrop-blur dark:border-ink-700 dark:bg-ink-800/95"><tr>{rep.cols.map((c) => <th key={c} className="th">{c}</th>)}</tr></thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50">
                        {r.map((c, j) => <td key={j} className={`td ${typeof c === "number" ? "num" : ""}`}>{typeof c === "number" && (rep.cols[j] || "").toLowerCase().match(/value|total|paid|balance|amount|revenue|collected|invoiced|outstanding|expense|est/) ? inr(c) : String(c ?? "—")}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div className="p-8 text-center text-[13px] text-ink-400">No rows for these filters.</div>}
              </div>
              <div className="num border-t border-ink-100 px-3 py-2 text-[11px] text-ink-400 dark:border-ink-800">{rows.length} rows · generated {fmtD(new Date().toISOString())} by {user?.name}</div>
            </div>
          </div>
        </div>
      )}

      {tab === "performance" && (
        <div className="space-y-4">
          <Reveal><div className="card p-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="hd text-[15px]">Revenue by Employee</h3><Badge tone="teal">won-deal collections</Badge></div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perf.map((p) => ({ name: p.name.split(" ")[0], revenue: p.revenue, deals: p.dealsWon }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dee1d7" vertical={false} opacity={0.5} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6e766a" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#6e766a" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `₹${Math.round(v / 1000)}k`} width={46} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number | string, n: string) => n === "revenue" ? inr(Number(v)) : v} />
                <Bar dataKey="revenue" fill="#0F766E" radius={[4, 4, 0, 0]} maxBarSize={38} />
              </BarChart>
            </ResponsiveContainer>
          </div></Reveal>
          <Reveal delay={80}><div className="card overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full">
              <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">#</th><th className="th">Employee</th><th className="th">Leads</th><th className="th">Contacted</th><th className="th">Qualified</th><th className="th">Converted</th><th className="th">Conv %</th><th className="th">Deals W/L</th><th className="th">Revenue</th><th className="th">FU done</th><th className="th">FU missed</th><th className="th">Tasks done</th></tr></thead>
              <tbody>{perf.map((p, i) => (
                <tr key={p.id} className="border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50">
                  <td className="td num font-bold text-ink-400">{i + 1}</td>
                  <td className="td font-semibold text-ink-900 dark:text-ink-50"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.name}</span></td>
                  <td className="td num">{p.assigned}</td><td className="td num">{p.contacted}</td><td className="td num">{p.qualified}</td>
                  <td className="td num font-bold text-emerald-600">{p.converted}</td>
                  <td className="td"><Badge tone={p.rate >= 15 ? "green" : p.rate >= 8 ? "amber" : "slate"}>{p.rate}%</Badge></td>
                  <td className="td num">{p.dealsWon} / {p.dealsLost}</td>
                  <td className="td num font-bold text-brand-700 dark:text-brand-300">{inr(p.revenue)}</td>
                  <td className="td num">{p.fuCompleted}</td>
                  <td className={`td num ${p.fuOverdue ? "font-bold text-red-500" : ""}`}>{p.fuOverdue}</td>
                  <td className="td num">{p.tasksCompleted}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div></Reveal>
        </div>
      )}
      <div className="mt-3 hidden"><Money v={0} /></div>
    </div>
  );
}
