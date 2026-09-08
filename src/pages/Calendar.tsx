import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { api, DEMO_MODE } from "../lib/api";
import { useDB } from "../lib/db";
import { todayISO } from "../lib/services";
import { useStore } from "../store";
import { Badge, Btn, Field, Input, Modal, Select, Textarea, Toggle } from "../components/ui";

type ManagedEntry = {
  id: number;
  title: string;
  kind: "event" | "holiday";
  date: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  location: string;
  description: string;
};

type CalendarItem = {
  label: string;
  kind: string;
  color: string;
  to?: string;
  record?: ManagedEntry;
};

type EntryForm = {
  title: string;
  kind: "event" | "holiday";
  date: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  location: string;
  description: string;
};

const newForm = (date: string, kind: "event" | "holiday"): EntryForm => ({
  title: "", kind, date, start_time: kind === "holiday" ? "" : "10:00", end_time: kind === "holiday" ? "" : "11:00",
  all_day: kind === "holiday", location: "", description: "",
});

export default function CalendarPage() {
  const d = useDB();
  const nav = useNavigate();
  const { can, toast } = useStore();
  const [cursor, setCursor] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [selected, setSelected] = useState(todayISO());
  const [managed, setManaged] = useState<ManagedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<ManagedEntry | null>(null);
  const [form, setForm] = useState<EntryForm>(() => newForm(todayISO(), "event"));
  const [busy, setBusy] = useState(false);

  const today = todayISO();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const mm = String(month + 1).padStart(2, "0");
  const monthStart = `${year}-${mm}-01`;
  const monthEnd = `${year}-${mm}-${String(daysIn).padStart(2, "0")}`;
  const cells: (string | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysIn }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`),
  ];

  const load = async () => {
    if (DEMO_MODE) return;
    setLoading(true);
    try {
      const r = await api.get<ManagedEntry[]>("/calendar/events", { params: { from: monthStart, to: monthEnd } });
      setManaged(r.data);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load calendar events", "err");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [monthStart, monthEnd]);

  const entityName = (type: "lead" | "customer", id: string) =>
    type === "lead" ? d.leads.find((l) => l.id === id)?.businessName : d.customers.find((c) => c.id === id)?.company;

  const eventsFor = (date: string): CalendarItem[] => {
    const ev: CalendarItem[] = [];
    managed.filter((x) => x.date === date).forEach((x) => ev.push({
      label: x.kind === "holiday" ? x.title : `${x.all_day || !x.start_time ? "" : `${x.start_time} `}${x.title}`,
      kind: x.kind === "holiday" ? "Holiday" : "Event",
      color: x.kind === "holiday" ? "bg-rose-500" : "bg-sky-500",
      record: x,
    }));
    d.followups.filter((f) => f.date === date && f.status !== "Cancelled").forEach((f) => ev.push({ label: `${f.type} · ${entityName(f.entityType, f.entityId) || ""}`, kind: "Follow-up", color: "bg-brand-500", to: "/followups" }));
    d.tasks.filter((t) => t.dueDate === date && t.status !== "Completed" && t.status !== "Cancelled").forEach((t) => ev.push({ label: t.title, kind: "Task due", color: "bg-amber-500", to: "/tasks" }));
    d.meetings.filter((m) => m.date === date).forEach((m) => ev.push({ label: `${m.start} ${m.title}`, kind: "Meeting", color: "bg-violet-500", to: "/meetings" }));
    d.invoices.filter((i) => i.dueDate === date && !["Paid", "Cancelled", "Draft"].includes(i.status)).forEach((i) => ev.push({ label: `${i.number} due`, kind: "Payment", color: "bg-red-500", to: "/invoices" }));
    return ev;
  };

  const openNew = (kind: "event" | "holiday") => {
    setEditing(null);
    setForm(newForm(selected, kind));
    setModal(true);
  };

  const openEdit = (entry: ManagedEntry) => {
    setEditing(entry);
    setForm({
      title: entry.title,
      kind: entry.kind,
      date: entry.date,
      start_time: entry.start_time || "",
      end_time: entry.end_time || "",
      all_day: entry.all_day,
      location: entry.location || "",
      description: entry.description || "",
    });
    setModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) { toast("Title is required", "err"); return; }
    if (!form.date) { toast("Date is required", "err"); return; }
    setBusy(true);
    const payload = { ...form, title: form.title.trim(), all_day: form.kind === "holiday" ? true : form.all_day };
    try {
      if (DEMO_MODE) {
        if (editing) setManaged((xs) => xs.map((x) => x.id === editing.id ? { ...x, ...payload } : x));
        else setManaged((xs) => [...xs, { id: Date.now(), ...payload }]);
      } else if (editing) {
        await api.patch(`/calendar/events/${editing.id}`, payload);
      } else {
        await api.post("/calendar/events", payload);
      }
      toast(editing ? "Calendar entry updated" : (form.kind === "holiday" ? "Holiday added" : "Event added"), "ok");
      setModal(false);
      if (!DEMO_MODE) await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save calendar entry", "err");
    } finally { setBusy(false); }
  };

  const remove = async (entry: ManagedEntry) => {
    if (!window.confirm(`Delete ${entry.kind} “${entry.title}”?`)) return;
    try {
      if (DEMO_MODE) setManaged((xs) => xs.filter((x) => x.id !== entry.id));
      else { await api.delete(`/calendar/events/${entry.id}`); await load(); }
      toast(entry.kind === "holiday" ? "Holiday deleted" : "Event deleted", "ok");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete calendar entry", "err"); }
  };

  const selEvents = eventsFor(selected);

  return (
    <div className="mx-auto max-w-[1200px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="hd flex items-center gap-2 text-[22px]"><CalendarDays size={20} /> Calendar</h1>
          <p className="text-[12.5px] text-ink-500">Events, holidays, follow-ups, tasks, meetings and payment reminders in one view.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can("calendar", "create") && <><Btn variant="outline" size="sm" onClick={() => openNew("holiday")}><Plus size={14} /> Holiday</Btn><Btn size="sm" onClick={() => openNew("event")}><Plus size={14} /> Event</Btn></>}
          <Btn variant="outline" size="sm" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={14} /></Btn>
          <span className="hd min-w-[150px] text-center text-[15px]">{cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>
          <Btn variant="outline" size="sm" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={14} /></Btn>
          <Btn variant="ghost" size="sm" onClick={() => { const t = new Date(); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); setSelected(todayISO()); }}>Today</Btn>
        </div>
      </div>

      {loading && <div className="mb-3 text-[11.5px] text-ink-400">Refreshing calendar…</div>}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="card overflow-hidden p-3">
          <div className="mb-2 grid grid-cols-7 text-center text-[10.5px] font-bold uppercase tracking-wider text-ink-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={`e${i}`} className="min-h-[78px] rounded-md bg-ink-50/40 dark:bg-ink-800/20" />;
              const evs = eventsFor(date);
              return (
                <button key={date} onClick={() => setSelected(date)} className={`min-h-[78px] rounded-md border p-1.5 text-left align-top transition-all hover:border-brand-300 ${selected === date ? "border-brand-400 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-900/20" : "border-ink-100 dark:border-ink-800"} ${date === today ? "bg-amber-50/60 dark:bg-amber-900/10" : ""}`}>
                  <span className={`num text-[11px] font-semibold ${date === today ? "text-amber-600" : "text-ink-500"}`}>{Number(date.slice(8, 10))}</span>
                  <div className="mt-1 space-y-0.5">
                    {evs.slice(0, 3).map((e, j) => <div key={`${e.kind}-${j}`} className={`truncate rounded px-1 py-0.5 text-[9.5px] font-medium text-white ${e.color}`}>{e.label}</div>)}
                    {evs.length > 3 && <div className="num text-[9px] text-ink-400">+{evs.length - 3} more</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card h-fit p-4">
          <div className="flex items-start justify-between gap-2">
            <div><h3 className="hd text-[14px]">{new Date(selected + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</h3><p className="mt-0.5 text-[10.5px] text-ink-400">{selEvents.length} item{selEvents.length === 1 ? "" : "s"}</p></div>
            {can("calendar", "create") && <Btn size="xs" variant="outline" onClick={() => openNew("event")}><Plus size={12} /> Add</Btn>}
          </div>
          <div className="mt-3 space-y-2">
            {selEvents.length === 0 && <p className="rounded-lg border border-dashed border-ink-200 p-4 text-center text-[12.5px] text-ink-400 dark:border-ink-700">Nothing scheduled.</p>}
            {selEvents.map((e, i) => (
              <div key={`${e.kind}-${i}`} className="flex w-full items-center gap-2.5 rounded-md border border-ink-100 p-2.5 dark:border-ink-800">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${e.color}`} />
                <button onClick={() => e.record ? (can("calendar", "edit") && openEdit(e.record)) : e.to && nav(e.to)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">{e.label}</span>
                  <span className="text-[10.5px] text-ink-400">{e.kind}</span>
                </button>
                {e.record && can("calendar", "edit") && <button onClick={() => openEdit(e.record!)} className="rounded p-1 text-ink-400 hover:text-brand-600"><Pencil size={13} /></button>}
                {e.record && can("calendar", "delete") && <button onClick={() => void remove(e.record!)} className="rounded p-1 text-ink-400 hover:text-red-500"><Trash2 size={13} /></button>}
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-ink-100 pt-3 dark:border-ink-800">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="red">Holiday</Badge><Badge tone="green">Event</Badge><Badge tone="amber">Tasks / reminders</Badge>
            </div>
          </div>
        </div>
      </div>

      {modal && (
        <Modal open onClose={() => !busy && setModal(false)} title={editing ? `Edit ${form.kind}` : `Add ${form.kind}`} wide footer={
          <><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{editing ? "Save changes" : "Add to calendar"}</Btn></>
        }>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Type"><Select value={form.kind} onChange={(e) => { const kind = e.target.value as "event" | "holiday"; setForm((p) => ({ ...p, kind, all_day: kind === "holiday" ? true : p.all_day, start_time: kind === "holiday" ? "" : p.start_time, end_time: kind === "holiday" ? "" : p.end_time })); }}><option value="event">Event</option><option value="holiday">Holiday</option></Select></Field>
            <Field label="Date" req><Input type="date" value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} /></Field>
            <Field label="Title" req className="sm:col-span-2"><Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder={form.kind === "holiday" ? "e.g. Diwali" : "e.g. Quarterly review"} /></Field>
            {form.kind === "event" && <>
              <Field label="Start time"><Input type="time" disabled={form.all_day} value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} /></Field>
              <Field label="End time"><Input type="time" disabled={form.all_day} value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} /></Field>
              <div className="sm:col-span-2"><Toggle on={form.all_day} onChange={(all_day) => setForm((p) => ({ ...p, all_day }))} label="All-day event" /></div>
            </>}
            <Field label="Location" className="sm:col-span-2"><Input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="Office, client site, online…" /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
