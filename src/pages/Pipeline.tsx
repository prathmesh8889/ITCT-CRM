/**
 * Sales Pipeline — Kanban backed by PostgreSQL.
 * Drag & drop calls PATCH /deals/:id/stage; on failure the card rolls back
 * to its previous stage and an error toast is shown.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, CalendarDays, AlertTriangle } from "lucide-react";
import { useStore } from "../store";
import { getDB, useDB, uid, mutate } from "../lib/db";
import { DEMO_MODE, dealApi } from "../lib/api";
import { fromApiDeal, fromApiStage, toApiDeal } from "../lib/mappers";
import type { ApiDeal, ApiDealStage } from "../lib/apiTypes";
import { fmtD, addDaysISO, todayISO, inr } from "../lib/services";
import type { Deal, DealStage, Priority } from "../lib/types";
import { Btn, Badge, Modal, Drawer, Field, Input, Select, Textarea, Avatar, Money, EmptyState, statusTone } from "../components/ui";

function DealModal({ initial, editing, onDone, onSaved }: { initial: Partial<Deal>; editing: boolean; onDone: () => void; onSaved: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [f, setF] = useState<Partial<Deal>>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Deal, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.title?.trim()) { toast("Deal title is required", "err"); return; }
    setBusy(true);
    try {
      if (DEMO_MODE) {
        if (editing && f.id) mutate((db) => { const x = db.deals.find((y) => y.id === f.id); if (x) Object.assign(x, f); });
        else mutate((db) => { db.deals.unshift({ id: uid(), title: f.title!, leadId: f.leadId, customerId: f.customerId, stageId: f.stageId || db.dealStages[0].id, value: f.value || 0, expectedClose: f.expectedClose || addDaysISO(21), ownerId: f.ownerId || user?.id || "", priority: (f.priority as Priority) || "Medium", notes: f.notes || "", createdAt: new Date().toISOString() }); });
        toast(editing ? "Deal updated" : "Deal created");
      } else if (editing && f.id) {
        await dealApi.update(Number(f.id), toApiDeal(f));
        toast("Deal updated", "ok", "Saved to PostgreSQL");
      } else {
        await dealApi.create({ name: f.title, customer_id: f.customerId ? Number(f.customerId) : null,
          lead_id: f.leadId ? Number(f.leadId) : null, stage_id: f.stageId ? Number(f.stageId) : undefined,
          value: f.value || 0, assigned_user_id: f.ownerId ? Number(f.ownerId) : undefined,
          expected_close_date: f.expectedClose || addDaysISO(21), product_service: f.notes || "" });
        toast("Deal created", "ok", "Saved to PostgreSQL");
      }
      onSaved(); onDone();
    } catch (e) { toast(e instanceof Error ? e.message : "Save failed", "err"); }
    setBusy(false);
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Deal title" req className="col-span-2"><Input value={f.title || ""} onChange={(e) => set("title", e.target.value)} placeholder="Website revamp — Acme" /></Field>
      <Field label="Customer"><Select value={f.customerId || ""} onChange={(e) => set("customerId", e.target.value || undefined)}><option value="">—</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}</Select></Field>
      <Field label="From lead"><Select value={f.leadId || ""} onChange={(e) => set("leadId", e.target.value || undefined)}><option value="">—</option>{d.leads.filter((l) => !["Won", "Lost"].includes(l.status)).map((l) => <option key={l.id} value={l.id}>{l.businessName}</option>)}</Select></Field>
      <Field label="Stage"><Select value={f.stageId || ""} onChange={(e) => set("stageId", e.target.value)}>{d.dealStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Value (₹)"><Input type="number" value={f.value ?? 0} onChange={(e) => set("value", Number(e.target.value))} /></Field>
      <Field label="Owner"><Select value={f.ownerId || ""} onChange={(e) => set("ownerId", e.target.value || undefined)}><option value="">—</option>{d.users.filter((u) => u.isSales && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      <Field label="Expected close"><Input type="date" value={f.expectedClose || ""} onChange={(e) => set("expectedClose", e.target.value)} /></Field>
      <Field label="Product / service" className="col-span-2"><Input value={f.notes || ""} onChange={(e) => set("notes", e.target.value)} /></Field>
      <div className="col-span-2 flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn onClick={() => void save()} loading={busy}>{editing ? "Save" : "Create deal"}</Btn></div>
    </div>
  );
}

export default function Pipeline() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [stages, setStages] = useState<DealStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "create" | "edit">( "");
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (DEMO_MODE) {
        setStages([...getDB().dealStages].sort((a, b) => a.order - b.order));
        setDeals([...getDB().deals]);
      } else {
        const [ds, st] = await Promise.all([dealApi.list({ page: 1, page_size: 500 }), dealApi.stages()]);
        setStages(((st.data as ApiDealStage[]) || []).map(fromApiStage).sort((a, b) => a.order - b.order));
        setDeals(((ds.data as { items: ApiDeal[] }).items || []).map(fromApiDeal));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load the pipeline."); }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const byStage = useMemo(() => {
    const m = new Map<string, Deal[]>();
    stages.forEach((s) => m.set(s.id, []));
    deals.forEach((deal) => m.get(deal.stageId)?.push(deal));
    return m;
  }, [deals, stages]);

  const moveDeal = async (dealId: string, stageId: string) => {
    const stage = stages.find((s) => s.id === stageId);
    const deal = deals.find((x) => x.id === dealId);
    if (!stage || !deal || deal.stageId === stageId) return;
    const prev = deal.stageId;
    setDeals((ds) => ds.map((x) => (x.id === dealId ? { ...x, stageId } : x))); // optimistic
    try {
      if (DEMO_MODE) {
        mutate((db) => { const x = db.deals.find((y) => y.id === dealId); if (x) { x.stageId = stageId; x.closedAt = stage.kind !== "open" ? new Date().toISOString() : undefined; } });
        if (stage.kind === "won") toast("Deal won 🎉", "ok", deal.title);
      } else {
        const r = await dealApi.moveStage(Number(dealId), stageId);
        setDeals((ds) => ds.map((x) => (x.id === dealId ? fromApiDeal(r.data as ApiDeal) : x)));
        if (stage.kind === "won") toast("Deal won 🎉", "ok", `${deal.title} · ${inr(deal.value)}`);
        else toast(`Moved to ${stage.name}`, "info");
      }
    } catch (e) {
      setDeals((ds) => ds.map((x) => (x.id === dealId ? { ...x, stageId: prev } : x))); // rollback
      toast(e instanceof Error ? e.message : "Move failed — rolled back", "err");
    }
  };

  const removeDeal = async (id: string) => {
    if (!window.confirm("Delete this deal?")) return;
    try {
      if (DEMO_MODE) mutate((db) => { db.deals = db.deals.filter((x) => x.id !== id); });
      else await dealApi.remove(Number(id));
      setDeals((ds) => ds.filter((x) => x.id !== id));
      setOpenId(null); toast("Deal deleted", "warn");
    } catch (e) { toast(e instanceof Error ? e.message : "Delete failed", "err"); }
  };

  const openDeal = openId ? deals.find((x) => x.id === openId) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-3 p-4 pb-2 md:px-6">
        <div>
          <h1 className="hd text-[22px]">Sales Pipeline</h1>
          <p className="text-[12.5px] text-ink-500">
            {DEMO_MODE ? "Demo workspace — drag cards between stages." : "Drag cards — every move is written to PostgreSQL, logged and reflected in the dashboard."}
          </p>
        </div>
        {can("deals", "create") && <Btn size="sm" onClick={() => { setEditDeal(null); setModal("create"); }}><Plus size={14} /> New deal</Btn>}
      </div>

      {error ? (
        <div className="mx-auto w-full max-w-[1500px] p-6">
          <div className="card flex flex-col items-center gap-3 p-10 text-center">
            <AlertTriangle size={26} className="text-red-500" />
            <div className="hd text-[15px]">Unable to load the pipeline</div>
            <p className="max-w-md text-[12.5px] text-ink-500">{error}</p>
            <Btn size="sm" onClick={() => void load()}>Retry</Btn>
          </div>
        </div>
      ) : loading ? (
        <div className="mx-auto flex w-full max-w-[1500px] gap-3 overflow-hidden px-4 md:px-6">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-[420px] w-[272px] shrink-0" />)}</div>
      ) : (
        <div className="mx-auto w-full max-w-[1500px] flex-1 overflow-x-auto px-4 pb-4 md:px-6">
          <div className="flex h-full min-w-max gap-3">
            {stages.map((st) => {
              const list = byStage.get(st.id) || [];
              const total = list.reduce((a, b) => a + b.value, 0);
              return (
                <div key={st.id}
                  className={`kan-col flex h-full w-[272px] shrink-0 flex-col rounded-[10px] border border-ink-200/70 bg-ink-100/45 p-2 dark:border-ink-700/60 dark:bg-ink-900/50 ${overCol === st.id ? "over" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setOverCol(st.id); }}
                  onDragLeave={() => setOverCol((c) => (c === st.id ? null : c))}
                  onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("deal") || dragId; if (id && can("deals", "edit")) void moveDeal(id, st.id); setOverCol(null); setDragId(null); }}>
                  <div className="mb-2 flex items-center justify-between px-1.5 pt-1">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${st.kind === "won" ? "bg-emerald-500" : st.kind === "lost" ? "bg-red-400" : "bg-brand-500"}`} />
                      <span className="text-[12px] font-bold uppercase tracking-wider text-ink-600 dark:text-ink-300">{st.name}</span>
                      <span className="num rounded-full bg-white px-1.5 text-[10.5px] font-bold text-ink-500 shadow-sm dark:bg-ink-800">{list.length}</span>
                    </div>
                    <Money v={total} className="text-[11px] font-semibold text-ink-400" />
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto pb-2">
                    {list.map((deal) => {
                      const owner = d.users.find((u) => u.id === deal.ownerId);
                      const lead = deal.leadId ? d.leads.find((l) => l.id === deal.leadId) : undefined;
                      const cust = deal.customerId ? d.customers.find((c) => c.id === deal.customerId) : undefined;
                      const overdue = !!deal.expectedClose && deal.expectedClose < todayISO() && st.kind === "open";
                      return (
                        <div key={deal.id} draggable={can("deals", "edit")}
                          onDragStart={(e) => { e.dataTransfer.setData("deal", deal.id); e.dataTransfer.effectAllowed = "move"; setDragId(deal.id); }}
                          onDragEnd={() => setDragId(null)}
                          onClick={() => setOpenId(deal.id)}
                          className={`card group cursor-pointer p-2.5 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md ${dragId === deal.id ? "drag-ghost" : ""}`}>
                          <div className="text-[12.5px] font-semibold leading-snug text-ink-800 dark:text-ink-100">{deal.title}</div>
                          <div className="mt-0.5 truncate text-[11px] text-ink-400">{cust?.company || lead?.businessName || "—"}</div>
                          <div className="mt-1.5 flex items-center justify-between">
                            <Money v={deal.value} className="text-[13px] font-bold text-brand-700 dark:text-brand-300" />
                            {overdue && <span className="text-[10px] font-semibold text-red-500">close overdue</span>}
                          </div>
                          <div className="mt-1.5 flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {lead?.score != null && <span className={`num rounded px-1 text-[10px] font-bold ${lead.score >= 75 ? "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300" : "bg-ink-100 text-ink-500 dark:bg-ink-800"}`}>{lead.score}</span>}
                              {deal.notes && <span className="truncate text-[10px] text-ink-400">{deal.notes}</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {deal.expectedClose && <span className="num flex items-center gap-1 text-[10px] text-ink-400"><CalendarDays size={10} />{fmtD(deal.expectedClose).replace(/, \d{4}$/, "")}</span>}
                              {owner && <Avatar name={owner.name} color={owner.color} size={20} />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {list.length === 0 && (
                      <div className="rounded-md border border-dashed border-ink-200 py-6 text-center text-[11px] text-ink-300 dark:border-ink-700 dark:text-ink-600">
                        {can("deals", "edit") ? "Drop a deal here" : "No deals"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal === "create" && <Modal open onClose={() => setModal("")} title="New deal" wide><DealModal initial={{ value: 50000, expectedClose: addDaysISO(21), ownerId: user?.id || undefined }} editing={false} onDone={() => setModal("")} onSaved={() => void load()} /></Modal>}
      {modal === "edit" && editDeal && <Modal open onClose={() => setModal("")} title="Edit deal" wide><DealModal initial={editDeal} editing onDone={() => setModal("")} onSaved={() => void load()} /></Modal>}

      {openDeal && (
        <Drawer open onClose={() => setOpenId(null)} title={openDeal.title}
          headerExtra={can("deals", "edit") ? <Btn variant="ghost" size="sm" onClick={() => { setEditDeal(openDeal); setModal("edit"); setOpenId(null); }}><Pencil size={13} /> Edit</Btn> : undefined}>
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Value</div><Money v={openDeal.value} className="text-xl font-bold text-brand-700 dark:text-brand-300" /></div>
              <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Stage</div><Badge tone={statusTone(stages.find((s) => s.id === openDeal.stageId)?.name || "")} className="mt-1.5">{stages.find((s) => s.id === openDeal.stageId)?.name}</Badge></div>
            </div>
            {can("deals", "edit") && (
              <Field label="Move to stage (writes to the database)">
                <Select value={openDeal.stageId} onChange={(e) => void moveDeal(openDeal.id, e.target.value)}>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
            )}
            {[["Owner", d.users.find((u) => u.id === openDeal.ownerId)?.name || "—"],
            ["Expected close", openDeal.expectedClose ? fmtD(openDeal.expectedClose) : "—"],
            ["Created", fmtD(openDeal.createdAt)],
            ["Closed", openDeal.closedAt ? fmtD(openDeal.closedAt) : "open"],
            ["Customer", d.customers.find((c) => c.id === openDeal.customerId)?.company || "—"],
            ["Source lead", openDeal.leadId ? d.leads.find((l) => l.id === openDeal.leadId)?.businessName || "—" : "—"],
            ["Product / service", openDeal.notes || "—"]].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between border-b border-ink-100 py-2 text-[13px] last:border-0 dark:border-ink-800"><span className="text-ink-400">{String(k)}</span><span className="font-medium text-ink-700 dark:text-ink-200">{String(v)}</span></div>
            ))}
            {can("deals", "delete") && <Btn variant="danger" size="sm" onClick={() => void removeDeal(openDeal.id)}><Trash2 size={13} /> Delete deal</Btn>}
          </div>
        </Drawer>
      )}
      {!loading && !error && deals.length === 0 && <EmptyState title="No deals yet" body="Convert a lead or create a deal manually." />}
    </div>
  );
}
