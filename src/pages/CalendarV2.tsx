import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, DEMO_MODE } from "../lib/api";
import { useDB } from "../lib/db";
import { todayISO } from "../lib/services";
import { useStore } from "../store";
import { Badge, Btn, Field, Input, Modal, Select, Textarea, Toggle } from "../components/ui";

type ManagedEntry = {
  id: number; title: string; kind: "event" | "holiday"; date: string;
  start_time: string; end_time: string; all_day: boolean; location: string; description: string;
};
type Item = { label: string; kind: string; color: string; to?: string; record?: ManagedEntry };
type Form = { title: string; kind: "event" | "holiday"; date: string; start_time: string; end_time: string; all_day: boolean; location: string; description: string };

const blank = (date: string, kind: "event" | "holiday"): Form => ({
  title: "", kind, date, start_time: kind === "event" ? "10:00" : "", end_time: kind === "event" ? "11:00" : "", all_day: kind === "holiday", location: "", description: "",
});
const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CalendarV2() {
  const d = useDB();
  const nav = useNavigate();
  const { can, toast } = useStore();
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [selected, setSelected] = useState(todayISO());
  const [managed, setManaged] = useState<ManagedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<ManagedEntry | null>(null);
  const [form, setForm] = useState<Form>(() => blank(todayISO(), "event"));
  const [busy, setBusy] = useState(false);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = dateKey(new Date(year, month + 1, 0));
  const gridDates = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [year, month]);

  const load = async () => {
    if (DEMO_MODE) return;
    setLoading(true);
    try {
      const r = await api.get<ManagedEntry[]>("/calendar/events", { params: { from: monthStart, to: monthEnd } });
      setManaged(r.data);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load calendar", "err"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [monthStart, monthEnd]);

  const entityName = (type: "lead" | "customer", id: string) => type === "lead" ? d.leads.find((x) => x.id === id)?.businessName : d.customers.find((x) => x.id === id)?.company;
  const itemsFor = (date: string): Item[] => {
    const items: Item[] = [];
    managed.filter((x) => x.date === date).forEach((x) => items.push({
      label: x.kind === "holiday" ? x.title : `${x.all_day || !x.start_time ? "" : `${x.start_time} `}${x.title}`,
      kind: x.kind === "holiday" ? "Holiday" : "Event", color: x.kind === "holiday" ? "bg-rose-500" : "bg-sky-500", record: x,
    }));
    d.followups.filter((x) => x.date === date && x.status !== "Cancelled").forEach((x) => items.push({ label: `${x.type} · ${entityName(x.entityType, x.entityId) || ""}`, kind: "Follow-up", color: "bg-brand-500", to: "/followups" }));
    d.tasks.filter((x) => x.dueDate === date && !["Completed", "Cancelled"].includes(x.status)).forEach((x) => items.push({ label: x.title, kind: "Task", color: "bg-amber-500", to: "/tasks" }));
    d.meetings.filter((x) => x.date === date).forEach((x) => items.push({ label: `${x.start} ${x.title}`, kind: "Meeting", color: "bg-violet-500", to: "/meetings" }));
    d.invoices.filter((x) => x.dueDate === date && !["Paid", "Cancelled", "Draft"].includes(x.status)).forEach((x) => items.push({ label: `${x.number} due`, kind: "Payment", color: "bg-red-500", to: "/invoices" }));
    return items;
  };

  const requestNew = (kind: "event" | "holiday") => {
    if (!can("calendar", "create")) { toast("You can view the calendar, but you do not have permission to add entries", "warn"); return; }
    setEditing(null); setForm(blank(selected, kind)); setModal(true);
  };
  const editEntry = (entry: ManagedEntry) => {
    if (!can("calendar", "edit")) { toast("You do not have permission to edit calendar entries", "warn"); return; }
    setEditing(entry); setForm({ ...entry }); setModal(true);
  };
  const save = async () => {
    if (!form.title.trim() || !form.date) { toast("Title and date are required", "err"); return; }
    setBusy(true);
    const payload = { ...form, title: form.title.trim(), all_day: form.kind === "holiday" ? true : form.all_day };
    try {
      if (DEMO_MODE) {
        if (editing) setManaged((xs) => xs.map((x) => x.id === editing.id ? { ...x, ...payload } : x));
        else setManaged((xs) => [...xs, { id: Date.now(), ...payload }]);
      } else if (editing) await api.patch(`/calendar/events/${editing.id}`, payload);
      else await api.post("/calendar/events", payload);
      toast(editing ? "Calendar entry updated" : form.kind === "holiday" ? "Holiday added" : "Event added", "ok");
      setModal(false); if (!DEMO_MODE) await load();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save calendar entry", "err"); }
    finally { setBusy(false); }
  };
  const remove = async (entry: ManagedEntry) => {
    if (!can("calendar", "delete")) { toast("You do not have permission to delete calendar entries", "warn"); return; }
    if (!window.confirm(`Delete ${entry.kind} “${entry.title}”?`)) return;
    try { if (!DEMO_MODE) await api.delete(`/calendar/events/${entry.id}`); setManaged((xs) => xs.filter((x) => x.id !== entry.id)); toast("Calendar entry deleted", "ok"); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not delete calendar entry", "err"); }
  };

  const selectedItems = itemsFor(selected);
  return (
    <div className="mx-auto max-w-[1280px] p-4 md:p-6">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="hd flex items-center gap-2 text-[22px]"><CalendarDays size={20} /> Monthly Calendar</h1>
          <p className="mt-1 text-[12.5px] text-ink-500">Normal month view with company events, holidays, meetings, tasks, follow-ups and payment reminders.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="outline" size="sm" onClick={() => requestNew("holiday")}><Plus size={14} /> Add Holiday</Btn>
          <Btn size="sm" onClick={() => requestNew("event")}><Plus size={14} /> Add Event</Btn>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 bg-surface p-2.5 dark:border-ink-700 dark:bg-ink-900">
        <Btn variant="outline" size="sm" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={14} /> Previous</Btn>
        <div className="hd text-[17px]">{cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</div>
        <div className="flex gap-2"><Btn variant="ghost" size="sm" onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); setSelected(todayISO()); }}>Today</Btn><Btn variant="outline" size="sm" onClick={() => setCursor(new Date(year, month + 1, 1))}>Next <ChevronRight size={14} /></Btn></div>
      </div>

      {loading && <div className="mb-2 text-[11px] text-ink-400">Loading month…</div>}
      <div className="grid gap-4 xl:grid-cols-[1fr_310px]">
        <div className="card overflow-hidden p-2 sm:p-3">
          <div className="grid grid-cols-7 border-b border-ink-100 pb-2 text-center text-[10px] font-bold uppercase tracking-wider text-ink-400 dark:border-ink-800">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((x) => <div key={x}>{x}</div>)}</div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {gridDates.map((dt) => {
              const key = dateKey(dt); const inMonth = dt.getMonth() === month; const today = key === todayISO(); const active = key === selected; const items = itemsFor(key);
              return <button key={key} onClick={() => { setSelected(key); if (!inMonth) setCursor(new Date(dt.getFullYear(), dt.getMonth(), 1)); }} className={`min-h-[92px] rounded-md border p-1.5 text-left align-top transition hover:border-brand-300 sm:min-h-[108px] ${active ? "border-brand-500 bg-brand-50/60 dark:bg-brand-900/20" : "border-ink-100 dark:border-ink-800"} ${!inMonth ? "opacity-45" : ""}`}>
                <div className="flex items-center justify-between"><span className={`num flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${today ? "bg-brand-600 text-white" : "text-ink-600 dark:text-ink-300"}`}>{dt.getDate()}</span>{items.length > 0 && <span className="num text-[9px] text-ink-400">{items.length}</span>}</div>
                <div className="mt-1 space-y-1">{items.slice(0, 3).map((x, i) => <div key={`${x.kind}-${i}`} className={`truncate rounded px-1 py-0.5 text-[9px] font-medium text-white ${x.color}`}>{x.label}</div>)}{items.length > 3 && <div className="text-[9px] text-ink-400">+{items.length - 3} more</div>}</div>
              </button>;
            })}
          </div>
        </div>

        <aside className="card h-fit p-4">
          <div className="flex items-start justify-between gap-2"><div><h2 className="hd text-[15px]">{new Date(selected + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2><p className="mt-1 text-[11px] text-ink-400">{selectedItems.length} calendar item{selectedItems.length === 1 ? "" : "s"}</p></div><Btn size="xs" variant="outline" onClick={() => requestNew("event")}><Plus size={12} /> Add</Btn></div>
          <div className="mt-3 space-y-2">{selectedItems.length === 0 && <div className="rounded-lg border border-dashed border-ink-200 p-5 text-center text-[12px] text-ink-400 dark:border-ink-700">No entries for this day.</div>}{selectedItems.map((x, i) => <div key={`${x.kind}-${i}`} className="flex items-center gap-2 rounded-md border border-ink-100 p-2.5 dark:border-ink-800"><span className={`h-2.5 w-2.5 rounded-full ${x.color}`} /><button className="min-w-0 flex-1 text-left" onClick={() => x.record ? editEntry(x.record) : x.to && nav(x.to)}><div className="truncate text-[12.5px] font-semibold">{x.label}</div><div className="text-[10.5px] text-ink-400">{x.kind}</div></button>{x.record && <><button onClick={() => editEntry(x.record!)} className="p-1 text-ink-400 hover:text-brand-600"><Pencil size={13} /></button>{can("calendar", "delete") && <button onClick={() => void remove(x.record!)} className="p-1 text-ink-400 hover:text-red-500"><Trash2 size={13} /></button>}</>}</div>)}</div>
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3 dark:border-ink-800"><Badge tone="red">Holiday</Badge><Badge tone="green">Event</Badge><Badge tone="amber">Task / reminder</Badge></div>
        </aside>
      </div>

      {modal && <Modal open wide onClose={() => !busy && setModal(false)} title={editing ? `Edit ${form.kind === "holiday" ? "Holiday" : "Event"}` : `Add ${form.kind === "holiday" ? "Holiday" : "Event"}`} footer={<><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{editing ? "Save Changes" : form.kind === "holiday" ? "Add Holiday" : "Add Event"}</Btn></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type"><Select value={form.kind} onChange={(e) => { const kind = e.target.value as "event" | "holiday"; setForm((p) => ({ ...p, kind, all_day: kind === "holiday" ? true : p.all_day, start_time: kind === "holiday" ? "" : p.start_time || "10:00", end_time: kind === "holiday" ? "" : p.end_time || "11:00" })); }}><option value="event">Event</option><option value="holiday">Holiday</option></Select></Field>
          <Field label="Date" req><Input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} /></Field>
          <Field label="Title" req className="sm:col-span-2"><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder={form.kind === "holiday" ? "e.g. Diwali" : "e.g. Monthly review"} /></Field>
          {form.kind === "event" && <><Field label="Start"><Input type="time" disabled={form.all_day} value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} /></Field><Field label="End"><Input type="time" disabled={form.all_day} value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} /></Field><div className="sm:col-span-2"><Toggle on={form.all_day} onChange={(all_day) => setForm((p) => ({ ...p, all_day }))} label="All-day event" /></div><Field label="Location" className="sm:col-span-2"><Input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="Office / Google Meet / Client site" /></Field></>}
          <Field label="Description" className="sm:col-span-2"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Notes or details" /></Field>
        </div>
      </Modal>}
    </div>
  );
}
