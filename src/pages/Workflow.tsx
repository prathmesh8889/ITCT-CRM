import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, PhoneCall, Check, X, CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List, Clock, Pencil, Trash2, Video } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB, uid } from "../lib/db";
import { logAct, runTriggers, fmtD, todayISO, addDaysISO } from "../lib/services";
import type { FollowUp, FUType, FUStatus, Task, Meeting, Priority } from "../lib/types";
import { Btn, Badge, Modal, Field, Input, Select, Textarea, Tabs, EmptyState, Avatar, statusTone, Toggle } from "../components/ui";

const entityName = (d: ReturnType<typeof useDB>, type: "lead" | "customer", id: string) =>
  type === "lead" ? d.leads.find((l) => l.id === id)?.businessName : d.customers.find((c) => c.id === id)?.company;

// ================= FOLLOW-UPS =================
function CompleteFU({ fu, onDone }: { fu: FollowUp; onDone: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [outcome, setOutcome] = useState("Interested");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState(true);
  const [nextDate, setNextDate] = useState(addDaysISO(outcome === "Interested" ? 2 : 1));
  const [nextType, setNextType] = useState<FUType>("Call");
  const finish = () => {
    mutate((db) => {
      const f = db.followups.find((x) => x.id === fu.id);
      if (f) { f.status = "Completed"; f.outcome = outcome; f.notes = notes; f.completedAt = new Date().toISOString(); }
      if (fu.entityType === "lead") {
        const l = db.leads.find((x) => x.id === fu.entityId);
        if (l) {
          if (l.status === "New") l.status = "Contacted";
          if (outcome === "Interested" && l.status === "Contacted") l.status = "Interested";
          if (outcome === "Not interested") l.status = "Lost";
          l.updatedAt = new Date().toISOString();
        }
      }
      if (next) db.followups.unshift({ id: uid(), entityType: fu.entityType, entityId: fu.entityId, employeeId: fu.employeeId, type: nextType, date: nextDate, time: "11:00", reminder: true, status: "Scheduled", notes: `Chained from ${fu.type} (${outcome})`, outcome: "", createdAt: new Date().toISOString() });
    });
    logAct("followup", fu.id, user!.id, "Follow-up completed", `${fu.type} · ${outcome}`);
    toast("Follow-up completed", "ok", next ? `Next ${nextType} scheduled for ${fmtD(nextDate)}.` : undefined);
    onDone();
  };
  return (
    <div className="space-y-3">
      <Field label="Outcome"><Select value={outcome} onChange={(e) => { setOutcome(e.target.value); setNextDate(addDaysISO(e.target.value === "Interested" ? 2 : e.target.value === "Not interested" ? 7 : 1)); }}>
        {["Interested", "Callback requested", "Sent pricing", "Demo booked", "No answer", "Not interested"].map((o) => <option key={o}>{o}</option>)}</Select></Field>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <Toggle on={next} onChange={setNext} label="Create next follow-up (smart chaining)" />
      {next && <div className="grid grid-cols-2 gap-3">
        <Field label="Next type"><Select value={nextType} onChange={(e) => setNextType(e.target.value as FUType)}>{["Call", "WhatsApp", "Email", "Demo", "Meeting", "Proposal"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Next date"><Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} /></Field>
      </div>}
      <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn onClick={finish}><Check size={14} /> Complete</Btn></div>
      <span className="hidden">{d.settings.company.name}</span>
    </div>
  );
}

export function FollowUps() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState("today");
  const [fEmp, setFEmp] = useState("");
  const [create, setCreate] = useState(params.get("new") === "1");
  const [completeId, setCompleteId] = useState<string | null>(null);
  const [reschedId, setReschedId] = useState<string | null>(null);
  const [rsDate, setRsDate] = useState(addDaysISO(1));
  const isExec = user?.roleId === "r_sales";
  const today = todayISO();
  useEffectClear(params, setParams);

  const list = useMemo(() => {
    let l = [...d.followups].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    if (isExec) l = l.filter((f) => f.employeeId === user?.id);
    if (fEmp) l = l.filter((f) => f.employeeId === fEmp);
    if (filter === "today") l = l.filter((f) => f.date === today && f.status === "Scheduled");
    if (filter === "overdue") l = l.filter((f) => f.status === "Missed" || (f.status === "Scheduled" && f.date < today));
    if (filter === "upcoming") l = l.filter((f) => f.status === "Scheduled" && f.date > today);
    if (filter === "completed") l = l.filter((f) => f.status === "Completed");
    if (filter === "all") { /* everything */ }
    return l;
  }, [d.followups, filter, fEmp, isExec, user, today]);

  const setStatus = (id: string, status: FUStatus) => {
    mutate((db) => { const f = db.followups.find((x) => x.id === id); if (f) f.status = status; });
    logAct("followup", id, user!.id, "Follow-up updated", `Status → ${status}`);
    if (status === "Missed") runTriggers("followup.missed", {}, undefined);
    toast(`Marked ${status.toLowerCase()}`, status === "Missed" ? "warn" : "info");
  };

  const fu = completeId ? d.followups.find((f) => f.id === completeId) : null;
  const counts = {
    today: d.followups.filter((f) => f.date === today && f.status === "Scheduled" && (!isExec || f.employeeId === user?.id)).length,
    overdue: d.followups.filter((f) => (f.status === "Missed" || (f.status === "Scheduled" && f.date < today)) && (!isExec || f.employeeId === user?.id)).length,
  };

  return (
    <div className="mx-auto max-w-[1100px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Follow-ups</h1><p className="text-[12.5px] text-ink-500">{counts.today} due today · {counts.overdue} overdue{isExec ? " (yours)" : ""}</p></div>
        {can("followups", "create") && <Btn size="sm" onClick={() => setCreate(true)}><Plus size={14} /> Schedule follow-up</Btn>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs tabs={[{ key: "today", label: "Today", count: counts.today }, { key: "overdue", label: "Overdue", count: counts.overdue }, { key: "upcoming", label: "Upcoming" }, { key: "completed", label: "Completed" }, { key: "all", label: "All" }]} active={filter} onChange={setFilter} />
        {!isExec && <Select value={fEmp} onChange={(e) => setFEmp(e.target.value)} className="!w-auto"><option value="">All employees</option>{d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>}
      </div>
      {list.length === 0 ? <EmptyState icon={<PhoneCall size={24} />} title="Nothing here" body="Automation rules can auto-create first touches when leads are assigned." /> : (
        <div className="space-y-2">
          {list.map((f) => {
            const emp = d.users.find((u) => u.id === f.employeeId);
            const name = entityName(d, f.entityType, f.entityId);
            const overdue = f.status === "Scheduled" && f.date < today;
            return (
              <div key={f.id} className={`card flex flex-wrap items-center gap-3 p-3 transition-all hover:shadow-md ${overdue || f.status === "Missed" ? "border-red-200 dark:border-red-900/60" : ""}`}>
                <span className={`flex h-9 w-9 items-center justify-center rounded-md ${f.type === "Call" ? "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300" : f.type === "WhatsApp" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30" : "bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300"}`}><PhoneCall size={16} /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink-800 dark:text-ink-100">{f.type} · {name || "—"}</div>
                  <div className="num text-[11.5px] text-ink-400">{fmtD(f.date)} at {f.time}{f.notes ? ` · ${f.notes}` : ""}{f.outcome ? ` · outcome: ${f.outcome}` : ""}</div>
                </div>
                {emp && <span className="flex items-center gap-1.5 text-[12px] text-ink-500"><Avatar name={emp.name} color={emp.color} size={22} />{emp.name.split(" ")[0]}</span>}
                <Badge tone={statusTone(overdue && f.status === "Scheduled" ? "Missed" : f.status)}>{overdue && f.status === "Scheduled" ? "Overdue" : f.status}</Badge>
                {can("followups", "edit") && f.status !== "Completed" && f.status !== "Cancelled" && (
                  <div className="flex gap-1">
                    {f.status !== "Missed" || true ? <Btn size="xs" variant="soft" onClick={() => setCompleteId(f.id)}><Check size={12} /> Done</Btn> : null}
                    <Btn size="xs" variant="ghost" onClick={() => { setReschedId(f.id); setRsDate(addDaysISO(1)); }}><Clock size={12} /></Btn>
                    <Btn size="xs" variant="ghost" onClick={() => setStatus(f.id, "Cancelled")}><X size={12} /></Btn>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {create && <FollowUpModal onClose={() => setCreate(false)} />}
      {fu && <Modal open onClose={() => setCompleteId(null)} title={`Complete ${fu.type.toLowerCase()} — ${entityName(d, fu.entityType, fu.entityId)}`}><CompleteFU fu={fu} onDone={() => setCompleteId(null)} /></Modal>}
      {reschedId && (
        <Modal open onClose={() => setReschedId(null)} title="Reschedule follow-up">
          <Field label="New date"><Input type="date" value={rsDate} onChange={(e) => setRsDate(e.target.value)} /></Field>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setReschedId(null)}>Cancel</Btn>
            <Btn onClick={() => { mutate((db) => { const f = db.followups.find((x) => x.id === reschedId); if (f) { f.date = rsDate; f.status = "Rescheduled"; } }); logAct("followup", reschedId, user!.id, "Follow-up rescheduled", `New date ${rsDate}`); toast("Rescheduled"); setReschedId(null); }}>Reschedule</Btn></div>
        </Modal>
      )}
    </div>
  );
}
function useEffectClear(params: URLSearchParams, setParams: (p: Record<string, string>, o?: { replace?: boolean }) => void) {
  // clear ?new=1 after mount
  useState(() => { if (params.get("new")) setTimeout(() => setParams({}, { replace: true }), 0); return 0; });
}

function FollowUpModal({ onClose, presetEntity }: { onClose: () => void; presetEntity?: { type: "lead" | "customer"; id: string } }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [entityType, setEntityType] = useState<"lead" | "customer">(presetEntity?.type || "lead");
  const [entityId, setEntityId] = useState(presetEntity?.id || "");
  const [emp, setEmp] = useState(user?.id || "");
  const [type, setType] = useState<FUType>("Call");
  const [date, setDate] = useState(addDaysISO(1));
  const [time, setTime] = useState("10:30");
  const [reminder, setReminder] = useState(true);
  const [notes, setNotes] = useState("");
  const save = () => {
    if (!entityId) { toast("Pick a lead or customer", "err"); return; }
    mutate((db) => {
      db.followups.unshift({ id: uid(), entityType, entityId, employeeId: emp, type, date, time, reminder, status: "Scheduled", notes, outcome: "", createdAt: new Date().toISOString() });
      if (entityType === "lead") { const l = db.leads.find((x) => x.id === entityId); if (l) l.nextFollowUp = date; }
    });
    logAct("followup", entityId, user!.id, "Follow-up created", `${type} on ${date}`);
    toast("Follow-up scheduled", "ok", `${type} · ${fmtD(date)} ${time}`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Schedule follow-up">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entity type"><Select value={entityType} onChange={(e) => { setEntityType(e.target.value as "lead" | "customer"); setEntityId(""); }}><option value="lead">Lead</option><option value="customer">Customer</option></Select></Field>
        <Field label={entityType === "lead" ? "Lead" : "Customer"} req>
          <Select value={entityId} onChange={(e) => setEntityId(e.target.value)}><option value="">Select…</option>
            {entityType === "lead" ? d.leads.filter((l) => !["Converted", "Lost"].includes(l.status)).map((l) => <option key={l.id} value={l.id}>{l.businessName}</option>)
              : d.customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </Select>
        </Field>
        <Field label="Employee"><Select value={emp} onChange={(e) => setEmp(e.target.value)}>{d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as FUType)}>{["Call", "WhatsApp", "Email", "Meeting", "Demo", "Proposal", "Payment", "Other"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Notes" className="col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Toggle on={reminder} onChange={setReminder} label="Send reminder notification" /></div>
      <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save}>Schedule</Btn></div>
    </Modal>
  );
}

// ================= TASKS =================
export function TasksPage() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [view, setView] = useState<"list" | "kanban">("list");
  const [create, setCreate] = useState(false);
  const today = todayISO();
  const isExec = user?.roleId === "r_sales";
  const tasks = useMemo(() => {
    let t = [...d.tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (isExec) t = t.filter((x) => x.assigneeId === user?.id);
    return t;
  }, [d.tasks, isExec, user]);

  const setStat = (id: string, status: Task["status"]) => {
    mutate((db) => { const t = db.tasks.find((x) => x.id === id); if (t) t.status = status; });
    logAct("task", id, user!.id, "Task updated", `Status → ${status}`);
  };
  const [tf, setTf] = useState<Partial<Task>>({ priority: "Medium", status: "Pending", dueDate: addDaysISO(3) });
  const save = () => {
    if (!tf.title?.trim()) { toast("Title required", "err"); return; }
    mutate((db) => db.tasks.unshift({ id: uid(), title: tf.title!, description: tf.description || "", entityType: tf.entityType, entityId: tf.entityId, assigneeId: tf.assigneeId || user!.id, priority: (tf.priority as Priority) || "Medium", status: "Pending", dueDate: tf.dueDate || addDaysISO(3), createdBy: user!.id, createdAt: new Date().toISOString() }));
    logAct("task", "new", user!.id, "Task created", tf.title);
    toast("Task created"); setCreate(false); setTf({ priority: "Medium", status: "Pending", dueDate: addDaysISO(3) });
  };

  const KanbanCol = ({ status }: { status: Task["status"] }) => {
    const items = tasks.filter((t) => t.status === status);
    return (
      <div className="kan-col flex min-h-[220px] flex-1 flex-col rounded-[10px] border border-ink-200/70 bg-ink-100/45 p-2 dark:border-ink-700/60 dark:bg-ink-900/50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("task"); if (id && can("tasks", "edit")) { setStat(id, status); toast(`Task → ${status}`, "info"); } }}>
        <div className="mb-2 px-1 text-[11.5px] font-bold uppercase tracking-wider text-ink-500">{status} <span className="num">({items.length})</span></div>
        <div className="space-y-2">
          {items.map((t) => (
            <div key={t.id} draggable={can("tasks", "edit")} onDragStart={(e) => e.dataTransfer.setData("task", t.id)}
              className="card cursor-grab p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing">
              <div className="text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">{t.title}</div>
              <div className="mt-1 flex items-center justify-between">
                <Badge tone={t.priority === "Urgent" ? "red" : t.priority === "High" ? "amber" : "slate"}>{t.priority}</Badge>
                <span className={`num text-[10.5px] ${t.dueDate < today ? "font-bold text-red-500" : "text-ink-400"}`}>{fmtD(t.dueDate)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1200px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Tasks</h1><p className="text-[12.5px] text-ink-500">{tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled").length} open · {tasks.filter((t) => t.dueDate < today && t.status !== "Completed").length} overdue</p></div>
        <div className="flex gap-2">
          <div className="flex rounded-md border border-ink-200 p-0.5 dark:border-ink-700">
            <button onClick={() => setView("list")} className={`rounded px-2.5 py-1 ${view === "list" ? "bg-brand-600 text-white" : "text-ink-500"}`}><List size={14} /></button>
            <button onClick={() => setView("kanban")} className={`rounded px-2.5 py-1 ${view === "kanban" ? "bg-brand-600 text-white" : "text-ink-500"}`}><LayoutGrid size={14} /></button>
          </div>
          {can("tasks", "create") && <Btn size="sm" onClick={() => setCreate(true)}><Plus size={14} /> Task</Btn>}
        </div>
      </div>
      {view === "list" ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Task</th><th className="th">Linked to</th><th className="th">Assignee</th><th className="th">Priority</th><th className="th">Due</th><th className="th">Status</th><th className="th w-16"></th></tr></thead>
            <tbody>{tasks.map((t) => {
              const a = d.users.find((u) => u.id === t.assigneeId);
              return (
                <tr key={t.id} className="border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50">
                  <td className="td"><span className={`font-medium ${t.status === "Completed" ? "text-ink-400 line-through" : ""}`}>{t.title}</span></td>
                  <td className="td text-[12px] text-ink-400">{t.entityId ? (t.entityType === "lead" ? d.leads.find((l) => l.id === t.entityId)?.businessName : d.customers.find((c) => c.id === t.entityId)?.company) : "—"}</td>
                  <td className="td">{a && <span className="flex items-center gap-1.5"><Avatar name={a.name} color={a.color} size={20} />{a.name.split(" ")[0]}</span>}</td>
                  <td className="td"><Badge tone={t.priority === "Urgent" ? "red" : t.priority === "High" ? "amber" : "slate"}>{t.priority}</Badge></td>
                  <td className={`td num ${t.dueDate < today && t.status !== "Completed" ? "font-bold text-red-500" : "text-ink-400"}`}>{fmtD(t.dueDate)}</td>
                  <td className="td"><Badge tone={statusTone(t.status)}>{t.status}</Badge></td>
                  <td className="td">
                    <div className="flex gap-1">
                      {t.status !== "Completed" && can("tasks", "edit") && <button className="rounded p-1 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20" onClick={() => { setStat(t.id, "Completed"); toast("Task completed"); }}><Check size={13} /></button>}
                      {can("tasks", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => { mutate((db) => { db.tasks = db.tasks.filter((x) => x.id !== t.id); }); toast("Task deleted", "warn"); }}><Trash2 size={13} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          {tasks.length === 0 && <EmptyState title="No tasks" />}
        </div>
      ) : (
        <div className="flex flex-col gap-3 md:flex-row">
          {(["Pending", "In Progress", "Completed"] as const).map((s) => <KanbanCol key={s} status={s} />)}
        </div>
      )}
      {create && (
        <Modal open onClose={() => setCreate(false)} title="New task">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title" req className="col-span-2"><Input value={tf.title || ""} onChange={(e) => setTf((p) => ({ ...p, title: e.target.value }))} /></Field>
            <Field label="Description" className="col-span-2"><Textarea value={tf.description || ""} onChange={(e) => setTf((p) => ({ ...p, description: e.target.value }))} /></Field>
            <Field label="Assignee"><Select value={tf.assigneeId || user?.id || ""} onChange={(e) => setTf((p) => ({ ...p, assigneeId: e.target.value }))}>{d.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
            <Field label="Priority"><Select value={tf.priority} onChange={(e) => setTf((p) => ({ ...p, priority: e.target.value as Priority }))}>{["Low", "Medium", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Due date"><Input type="date" value={tf.dueDate || ""} onChange={(e) => setTf((p) => ({ ...p, dueDate: e.target.value }))} /></Field>
            <Field label="Link to lead"><Select value={tf.entityId || ""} onChange={(e) => setTf((p) => ({ ...p, entityId: e.target.value || undefined, entityType: e.target.value ? "lead" : undefined }))}><option value="">—</option>{d.leads.filter((l) => !["Converted", "Lost"].includes(l.status)).slice(0, 40).map((l) => <option key={l.id} value={l.id}>{l.businessName}</option>)}</Select></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setCreate(false)}>Cancel</Btn><Btn onClick={save}>Create</Btn></div>
        </Modal>
      )}
    </div>
  );
}

// ================= MEETINGS =================
export function MeetingsPage() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const today = todayISO();
  const [mf, setMf] = useState<Partial<Meeting>>({ date: addDaysISO(1), start: "11:00", end: "12:00", location: "Google Meet", link: "https://meet.google.com/itct-demo" });
  const upcoming = useMemo(() => [...d.meetings].filter((m) => m.date >= today).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)), [d.meetings, today]);
  const past = useMemo(() => [...d.meetings].filter((m) => m.date < today).sort((a, b) => b.date.localeCompare(a.date)), [d.meetings, today]);
  const save = () => {
    if (!mf.title?.trim() || !mf.entityId) { toast("Title and customer/lead are required", "err"); return; }
    if (editId) { mutate((db) => { const m = db.meetings.find((x) => x.id === editId); if (m) Object.assign(m, mf); }); toast("Meeting updated"); }
    else {
      mutate((db) => { db.meetings.unshift({ id: uid(), title: mf.title!, entityType: mf.entityType || "customer", entityId: mf.entityId!, employeeIds: mf.employeeIds || [user!.id], date: mf.date!, start: mf.start!, end: mf.end!, location: mf.location || "", link: mf.link || "", agenda: mf.agenda || "", notes: "", outcome: "", createdAt: new Date().toISOString() }); });
      mutate((db) => { db.notices.unshift({ id: uid(), userId: "managers", title: `Meeting: ${mf.title}`, body: `${fmtD(mf.date)} ${mf.start} · ${mf.location}`, read: false, at: new Date().toISOString(), link: "/meetings", kind: "meeting" }); });
      logAct("meeting", "new", user!.id, "Meeting created", mf.title);
      toast("Meeting scheduled", "ok", `${fmtD(mf.date)} · ${mf.start}`);
    }
    setModal(false); setEditId(null); setMf({ date: addDaysISO(1), start: "11:00", end: "12:00", location: "Google Meet" });
  };
  const MeetRow = ({ m }: { m: Meeting }) => {
    const name = m.entityType === "lead" ? d.leads.find((l) => l.id === m.entityId)?.businessName : d.customers.find((c) => c.id === m.entityId)?.company;
    const isToday = m.date === today;
    return (
      <div className={`card flex flex-wrap items-center gap-3 p-3.5 transition-all hover:shadow-md ${isToday ? "border-violet-300/70 dark:border-violet-800" : ""}`}>
        <span className="flex h-10 w-10 flex-col items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
          <span className="num text-[13px] font-bold leading-none">{m.date.slice(8, 10)}</span>
          <span className="text-[8.5px] font-bold uppercase">{new Date(m.date + "T00:00").toLocaleDateString("en-IN", { month: "short" })}</span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-ink-800 dark:text-ink-100">{m.title}{isToday && <Badge tone="violet">Today</Badge>}</div>
          <div className="num text-[11.5px] text-ink-400">{name || "—"} · {m.start}–{m.end} · {m.location}{m.link ? " · link attached" : ""}</div>
          {m.agenda && <div className="truncate text-[11.5px] text-ink-400">Agenda: {m.agenda}</div>}
        </div>
        <div className="flex -space-x-1.5">{m.employeeIds.map((id) => { const u = d.users.find((x) => x.id === id); return u ? <Avatar key={id} name={u.name} color={u.color} size={24} /> : null; })}</div>
        <div className="flex gap-1">
          {m.link && <Btn size="xs" variant="outline" onClick={() => window.open(m.link, "_blank")}><Video size={12} /> Join</Btn>}
          {can("meetings", "edit") && <button className="rounded p-1 text-ink-400 hover:text-brand-600" onClick={() => { setMf({ ...m }); setEditId(m.id); setModal(true); }}><Pencil size={13} /></button>}
          {can("meetings", "edit") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => { if (window.confirm("Delete meeting?")) { mutate((db) => { db.meetings = db.meetings.filter((x) => x.id !== m.id); }); toast("Meeting deleted", "warn"); } }}><Trash2 size={13} /></button>}
        </div>
      </div>
    );
  };
  return (
    <div className="mx-auto max-w-[1000px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Meetings</h1><p className="text-[12.5px] text-ink-500">{upcoming.filter((m) => m.date === today).length} today · {upcoming.length} upcoming</p></div>
        {can("meetings", "create") && <Btn size="sm" onClick={() => { setMf({ date: addDaysISO(1), start: "11:00", end: "12:00", location: "Google Meet" }); setEditId(null); setModal(true); }}><Plus size={14} /> Schedule meeting</Btn>}
      </div>
      <h3 className="hd mb-2 text-[14px]">Upcoming</h3>
      <div className="space-y-2">{upcoming.map((m) => <MeetRow key={m.id} m={m} />)}{upcoming.length === 0 && <EmptyState icon={<CalendarDays size={24} />} title="No upcoming meetings" />}</div>
      {past.length > 0 && <><h3 className="hd mb-2 mt-5 text-[14px]">Past</h3><div className="space-y-2 opacity-75">{past.slice(0, 5).map((m) => <MeetRow key={m.id} m={m} />)}</div></>}
      {modal && (
        <Modal open onClose={() => setModal(false)} title={editId ? "Edit meeting" : "Schedule meeting"} wide>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title" req className="col-span-2"><Input value={mf.title || ""} onChange={(e) => setMf((p) => ({ ...p, title: e.target.value }))} placeholder="Product demo — CRM" /></Field>
            <Field label="Entity type"><Select value={mf.entityType || "customer"} onChange={(e) => setMf((p) => ({ ...p, entityType: e.target.value as "lead" | "customer", entityId: undefined }))}><option value="customer">Customer</option><option value="lead">Lead</option></Select></Field>
            <Field label={mf.entityType === "lead" ? "Lead" : "Customer"} req>
              <Select value={mf.entityId || ""} onChange={(e) => setMf((p) => ({ ...p, entityId: e.target.value }))}><option value="">Select…</option>
                {mf.entityType === "lead" ? d.leads.filter((l) => !["Converted", "Lost"].includes(l.status)).map((l) => <option key={l.id} value={l.id}>{l.businessName}</option>) : d.customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}</Select>
            </Field>
            <Field label="Date"><Input type="date" value={mf.date || ""} onChange={(e) => setMf((p) => ({ ...p, date: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start"><Input type="time" value={mf.start || ""} onChange={(e) => setMf((p) => ({ ...p, start: e.target.value }))} /></Field>
              <Field label="End"><Input type="time" value={mf.end || ""} onChange={(e) => setMf((p) => ({ ...p, end: e.target.value }))} /></Field>
            </div>
            <Field label="Location"><Input value={mf.location || ""} onChange={(e) => setMf((p) => ({ ...p, location: e.target.value }))} /></Field>
            <Field label="Meeting link"><Input value={mf.link || ""} onChange={(e) => setMf((p) => ({ ...p, link: e.target.value }))} /></Field>
            <Field label="Participants" className="col-span-2">
              <div className="flex flex-wrap gap-2">
                {d.users.filter((u) => u.active).map((u) => {
                  const on = (mf.employeeIds || []).includes(u.id);
                  return <button key={u.id} onClick={() => setMf((p) => ({ ...p, employeeIds: on ? (p.employeeIds || []).filter((x) => x !== u.id) : [...(p.employeeIds || []), u.id] }))}
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px] font-medium transition-all ${on ? "border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200" : "border-ink-200 text-ink-500 dark:border-ink-700"}`}><Avatar name={u.name} color={u.color} size={18} />{u.name.split(" ")[0]}</button>;
                })}
              </div>
            </Field>
            <Field label="Agenda" className="col-span-2"><Textarea value={mf.agenda || ""} onChange={(e) => setMf((p) => ({ ...p, agenda: e.target.value }))} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn onClick={save}>{editId ? "Save" : "Schedule"}</Btn></div>
        </Modal>
      )}
    </div>
  );
}

// ================= CALENDAR =================
export function CalendarPage() {
  const d = useDB();
  const nav = useNavigate();
  const [cursor, setCursor] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [selected, setSelected] = useState(todayISO());
  const today = todayISO();
  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`)];

  const eventsFor = (date: string) => {
    const ev: { label: string; kind: string; color: string; to: string }[] = [];
    d.followups.filter((f) => f.date === date && f.status !== "Cancelled").forEach((f) => ev.push({ label: `${f.type} · ${entityName(d, f.entityType, f.entityId) || ""}`, kind: "Follow-up", color: "bg-brand-500", to: "/followups" }));
    d.tasks.filter((t) => t.dueDate === date && t.status !== "Completed" && t.status !== "Cancelled").forEach((t) => ev.push({ label: t.title, kind: "Task due", color: "bg-amber-500", to: "/tasks" }));
    d.meetings.filter((m) => m.date === date).forEach((m) => ev.push({ label: `${m.start} ${m.title}`, kind: "Meeting", color: "bg-violet-500", to: "/meetings" }));
    d.invoices.filter((i) => i.dueDate === date && !["Paid", "Cancelled", "Draft"].includes(i.status)).forEach((i) => ev.push({ label: `${i.number} due`, kind: "Payment", color: "bg-red-500", to: "/invoices" }));
    return ev;
  };
  const selEvents = eventsFor(selected);
  return (
    <div className="mx-auto max-w-[1200px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Calendar</h1><p className="text-[12.5px] text-ink-500">Follow-ups, tasks, meetings and payment reminders in one view.</p></div>
        <div className="flex items-center gap-2">
          <Btn variant="outline" size="sm" onClick={() => setCursor(new Date(year, month - 1, 1))}><ChevronLeft size={14} /></Btn>
          <span className="hd min-w-[150px] text-center text-[15px]">{cursor.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</span>
          <Btn variant="outline" size="sm" onClick={() => setCursor(new Date(year, month + 1, 1))}><ChevronRight size={14} /></Btn>
          <Btn variant="ghost" size="sm" onClick={() => { const t = new Date(); setCursor(new Date(t.getFullYear(), t.getMonth(), 1)); setSelected(todayISO()); }}>Today</Btn>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="card overflow-hidden p-3">
          <div className="mb-2 grid grid-cols-7 text-center text-[10.5px] font-bold uppercase tracking-wider text-ink-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((w) => <div key={w} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((date, i) => {
              if (!date) return <div key={`e${i}`} className="min-h-[74px] rounded-md bg-ink-50/40 dark:bg-ink-800/20" />;
              const evs = eventsFor(date);
              return (
                <button key={date} onClick={() => setSelected(date)}
                  className={`min-h-[74px] rounded-md border p-1.5 text-left align-top transition-all hover:border-brand-300 ${selected === date ? "border-brand-400 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-900/20" : "border-ink-100 dark:border-ink-800"} ${date === today ? "bg-amber-50/60 dark:bg-amber-900/10" : ""}`}>
                  <span className={`num text-[11px] font-semibold ${date === today ? "text-amber-600" : "text-ink-500"}`}>{Number(date.slice(8, 10))}</span>
                  <div className="mt-1 space-y-0.5">
                    {evs.slice(0, 3).map((e, j) => <div key={j} className={`truncate rounded px-1 py-0.5 text-[9.5px] font-medium text-white ${e.color}`}>{e.label}</div>)}
                    {evs.length > 3 && <div className="num text-[9px] text-ink-400">+{evs.length - 3} more</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="card h-fit p-4">
          <h3 className="hd text-[14px]">{new Date(selected + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</h3>
          <div className="mt-3 space-y-2">
            {selEvents.length === 0 && <p className="text-[12.5px] text-ink-400">Nothing scheduled.</p>}
            {selEvents.map((e, i) => (
              <button key={i} onClick={() => nav(e.to)} className="flex w-full items-center gap-2.5 rounded-md border border-ink-100 p-2.5 text-left transition-all hover:border-brand-300 hover:shadow-sm dark:border-ink-800">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${e.color}`} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">{e.label}</span><span className="text-[10.5px] text-ink-400">{e.kind}</span></span>
              </button>
            ))}
          </div>
          <div className="mt-4 border-t border-ink-100 pt-3 dark:border-ink-800">
            <div className="space-y-1 text-[10.5px] text-ink-400">
              {[["bg-brand-500", "Follow-up"], ["bg-amber-500", "Task due"], ["bg-violet-500", "Meeting"], ["bg-red-500", "Payment due"]].map(([c, l]) => (
                <div key={l} className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${c}`} />{l}</div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
