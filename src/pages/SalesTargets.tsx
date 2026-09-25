import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pencil, Plus, Target, Trash2, Trophy, UserRoundCheck } from "lucide-react";
import { salesTargetApi } from "../lib/api";
import { Badge, Btn, EmptyState, Field, Input, Modal, Money, Progress, Select, Textarea } from "../components/ui";

type EligibleUser = {
  id: number; name: string; email: string; designation?: string; department?: string;
  team_id?: number | null; access_level?: number | null;
};

type SalesTarget = {
  id: number; user_id: number; user_name: string; user_email: string; designation: string;
  start_date: string; end_date: string; revenue_target: number; deals_target: number; leads_target: number;
  notes: string; assigned_by?: number | null; assigned_by_name: string; active: boolean;
  achieved_revenue: number; won_deals: number; assigned_leads: number; converted_leads: number;
  revenue_percent: number; deals_percent: number; leads_percent: number;
};

type Payload = {
  items: SalesTarget[]; can_manage: boolean; scope: "self" | "managed";
  eligible_users: EligibleUser[]; current_user_id: number;
};

const localISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const monthRange = () => {
  const n = new Date();
  return {
    start_date: localISO(new Date(n.getFullYear(), n.getMonth(), 1)),
    end_date: localISO(new Date(n.getFullYear(), n.getMonth() + 1, 0)),
  };
};

const emptyForm = () => ({
  user_id: "",
  ...monthRange(),
  revenue_target: 0,
  deals_target: 0,
  leads_target: 0,
  notes: "",
});

const pctTone = (v: number): "teal" | "amber" | "red" => v >= 100 ? "teal" : v >= 60 ? "amber" : "red";

export default function SalesTargets() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState<SalesTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  const load = async () => {
    setLoading(true); setError("");
    try {
      const r = await salesTargetApi.list();
      setData(r.data as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sales targets");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const current = useMemo(() => {
    if (!data) return [];
    const today = localISO(new Date());
    return data.items.filter((t) => t.active && t.start_date <= today && t.end_date >= today);
  }, [data]);

  const openNew = () => {
    const next = emptyForm();
    if (data?.eligible_users?.length === 1) next.user_id = String(data.eligible_users[0].id);
    setEdit(null); setForm(next); setModal(true);
  };

  const openEdit = (t: SalesTarget) => {
    setEdit(t);
    setForm({
      user_id: String(t.user_id), start_date: t.start_date, end_date: t.end_date,
      revenue_target: t.revenue_target, deals_target: t.deals_target, leads_target: t.leads_target,
      notes: t.notes || "",
    });
    setModal(true);
  };

  const save = async () => {
    if (!edit && !form.user_id) { setError("Select a salesperson"); return; }
    if (!form.start_date || !form.end_date) { setError("Target period is required"); return; }
    setSaving(true); setError("");
    try {
      const body = {
        user_id: Number(form.user_id),
        start_date: form.start_date,
        end_date: form.end_date,
        revenue_target: Number(form.revenue_target) || 0,
        deals_target: Number(form.deals_target) || 0,
        leads_target: Number(form.leads_target) || 0,
        notes: form.notes,
      };
      if (edit) await salesTargetApi.update(edit.id, body);
      else await salesTargetApi.create(body);
      setModal(false); setEdit(null); setForm(emptyForm());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save target");
    } finally { setSaving(false); }
  };

  const remove = async (t: SalesTarget) => {
    if (!window.confirm(`Remove target for ${t.user_name} (${t.start_date} to ${t.end_date})?`)) return;
    try {
      await salesTargetApi.remove(t.id);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not remove target"); }
  };

  if (loading) return <div className="p-6 text-[13px] text-ink-500">Loading sales targets…</div>;

  return (
    <div className="mx-auto max-w-[1180px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><Target size={20} className="text-brand-600" /><h1 className="hd text-[22px]">Sales Targets</h1></div>
          <p className="mt-1 text-[12.5px] text-ink-500">
            {data?.can_manage
              ? "Assign sales goals and track only the salespeople under your authority."
              : "Private view — only your manager-assigned target and your own sales performance are shown."}
          </p>
        </div>
        {data?.can_manage && <Btn size="sm" onClick={openNew}><Plus size={14} /> Assign target</Btn>}
      </div>

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {!data?.can_manage && current.length > 0 && (
        <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-900 dark:bg-brand-950/20">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-brand-700 dark:text-brand-300">
            <UserRoundCheck size={15} /> This is your private sales workspace. Other employees' targets, leads and company sales are not shown.
          </div>
        </div>
      )}

      {current.length > 0 && (
        <section className="mb-6">
          <div className="mb-2 flex items-center gap-2"><Trophy size={16} className="text-amber-500" /><h2 className="hd text-[15px]">{data?.can_manage ? "Current targets" : "My current target"}</h2></div>
          <div className="grid gap-3 lg:grid-cols-2">
            {current.map((t) => <TargetCard key={t.id} target={t} canManage={!!data?.can_manage} onEdit={openEdit} onRemove={remove} />)}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="hd text-[15px]">{data?.can_manage ? "Target history" : "My target history"}</h2>
          <Badge tone="slate">{data?.items.length || 0} records</Badge>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {data?.items.map((t) => <TargetCard key={t.id} target={t} canManage={!!data?.can_manage} onEdit={openEdit} onRemove={remove} compact />)}
        </div>
        {data?.items.length === 0 && (
          <EmptyState
            icon={<Target size={24} />}
            title={data.can_manage ? "No sales targets assigned yet" : "No target assigned yet"}
            body={data.can_manage ? "Assign a target to a salesperson to start tracking progress." : "Your Sales Manager, CEO or Director can assign your target here."}
            action={data.can_manage ? <Btn size="sm" onClick={openNew}><Plus size={13}/>Assign target</Btn> : undefined}
          />
        )}
      </section>

      {modal && data?.can_manage && (
        <Modal open onClose={() => setModal(false)} title={edit ? "Edit sales target" : "Assign sales target"} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Salesperson" req>
              <Select disabled={!!edit} value={form.user_id} onChange={(e) => setForm((p) => ({ ...p, user_id: e.target.value }))}>
                <option value="">Select salesperson…</option>
                {data.eligible_users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.designation ? ` · ${u.designation}` : ""}</option>)}
              </Select>
            </Field>
            <Field label="Revenue target (₹)"><Input type="number" min={0} value={form.revenue_target} onChange={(e) => setForm((p) => ({ ...p, revenue_target: Number(e.target.value) }))} /></Field>
            <Field label="Start date" req><Input type="date" value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} /></Field>
            <Field label="End date" req><Input type="date" value={form.end_date} onChange={(e) => setForm((p) => ({ ...p, end_date: e.target.value }))} /></Field>
            <Field label="Won deals target"><Input type="number" min={0} value={form.deals_target} onChange={(e) => setForm((p) => ({ ...p, deals_target: Number(e.target.value) }))} /></Field>
            <Field label="Leads allocation target"><Input type="number" min={0} value={form.leads_target} onChange={(e) => setForm((p) => ({ ...p, leads_target: Number(e.target.value) }))} /></Field>
            <Field label="Manager notes" className="sm:col-span-2"><Textarea rows={3} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Priority, focus market, expected package, follow-up instructions…" /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn>
            <Btn loading={saving} onClick={() => void save()}>{edit ? "Save target" : "Assign target"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TargetCard({ target: t, canManage, onEdit, onRemove, compact = false }: {
  target: SalesTarget; canManage: boolean; onEdit: (t: SalesTarget) => void; onRemove: (t: SalesTarget) => void; compact?: boolean;
}) {
  return (
    <div className={`card p-4 ${t.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="hd text-[14px]">{t.user_name}</div>
            <Badge tone={t.active ? "green" : "slate"}>{t.active ? "Active" : "Closed"}</Badge>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-400">{t.designation || "Sales"} · {t.start_date} → {t.end_date}</div>
          {t.assigned_by_name && <div className="mt-0.5 text-[10.5px] text-ink-400">Assigned by {t.assigned_by_name}</div>}
        </div>
        {canManage && (
          <div className="flex gap-1">
            <button className="rounded p-1.5 text-ink-400 hover:bg-ink-100 hover:text-brand-600 dark:hover:bg-ink-800" onClick={() => onEdit(t)} title="Edit target"><Pencil size={13}/></button>
            <button className="rounded p-1.5 text-ink-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30" onClick={() => onRemove(t)} title="Remove target"><Trash2 size={13}/></button>
          </div>
        )}
      </div>

      <div className={`mt-3 grid gap-3 ${compact ? "sm:grid-cols-3" : "sm:grid-cols-3"}`}>
        <Metric label="Revenue" achieved={<Money v={t.achieved_revenue} />} target={<Money v={t.revenue_target} />} pct={t.revenue_percent} />
        <Metric label="Won deals" achieved={t.won_deals} target={t.deals_target} pct={t.deals_percent} />
        <Metric label="Assigned leads" achieved={t.assigned_leads} target={t.leads_target} pct={t.leads_percent} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-ink-500">
        <span className="rounded bg-ink-50 px-2 py-1 dark:bg-ink-800">Converted leads: <b>{t.converted_leads}</b></span>
        {t.notes && <span className="rounded bg-ink-50 px-2 py-1 dark:bg-ink-800">Note: {t.notes}</span>}
      </div>
    </div>
  );
}

function Metric({ label, achieved, target, pct }: { label: string; achieved: ReactNode; target: ReactNode; pct: number }) {
  return (
    <div className="rounded-md bg-ink-50 p-3 dark:bg-ink-800/60">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-ink-400"><span>{label}</span><span>{pct}%</span></div>
      <div className="mt-1 text-[13px] font-bold">{achieved} <span className="text-[10.5px] font-normal text-ink-400">/ {target}</span></div>
      <div className="mt-2"><Progress value={Math.min(100, pct)} tone={pctTone(pct)} /></div>
    </div>
  );
}
