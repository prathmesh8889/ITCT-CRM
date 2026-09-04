/**
 * Leads — PRODUCTION path talks to the Node.js/PostgreSQL backend
 * (server-side pagination, filters, sorting, dedupe, AI scoring, assignment,
 * conversion, CSV import/export). DEMO MODE uses the embedded workspace.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Plus, Search, Upload, Download, SlidersHorizontal, ChevronUp, ChevronDown, Phone, MessageCircle,
  Mail, Sparkles, UserPlus, ArrowRightLeft, Pencil, Trash2, X, Check, AlertTriangle, PhoneCall,
} from "lucide-react";
import { useStore } from "../store";
import { getDB, useDB } from "../lib/db";
import { DEMO_MODE, leadApi, followUpApi, callApi } from "../lib/api";
import { fromApiLead, toApiLeadCreate, toApiLeadUpdate } from "../lib/mappers";
import type { ApiLead, Paged } from "../lib/apiTypes";
import {
  ruleQualify, waLink, telLink, renderTemplate, toCSV, downloadFile, parseCSV,
  fmtD, todayISO, addDaysISO, inr,
} from "../lib/services";
import { createLead as demoCreate, updateLead as demoUpdate, assignLeadTo as demoAssign,
         convertLead as demoConvert, importLeads as demoImport, findDuplicates as demoDups } from "../lib/services";
import type { Lead } from "../lib/types";
import { Btn, Badge, Modal, Drawer, Field, Input, Select, Textarea, Tabs, EmptyState,
         Avatar, Pagination, Menu, MenuItem, TempBadge, Money, statusTone, Toggle } from "../components/ui";

const PAGE = 10;
const CATS = ["Digital Marketing Agency", "Software Company", "Manufacturing", "Interior Design",
  "Restaurant & Café", "Healthcare Clinic", "Fitness & Gym", "Education Institute", "Real Estate",
  "E-commerce Store", "CA & Accounting Firm", "Logistics & Transport", "Cyber Security Services", "General"];
const SORTABLE: [keyof Lead, string, string][] = [
  ["businessName", "business_name", "Business"], ["city", "city", "City"], ["status", "status", "Status"],
  ["score", "score", "Score"], ["estimatedValue", "estimated_value", "Est. Value"], ["createdAt", "created_at", "Created"],
];

const emptyForm = (): Partial<Lead> => ({ businessName: "", contactPerson: "", phone: "", email: "",
  website: "", category: "General", industry: "", city: "", state: "", source: "Manual Entry",
  priority: "Medium", estimatedValue: 25000, notes: "", status: "" });

function LeadForm({ initial, onDone, editing, onSaved }: { initial: Partial<Lead>; onDone: () => void; editing: boolean; onSaved: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Lead, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.businessName?.trim()) { toast("Business name is required", "err"); return; }
    setBusy(true);
    try {
      if (DEMO_MODE) {
        if (editing && f.id) demoUpdate(f.id, f, user?.id || "u_admin"); else demoCreate(f, user?.id || "u_admin");
        toast(editing ? "Lead updated" : "Lead created", "ok", f.businessName);
      } else if (editing && f.id) {
        await leadApi.update(Number(f.id), toApiLeadUpdate(f));
        toast("Lead updated", "ok", f.businessName);
      } else {
        await leadApi.create(toApiLeadCreate(f));
        toast("Lead created", "ok", `${f.businessName} — saved to PostgreSQL`);
      }
      onSaved(); onDone();
    } catch (e) { toast(e instanceof Error ? e.message : "Save failed", "err"); }
    setBusy(false);
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Business name" req><Input value={f.businessName || ""} onChange={(e) => set("businessName", e.target.value)} /></Field>
      <Field label="Contact person"><Input value={f.contactPerson || ""} onChange={(e) => set("contactPerson", e.target.value)} /></Field>
      <Field label="Phone"><Input value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} placeholder="+91 …" /></Field>
      <Field label="Email"><Input value={f.email || ""} onChange={(e) => set("email", e.target.value)} /></Field>
      <Field label="Website"><Input value={f.website || ""} onChange={(e) => set("website", e.target.value)} /></Field>
      <Field label="WhatsApp"><Input value={f.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
      <Field label="Category"><Select value={f.category || "General"} onChange={(e) => set("category", e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Industry"><Input value={f.industry || ""} onChange={(e) => set("industry", e.target.value)} /></Field>
      <Field label="City"><Input value={f.city || ""} onChange={(e) => set("city", e.target.value)} /></Field>
      <Field label="State"><Input value={f.state || ""} onChange={(e) => set("state", e.target.value)} /></Field>
      <Field label="Source"><Select value={f.source || "Manual Entry"} onChange={(e) => set("source", e.target.value)}>{d.leadSources.map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Priority"><Select value={f.priority || "Medium"} onChange={(e) => set("priority", e.target.value)}>{["Low", "Medium", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
      <Field label="Estimated value (₹)"><Input type="number" value={f.estimatedValue ?? 0} onChange={(e) => set("estimatedValue", Number(e.target.value))} /></Field>
      {editing && <Field label="Status"><Select value={f.status || ""} onChange={(e) => set("status", e.target.value)}>{d.leadStatuses.map((s) => <option key={s}>{s}</option>)}</Select></Field>}
      <Field label="Notes" className="col-span-2"><Textarea value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      <div className="col-span-2 flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn onClick={() => void save()} loading={busy}>{editing ? "Save changes" : "Create lead"}</Btn></div>
    </div>
  );
}

function AssignModal({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [uid, setUid] = useState(lead.assigneeId || "");
  const [strategy, setStrategy] = useState("");
  const sales = d.users.filter((u) => u.isSales && u.active);
  const save = async () => {
    try {
      if (DEMO_MODE) { demoAssign(lead.id, uid || null, user?.id || "u_admin"); toast("Lead assigned"); }
      else if (strategy) { await leadApi.assign(Number(lead.id), { strategy }); toast(`Assigned via ${strategy.replace(/_/g, " ")}`); }
      else if (uid) { await leadApi.assign(Number(lead.id), { user_id: Number(uid) }); toast("Lead assigned"); }
      else { toast("Pick an owner or a strategy", "err"); return; }
      onSaved(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Assign failed", "err"); }
  };
  return (
    <div className="space-y-3">
      <Field label="Sales executive"><Select value={uid} onChange={(e) => { setUid(e.target.value); setStrategy(""); }}><option value="">—</option>{sales.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-ink-400"><span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" />or strategy<span className="h-px flex-1 bg-ink-200 dark:bg-ink-700" /></div>
      <Select value={strategy} onChange={(e) => { setStrategy(e.target.value); setUid(""); }}>
        <option value="">Manual (choose above)</option>
        <option value="round_robin">Round robin — rotates fairly</option>
        <option value="least_leads">Least open leads</option>
        <option value="least_workload">Least active workload</option>
        <option value="location">Location based</option>
        <option value="category">Category based</option>
        <option value="priority">Priority / high value</option>
        <option value="team">Team based</option>
      </Select>
      <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={() => void save()}><UserPlus size={14} /> Assign</Btn></div>
    </div>
  );
}

function ConvertModal({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const { user, toast } = useStore();
  const [opts, setOpts] = useState({ customer: true, company: false, contact: false, deal: true });
  const save = async () => {
    try {
      if (DEMO_MODE) {
        demoConvert(lead.id, { ...opts, dealValue: lead.estimatedValue, dealTitle: `${lead.businessName} — opportunity`, managerId: lead.assigneeId }, user?.id || "u_admin");
        toast("Lead converted", "ok", "Customer + deal created");
      }
      else {
        const r = await leadApi.convert(Number(lead.id), opts);
        toast("Lead converted", "ok", `Saved to PostgreSQL${r.data.customer_id ? ` · customer #${r.data.customer_id}` : ""}`);
      }
      onSaved(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Conversion failed", "err"); }
  };
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] text-ink-500">Choose what to create from <b className="text-ink-800 dark:text-ink-100">{lead.businessName}</b>. The lead's history is preserved.</p>
      {([["customer", "Customer", "Billing-ready account with GST/PAN fields"], ["company", "Company", "Organisation record, reusable across contacts"],
         ["contact", "Contact", "Person card linked to the company"], ["deal", "Deal", "Pipeline opportunity with the estimated value"]] as const)
        .map(([k, l, s]) => (
          <button key={k} onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}
            className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-all ${opts[k] ? "border-brand-400 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-900/20" : "border-ink-200 dark:border-ink-700"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded border ${opts[k] ? "border-brand-500 bg-brand-600 text-white" : "border-ink-300"}`}>{opts[k] && <Check size={12} />}</span>
            <span><span className="block text-[13px] font-semibold text-ink-800 dark:text-ink-100">{l}</span><span className="block text-[11.5px] text-ink-400">{s}</span></span>
          </button>
        ))}
      <div className="flex justify-end gap-2 pt-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={() => void save()}><ArrowRightLeft size={14} /> Convert</Btn></div>
    </div>
  );
}

function QuickFollowUp({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [type, setType] = useState("Call");
  const [date, setDate] = useState(addDaysISO(1));
  const [time, setTime] = useState("10:30");
  const save = async () => {
    try {
      if (DEMO_MODE) {
        const { mutate } = await import("../lib/db");
        mutate((db) => { db.followups.unshift({ id: Math.random().toString(36).slice(2), entityType: "lead", entityId: lead.id, employeeId: lead.assigneeId || user?.id || "", type: type as Lead extends never ? never : "Call", date, time, reminder: true, status: "Scheduled", notes: "", outcome: "", createdAt: new Date().toISOString() } as never); });
        toast("Follow-up scheduled");
      } else {
        await followUpApi.create({ entity_type: "lead", lead_id: Number(lead.id), employee_id: Number(lead.assigneeId || user?.id), type, date, time });
        toast("Follow-up scheduled", "ok", `${type} · ${fmtD(date)} ${time}`);
      }
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : "Scheduling failed", "err"); }
  };
  return (
    <div className="grid grid-cols-3 gap-3">
      <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value)}>{["Call", "WhatsApp", "Email", "Demo", "Meeting"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      <div className="col-span-3 flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn onClick={() => void save()}><PhoneCall size={14} /> Schedule</Btn></div>
      <span className="hidden">{d.settings.company.name}</span>
    </div>
  );
}

function ImportWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { user, toast } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ total: number; imported: number; duplicates: number; failed: number; failed_rows?: { row: Record<string, string>; error: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const FIELDS = ["business_name", "contact_person", "email", "phone", "whatsapp", "website", "industry", "category", "city", "state", "source"];
  const guess = (h: string) => {
    const l = h.toLowerCase();
    if (/(business|company|name)/.test(l)) return "business_name";
    if (/contact|person/.test(l)) return "contact_person";
    if (/mail/.test(l)) return "email";
    if (/(phone|mobile|call)/.test(l)) return "phone";
    if (/whats/.test(l)) return "whatsapp";
    if (/web|site|url/.test(l)) return "website";
    if (/indust/.test(l)) return "industry";
    if (/categ/.test(l)) return "category";
    if (/city/.test(l)) return "city";
    if (/state/.test(l)) return "state";
    if (/source/.test(l)) return "source";
    return "";
  };
  const onFile = async (fl: File | null) => {
    setFile(fl); setResult(null);
    if (!fl) { setHeaders([]); setRows([]); return; }
    const text = await fl.text();
    const grid = parseCSV(text);
    const hd = grid[0] || [];
    const recs = grid.slice(1).map((r) => Object.fromEntries(hd.map((h, i) => [h, r[i] || ""])));
    setHeaders(hd);
    setRows(recs.slice(0, 5));
    setMapping(Object.fromEntries(hd.map((h: string) => [guess(h), h] as [string, string]).filter(([k]) => k)));
  };
  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      if (DEMO_MODE) {
        const text = await file.text();
        const grid = parseCSV(text);
        const hd = grid[0] || [];
        const recs = grid.slice(1).map((r) => Object.fromEntries(hd.map((h, i) => [h, r[i] || ""])));
        const mapped = recs.map((r) => Object.fromEntries(Object.entries(mapping).map(([field, col]) => [field, r[col] || ""])));
        const r = demoImport(mapped, user?.id || "u_admin");
        setResult({ total: r.total, imported: r.imported, duplicates: r.duplicates, failed: r.failed,
          failed_rows: r.failedRows.map((f) => ({ row: f.row as Record<string, string>, error: f.error })) });
      } else {
        const r = await leadApi.importCSV(file, mapping);
        setResult(r.data as never);
      }
      toast("Import finished", "ok", "Leads are now in the database");
      onSaved();
    } catch (e) { toast(e instanceof Error ? e.message : "Import failed", "err"); }
    setBusy(false);
  };
  const invert = Object.fromEntries(Object.entries(mapping).map(([k, v]) => [v, k]));
  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-ink-300 p-8 text-center transition-colors hover:border-brand-400 dark:border-ink-600">
        <Upload size={22} className="text-ink-400" />
        <span className="text-[13px] font-semibold text-ink-700 dark:text-ink-200">{file ? file.name : "Choose a CSV file"}</span>
        <span className="text-[11.5px] text-ink-400">Columns are mapped in the next step · duplicates are detected server-side</span>
        <input type="file" accept=".csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0] || null)} />
      </label>
      {headers.length > 0 && !result && (
        <>
          <div>
            <span className="lbl">Map CSV columns → CRM fields</span>
            <div className="grid grid-cols-2 gap-2">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-2 rounded-md border border-ink-200 px-2 py-1.5 dark:border-ink-700">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{h}</span>
                  <Select className="!w-36 !py-1 text-[11.5px]" value={invert[h] || ""} onChange={(e) => setMapping((m) => { const n = { ...m }; for (const k of Object.keys(n)) if (n[k] === h) delete n[k]; if (e.target.value) n[e.target.value] = h; return n; })}>
                    <option value="">skip</option>
                    {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          </div>
          <div>
            <span className="lbl">Preview (first {rows.length} rows)</span>
            <div className="overflow-x-auto rounded-md border border-ink-200 dark:border-ink-700">
              <table className="w-full"><thead className="bg-ink-100/70 dark:bg-ink-800"><tr>{headers.map((h) => <th key={h} className="th">{invert[h] || h}</th>)}</tr></thead>
                <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-ink-100 dark:border-ink-800">{headers.map((h) => <td key={h} className="td max-w-[160px] truncate">{r[h]}</td>)}</tr>)}</tbody></table>
            </div>
          </div>
          <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={() => void run()} loading={busy} disabled={!mapping.business_name}><Upload size={14} /> Import</Btn></div>
        </>
      )}
      {result && (
        <div className="a-fade-up space-y-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            {([["Total", result.total, "text-ink-800 dark:text-ink-100"], ["Imported", result.imported, "text-emerald-600"],
               ["Duplicates", result.duplicates, "text-amber-600"], ["Failed", result.failed, "text-red-600"]] as const)
              .map(([l, v, c]) => <div key={l} className="card p-3"><div className={`num text-xl font-bold ${c}`}>{v}</div><div className="text-[10.5px] font-bold uppercase tracking-wider text-ink-400">{l}</div></div>)}
          </div>
          {result.failed_rows && result.failed_rows.length > 0 && (
            <Btn variant="outline" size="sm" onClick={() => {
              const fr = result.failed_rows!;
              const hs = [...Object.keys(fr[0].row), "error"];
              downloadFile("failed-rows.csv", toCSV(hs, fr.map((f) => [...hs.slice(0, -1).map((h) => f.row[h] || ""), f.error])));
            }}><Download size={13} /> Download failed rows</Btn>
          )}
          <div className="flex justify-end"><Btn onClick={onClose}>Done</Btn></div>
        </div>
      )}
    </div>
  );
}

function DuplicatesPanel({ onResolve }: { onResolve: () => void }) {
  const { toast } = useStore();
  const [groups, setGroups] = useState<{ keep: Lead; duplicates: Lead[] }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        if (DEMO_MODE) {
          const d = getDB();
          const seen = new Set<string>(); const gs: { keep: Lead; duplicates: Lead[] }[] = [];
          for (const l of d.leads.filter((x) => !["Won", "Lost"].includes(x.status))) {
            if (seen.has(l.id)) continue;
            const ms = demoDups(d, l).filter((m) => m.id !== l.id && !seen.has(m.id));
            if (ms.length) { seen.add(l.id); ms.forEach((m) => seen.add(m.id)); gs.push({ keep: l, duplicates: ms }); }
          }
          setGroups(gs);
        } else {
          const r = await leadApi.duplicates();
          setGroups((r.data.groups || []).map((g: { keep: ApiLead; duplicates: ApiLead[] }) => ({ keep: fromApiLead(g.keep), duplicates: g.duplicates.map(fromApiLead) })));
        }
      } catch { /* empty */ }
      setLoading(false);
    })();
  }, []);
  const remove = async (id: string) => {
    try {
      if (DEMO_MODE) { const { mutate } = await import("../lib/db"); mutate((db) => { db.leads = db.leads.filter((x) => x.id !== id); }); }
      else await leadApi.remove(Number(id));
      setGroups((gs) => gs.map((g) => ({ ...g, duplicates: g.duplicates.filter((x) => x.id !== id) })).filter((g) => g.duplicates.length));
      toast("Duplicate removed", "warn"); onResolve();
    } catch (e) { toast(e instanceof Error ? e.message : "Delete failed", "err"); }
  };
  if (loading) return <div className="skeleton h-40" />;
  if (!groups.length) return <EmptyState icon={<Check size={24} />} title="No duplicates detected" body="Phone, email, domain and company+city matches are checked on every save and import." />;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.keep.id} className="card p-4">
          <div className="mb-2 flex items-center gap-2"><Badge tone="teal">keep</Badge><span className="text-[13.5px] font-semibold">{g.keep.businessName}</span><span className="num text-[11px] text-ink-400">{g.keep.phone || g.keep.email || g.keep.city}</span></div>
          {g.duplicates.map((dp) => (
            <div key={dp.id} className="mb-1.5 flex items-center justify-between rounded-md border border-amber-200/70 bg-amber-50/50 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-900/15">
              <span className="flex items-center gap-2 text-[12.5px]"><AlertTriangle size={13} className="text-amber-500" /><b>{dp.businessName}</b><span className="num text-[11px] text-ink-400">{dp.phone || dp.email}</span></span>
              <Btn size="xs" variant="ghost" onClick={() => void remove(dp.id)}><Trash2 size={12} /> remove</Btn>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function LeadDrawer({ lead, onClose, onChanged }: { lead: Lead; onClose: () => void; onChanged: () => void }) {
  const { user, toast, can } = useStore();
  const d = useDB();
  const [modal, setModal] = useState<"" | "edit" | "assign" | "convert" | "followup" | "call">("");
  const [note, setNote] = useState("");
  const [busyScore, setBusyScore] = useState(false);
  const assignee = d.users.find((u) => u.id === lead.assigneeId);
  const tpl = (name: string, channel: "whatsapp" | "email") => d.templates.find((t) => t.channel === channel && t.name === name);
  const vars = { customer_name: lead.contactPerson || lead.businessName, lead_name: lead.businessName,
    employee_name: user?.name || "", company_name: d.settings.company.name };
  const score = async () => {
    setBusyScore(true);
    try {
      if (DEMO_MODE) { const r = ruleQualify(getDB(), lead); const { mutate } = await import("../lib/db"); mutate((db) => { const l = db.leads.find((x) => x.id === lead.id); if (l) Object.assign(l, { score: r.score, temperature: r.temperature, intent: r.intent, recommendedAction: r.action, aiReason: r.reason, scoredBy: "rules" }); }); toast("Lead scored (rules engine)", "ok", `Score ${r.score}/100`); }
      else {
        const r = await leadApi.score(Number(lead.id));
        toast(`Lead scored by ${r.data.model === "rules-engine" ? "rules engine" : "AI"}`, "ok", `Score ${r.data.score}/100 · ${r.data.temperature}`);
      }
      onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : "Scoring failed", "err"); }
    setBusyScore(false);
  };
  const addNote = async () => {
    if (!note.trim()) return;
    try {
      const body = `${note.trim()}`;
      if (DEMO_MODE) { const { mutate } = await import("../lib/db"); mutate((db) => { const l = db.leads.find((x) => x.id === lead.id); if (l) l.notes = l.notes ? `${l.notes}\n${body}` : body; }); }
      else await leadApi.update(Number(lead.id), { notes: lead.notes ? `${lead.notes}\n${body}` : body });
      setNote(""); toast("Note saved"); onChanged();
    } catch (e) { toast(e instanceof Error ? e.message : "Note failed", "err"); }
  };
  const del = async () => {
    if (!window.confirm(`Delete ${lead.businessName}? (soft delete — recoverable in the database)`)) return;
    try {
      if (DEMO_MODE) { const { mutate } = await import("../lib/db"); mutate((db) => { db.leads = db.leads.filter((x) => x.id !== lead.id); }); }
      else await leadApi.remove(Number(lead.id));
      toast("Lead deleted", "warn"); onChanged(); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : "Delete failed", "err"); }
  };
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-3 border-b border-ink-100 py-2 text-[13px] last:border-0 dark:border-ink-800"><span className="text-ink-400">{k}</span><span className="text-right font-medium text-ink-700 dark:text-ink-200">{v || "—"}</span></div>
  );
  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2">{lead.businessName}<Badge tone={statusTone(lead.status)}>{lead.status}</Badge></span>}
      headerExtra={can("leads", "edit") ? <Btn variant="ghost" size="sm" onClick={() => setModal("edit")}><Pencil size={13} /> Edit</Btn> : undefined}>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Score</div>
            <div className={`num text-xl font-bold ${lead.score == null ? "text-ink-300" : lead.score >= 75 ? "text-red-500" : lead.score >= 45 ? "text-amber-500" : "text-sky-500"}`}>{lead.score ?? "—"}</div>
            <TempBadge t={lead.temperature} /></div>
          <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Est. value</div><Money v={lead.estimatedValue} className="text-lg font-bold text-brand-700 dark:text-brand-300" /><div className="text-[10.5px] text-ink-400">{lead.intent ? `intent: ${lead.intent}` : ""}</div></div>
          <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Validation</div><Badge tone={statusTone(lead.validation)} className="mt-1.5">{lead.validation}</Badge><div className="num mt-1 text-[10px] text-ink-400">{lead.source}</div></div>
        </div>

        {lead.aiReason && <div className="rounded-md border border-brand-200/70 bg-brand-50/50 p-3 text-[12.5px] leading-relaxed text-brand-800 dark:border-brand-800 dark:bg-brand-900/20 dark:text-brand-200"><Sparkles size={13} className="mr-1 inline text-brand-500" />{lead.aiReason}{lead.recommendedAction ? <b> Recommended: {lead.recommendedAction}.</b> : null}</div>}

        <div className="flex flex-wrap gap-2">
          {lead.phone && <Btn variant="outline" size="sm" onClick={() => window.open(telLink(lead.phone))}><Phone size={13} /> Call</Btn>}
          {(lead.whatsapp || lead.phone) && <Btn variant="outline" size="sm" onClick={() => window.open(waLink(lead.whatsapp || lead.phone, renderTemplate(tpl("Introduction", "whatsapp")?.body || "Hello {{customer_name}}, greeting from {{company_name}}.", vars)), "_blank")}><MessageCircle size={13} /> WhatsApp</Btn>}
          {lead.email && <Btn variant="outline" size="sm" onClick={() => { const t = tpl("Introduction", "email"); window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(renderTemplate(t?.subject || "Introduction — {{company_name}}", vars))}&body=${encodeURIComponent(renderTemplate(t?.body || "", vars))}`; }}><Mail size={13} /> Email</Btn>}
          {can("leads", "edit") && <Btn variant="soft" size="sm" onClick={() => void score()} loading={busyScore}><Sparkles size={13} /> {DEMO_MODE ? "Score (rules)" : "AI qualify"}</Btn>}
          {can("followups", "create") && <Btn variant="soft" size="sm" onClick={() => setModal("followup")}><PhoneCall size={13} /> Follow-up</Btn>}
          {can("leads", "assign") && <Btn variant="soft" size="sm" onClick={() => setModal("assign")}><UserPlus size={13} /> Assign</Btn>}
          {can("leads", "edit") && !["Won", "Lost"].includes(lead.status) && <Btn variant="amber" size="sm" onClick={() => setModal("convert")}><ArrowRightLeft size={13} /> Convert</Btn>}
        </div>

        <div className="card p-4">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-ink-400">Details</div>
          <Row k="Contact" v={lead.contactPerson} /><Row k="Phone" v={lead.phone} /><Row k="Email" v={lead.email} />
          <Row k="Website" v={lead.website} /><Row k="Category" v={lead.category} /><Row k="Industry" v={lead.industry} />
          <Row k="Location" v={`${lead.city}${lead.state ? ", " + lead.state : ""}`} /><Row k="Owner" v={assignee ? <span className="flex items-center gap-1.5"><Avatar name={assignee.name} color={assignee.color} size={18} />{assignee.name}</span> : "Unassigned"} />
          <Row k="Next follow-up" v={lead.nextFollowUp ? fmtD(lead.nextFollowUp) : ""} /><Row k="Created" v={fmtD(lead.createdAt)} />
        </div>

        <div className="card p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-400">Notes</div>
          {lead.notes ? <pre className="mb-2 whitespace-pre-wrap rounded-md bg-ink-50 p-3 font-sans text-[12.5px] leading-relaxed text-ink-600 dark:bg-ink-800/60 dark:text-ink-300">{lead.notes}</pre> : <p className="mb-2 text-[12px] text-ink-400">No notes yet.</p>}
          {can("leads", "edit") && (
            <div className="flex gap-2"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" onKeyDown={(e) => { if (e.key === "Enter") void addNote(); }} /><Btn size="sm" onClick={() => void addNote()}>Save</Btn></div>
          )}
        </div>

        {can("leads", "delete") && <Btn variant="danger" size="sm" onClick={() => void del()}><Trash2 size={13} /> Delete lead</Btn>}
      </div>

      {modal === "edit" && <Modal open onClose={() => setModal("")} title="Edit lead" wide><LeadForm initial={lead} editing onDone={() => setModal("")} onSaved={onChanged} /></Modal>}
      {modal === "assign" && <Modal open onClose={() => setModal("")} title={`Assign — ${lead.businessName}`}><AssignModal lead={lead} onClose={() => setModal("")} onSaved={onChanged} /></Modal>}
      {modal === "convert" && <Modal open onClose={() => setModal("")} title="Convert lead"><ConvertModal lead={lead} onClose={() => setModal("")} onSaved={onChanged} /></Modal>}
      {modal === "followup" && <Modal open onClose={() => setModal("")} title="Schedule follow-up"><QuickFollowUp lead={lead} onDone={() => setModal("")} /></Modal>}
    </Drawer>
  );
}

export default function Leads() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("filter") === "hot" ? "hot" : "all");
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSource, setFSource] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fCity, setFCity] = useState("");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [rows, setRows] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState({ contact: true, phone: true, email: true, city: true, source: true, score: true, temp: true, value: true, owner: true, next: true });
  const [drawerId, setDrawerId] = useState<string | null>(params.get("open"));
  const [modal, setModal] = useState<"" | "create" | "import" | "assign" | "dups">(params.get("new") ? "create" : "");
  const isExec = user?.roleId === "r_sales" || (!DEMO_MODE && user && !["Super Admin", "Admin", "Sales Manager"].includes((user as { roleName?: string }).roleName || "") && false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (DEMO_MODE) {
        let list = [...getDB().leads];
        if (tab === "hot") list = list.filter((l) => l.temperature === "Hot" && !["Won", "Lost"].includes(l.status));
        else if (tab !== "all") list = list.filter((l) => l.status === tab);
        if (q) { const s = q.toLowerCase(); list = list.filter((l) => [l.businessName, l.contactPerson, l.email, l.phone, l.city].some((v) => v.toLowerCase().includes(s))); }
        if (fStatus) list = list.filter((l) => l.status === fStatus);
        if (fSource) list = list.filter((l) => l.source === fSource);
        if (fPriority) list = list.filter((l) => l.priority === fPriority);
        if (fOwner) list = list.filter((l) => l.assigneeId === fOwner);
        if (fCity) list = list.filter((l) => l.city.toLowerCase().includes(fCity.toLowerCase()));
        const key = SORTABLE.find((s) => s[1] === sortBy)?.[0] || "createdAt";
        list.sort((a, b) => { const av = a[key] as never, bv = b[key] as never; return (av > bv ? 1 : av < bv ? -1 : 0) * (sortOrder === "desc" ? -1 : 1); });
        setTotal(list.length);
        setRows(list.slice((page - 1) * PAGE, page * PAGE));
      } else {
        const r = await leadApi.list({ page, page_size: PAGE, search: q || undefined,
          status: tab !== "all" && tab !== "hot" ? tab : fStatus || undefined, source: fSource || undefined,
          priority: fPriority || undefined, owner: fOwner || undefined, city: fCity || undefined,
          sort_by: sortBy, sort_order: sortOrder });
        const p = r.data as Paged<ApiLead>;
        let items = p.items.map(fromApiLead);
        if (tab === "hot") items = items.filter((l) => l.temperature === "Hot");
        setTotal(tab === "hot" ? items.length : p.total);
        setRows(items);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load leads."); setRows([]); }
    setLoading(false);
  }, [tab, q, fStatus, fSource, fPriority, fOwner, fCity, page, sortBy, sortOrder]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const open = params.get("open");
    if (open) setDrawerId(open);
    if (params.get("new")) setModal("create");
  }, [params]);

  const exportCSV = async () => {
    try {
      if (DEMO_MODE) {
        const hs = ["business", "contact", "email", "phone", "city", "status", "score"];
        downloadFile(`leads-${todayISO()}.csv`, toCSV(hs, rows.map((l) => [l.businessName, l.contactPerson, l.email, l.phone, l.city, l.status, l.score ?? ""])));
        toast("CSV exported");
      }
      else {
        const r = await leadApi.exportCSV();
        downloadFile(`leads-${todayISO()}.csv`, r.data as unknown as string);
        toast("CSV exported", "ok", "Generated by the backend from PostgreSQL");
      }
    } catch (e) { toast(e instanceof Error ? e.message : "Export failed", "err"); }
  };
  const bulkAssign = async (uid2: string) => {
    try {
      for (const id of sel) { if (DEMO_MODE) demoAssign(id, uid2 || null, user?.id || "u_admin"); else await leadApi.assign(Number(id), { user_id: Number(uid2) }); }
      toast(`${sel.size} lead(s) assigned`); setSel(new Set()); void load();
    } catch (e) { toast(e instanceof Error ? e.message : "Bulk assign failed", "err"); }
  };
  const drawerLead = drawerId ? (DEMO_MODE ? d.leads.find((l) => l.id === drawerId) : rows.find((l) => l.id === drawerId)) : null;
  const tabs = useMemo(() => [
    { key: "all", label: "All" }, { key: "hot", label: "Hot" },
    ...d.leadStatuses.filter((s) => !["Follow-up"].includes(s) || true).map((s) => ({ key: s, label: s })),
  ], [d.leadStatuses]);
  void isExec;

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="hd text-[22px]">Leads</h1>
          <p className="text-[12.5px] text-ink-500">{total} record(s) · {DEMO_MODE ? "demo workspace" : "live from PostgreSQL"}{loading ? " · loading…" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="outline" size="sm" onClick={() => setModal("dups")}><AlertTriangle size={13} /> Duplicates</Btn>
          {can("leads", "export") && <Btn variant="outline" size="sm" onClick={() => void exportCSV()}><Download size={13} /> Export</Btn>}
          {can("leads", "create") && <Btn variant="outline" size="sm" onClick={() => setModal("import")}><Upload size={13} /> Import CSV</Btn>}
          {can("leads", "create") && <Btn size="sm" onClick={() => setModal("create")}><Plus size={14} /> Add lead</Btn>}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Tabs tabs={tabs} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
        <div className="relative ml-auto w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input className="pl-8" placeholder="Search leads…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Menu trigger={<Btn variant="outline" size="sm"><SlidersHorizontal size={13} /> Columns</Btn>}>
          {(Object.keys(cols) as (keyof typeof cols)[]).map((k) => (
            <MenuItem key={k} onClick={() => setCols((c) => ({ ...c, [k]: !c[k] }))}>
              <span className={`flex h-4 w-4 items-center justify-center rounded border ${cols[k] ? "border-brand-500 bg-brand-600 text-white" : "border-ink-300"}`}>{cols[k] && <Check size={11} />}</span>
              {k === "temp" ? "Temperature" : k === "next" ? "Next follow-up" : k[0].toUpperCase() + k.slice(1)}
            </MenuItem>
          ))}
        </Menu>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="!w-auto" value={fStatus} onChange={(e) => { setFStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{d.leadStatuses.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select className="!w-auto" value={fSource} onChange={(e) => { setFSource(e.target.value); setPage(1); }}><option value="">All sources</option>{d.leadSources.map((s) => <option key={s}>{s}</option>)}</Select>
        <Select className="!w-auto" value={fPriority} onChange={(e) => { setFPriority(e.target.value); setPage(1); }}><option value="">All priorities</option>{["Low", "Medium", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}</Select>
        {!DEMO_MODE || user?.roleId !== "r_sales" ? (
          <Select className="!w-auto" value={fOwner} onChange={(e) => { setFOwner(e.target.value); setPage(1); }}><option value="">All owners</option>{d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        ) : null}
        <Input className="!w-36" placeholder="City…" value={fCity} onChange={(e) => { setFCity(e.target.value); setPage(1); }} />
        {(fStatus || fSource || fPriority || fOwner || fCity) && <Btn variant="ghost" size="sm" onClick={() => { setFStatus(""); setFSource(""); setFPriority(""); setFOwner(""); setFCity(""); }}><X size={13} /> Clear</Btn>}
      </div>

      {sel.size > 0 && (
        <div className="a-fade-up mb-3 flex flex-wrap items-center gap-3 rounded-md border border-brand-300 bg-brand-50/60 px-3 py-2 dark:border-brand-800 dark:bg-brand-900/20">
          <span className="text-[12.5px] font-semibold text-brand-700 dark:text-brand-200">{sel.size} selected</span>
          {can("leads", "assign") && (
            <Select className="!w-auto" defaultValue="" onChange={(e) => { if (e.target.value) { void bulkAssign(e.target.value); e.target.value = ""; } }}>
              <option value="" disabled>Bulk assign to…</option>{d.users.filter((u) => u.isSales && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
          <Btn variant="ghost" size="sm" onClick={() => setSel(new Set())}><X size={13} /> Clear selection</Btn>
        </div>
      )}

      {error ? (
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          <AlertTriangle size={26} className="text-red-500" />
          <div className="hd text-[15px]">Unable to load leads</div>
          <p className="max-w-md text-[12.5px] text-ink-500">{error}</p>
          <Btn size="sm" onClick={() => void load()}>Retry</Btn>
        </div>
      ) : loading && !rows.length ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-[52px]" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={<Search size={24} />} title="No leads found" body={q ? `Nothing matches "${q}".` : "Add a lead, import a CSV, or run a discovery job."}
          action={can("leads", "create") ? <Btn size="sm" onClick={() => setModal("create")}><Plus size={14} /> Add your first lead</Btn> : undefined} />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50">
                <tr>
                  <th className="th w-8"><input type="checkbox" className="accent-brand-600" checked={sel.size === rows.length && rows.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                  {SORTABLE.map(([uiKey, api, label]) => (
                    <th key={api} className="th cursor-pointer select-none hover:text-brand-600"
                      onClick={() => { if (sortBy === api) setSortOrder((o) => (o === "desc" ? "asc" : "desc")); else { setSortBy(api); setSortOrder("desc"); } setPage(1); }}
                      style={api === "business_name" && !cols.contact ? { display: "none" } : undefined}>
                      <span className="inline-flex items-center gap-1">{label}{sortBy === api && (sortOrder === "desc" ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}</span>
                    </th>
                  ))}
                  {cols.phone && <th className="th">Phone</th>}
                  {cols.email && <th className="th">Email</th>}
                  {cols.source && <th className="th">Source</th>}
                  {cols.temp && <th className="th">Temp</th>}
                  {cols.owner && <th className="th">Owner</th>}
                  {cols.next && <th className="th">Next F/U</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const owner = d.users.find((u) => u.id === l.assigneeId);
                  return (
                    <tr key={l.id} className="cursor-pointer border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50"
                      onClick={() => { setDrawerId(l.id); setParams({ open: l.id }); }}>
                      <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="accent-brand-600" checked={sel.has(l.id)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(l.id); else n.delete(l.id); return n; })} /></td>
                      <td className="td"><div className="font-semibold text-ink-900 dark:text-ink-50">{l.businessName}</div>{cols.contact && <div className="text-[11px] text-ink-400">{l.contactPerson}</div>}</td>
                      <td className="td">{l.city || "—"}{l.state ? <span className="text-[11px] text-ink-400">, {l.state}</span> : null}</td>
                      <td className="td"><Badge tone={statusTone(l.status)}>{l.status}</Badge></td>
                      <td className="td num">{l.score ?? "—"}</td>
                      <td className="td"><Money v={l.estimatedValue} /></td>
                      <td className="td num text-[12px] text-ink-500">{fmtD(l.createdAt)}</td>
                      {cols.phone && <td className="td num text-[12px]">{l.phone || "—"}</td>}
                      {cols.email && <td className="td text-[12px]">{l.email || "—"}</td>}
                      {cols.source && <td className="td text-[12px] text-ink-400">{l.source}</td>}
                      {cols.temp && <td className="td"><TempBadge t={l.temperature} /></td>}
                      {cols.owner && <td className="td">{owner ? <span className="flex items-center gap-1.5"><Avatar name={owner.name} color={owner.color} size={20} /><span className="text-[12px]">{owner.name.split(" ")[0]}</span></span> : <span className="text-[12px] text-ink-300">—</span>}</td>}
                      {cols.next && <td className={`td num text-[12px] ${l.nextFollowUp && l.nextFollowUp < todayISO() ? "font-bold text-red-500" : "text-ink-400"}`}>{l.nextFollowUp ? fmtD(l.nextFollowUp) : "—"}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-3 pb-3"><Pagination page={page} pages={Math.ceil(total / PAGE)} onPage={setPage} total={total} shown={rows.length} /></div>
        </div>
      )}

      {modal === "create" && <Modal open onClose={() => { setModal(""); setParams({}); }} title="Add lead" wide><LeadForm initial={emptyForm()} editing={false} onDone={() => { setModal(""); setParams({}); }} onSaved={() => void load()} /></Modal>}
      {modal === "import" && <Modal open onClose={() => setModal("")} title="Import leads from CSV" wide><ImportWizard onClose={() => setModal("")} onSaved={() => void load()} /></Modal>}
      {modal === "dups" && <Modal open onClose={() => setModal("")} title="Duplicate review" wide><DuplicatesPanel onResolve={() => void load()} /></Modal>}
      {drawerLead && <LeadDrawer lead={drawerLead} onClose={() => { setDrawerId(null); setParams({}); }} onChanged={() => void load()} />}
      <span className="hidden">{inr(0)}{user?.id}</span>
    </div>
  );
}

export { ruleQualify };
