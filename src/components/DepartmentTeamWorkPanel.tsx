import { useEffect, useMemo, useState } from "react";
import { Briefcase, CalendarDays, ListChecks, Plus, RefreshCw, Users } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { Badge, Btn, Field, Input, Modal, Select, Textarea } from "./ui";

type WorkItem = {
  type: "Task" | "Project" | "Meeting" | "Follow-up";
  id: number;
  code?: string;
  title: string;
  description?: string;
  status: string;
  priority?: string | null;
  progress?: number | null;
  due_date?: string | null;
  time?: string;
  location?: string;
  last_update?: string;
};

type ActivityItem = Omit<WorkItem, "type"> & {
  type: WorkItem["type"] | "Event" | "Holiday" | "Service Record";
  assigned_user_name?: string;
  created_by_name?: string;
  participant_names?: string[];
};

type DepartmentEmployee = {
  id: number;
  name: string;
  email: string;
  phone?: string;
  access_level: number;
  role_name: string;
  primary_function?: string;
  team_name?: string | null;
  reporting_manager_name?: string | null;
  work_items: WorkItem[];
};

type Overview = {
  department: { key: string; name: string; strategic_context?: string };
  scope: "global" | "department" | "team" | "self";
  level: number;
  can_manage: boolean;
  employee_count: number;
  employees: DepartmentEmployee[];
  activity: ActivityItem[];
};

const shortDate = (value?: string | null) => value ? String(value).slice(0, 10) : "—";
const today = () => new Date().toISOString().slice(0, 10);
const afterDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const activityTone = (type: ActivityItem["type"]): "violet" | "amber" | "green" | "slate" =>
  type === "Project" ? "violet" : type === "Event" || type === "Holiday" ? "amber" : type === "Task" ? "green" : "slate";

export default function DepartmentTeamWorkPanel() {
  const { roleName, toast } = useStore();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [task, setTask] = useState({ employeeId: "", title: "", description: "", priority: "Medium", dueDate: afterDays(3) });
  const [event, setEvent] = useState({ title: "", kind: "event", date: today(), start: "10:00", end: "11:00", location: "", description: "" });

  const load = async () => {
    setLoading(true);
    try {
      const response = await api.get<Overview>("/workforce/department-overview");
      setData(response.data);
    } catch (error) {
      setData(null);
      toast(error instanceof Error ? error.message : "Could not load department team work", "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const assignable = useMemo(() => (data?.employees || []).filter((employee) => employee.access_level >= 4), [data?.employees]);

  const openTask = () => {
    const first = assignable.find((x) => x.access_level >= 5) || assignable[0];
    setTask({ employeeId: first ? String(first.id) : "", title: "", description: "", priority: "Medium", dueDate: afterDays(3) });
    setTaskOpen(true);
  };

  const saveTask = async () => {
    if (!task.employeeId) { toast("Select an employee", "err"); return; }
    if (!task.title.trim()) { toast("Task title is required", "err"); return; }
    setBusy(true);
    try {
      await api.post("/workforce/department-tasks", {
        department_key: data?.department.key,
        assigned_user_id: Number(task.employeeId),
        title: task.title.trim(),
        description: task.description.trim(),
        priority: task.priority,
        due_date: task.dueDate || null,
      });
      toast("Task assigned", "ok", "It is now visible in the employee's Current Work.");
      setTaskOpen(false);
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not assign task", "err");
    } finally { setBusy(false); }
  };

  const saveEvent = async () => {
    if (!event.title.trim()) { toast("Event title is required", "err"); return; }
    if (!event.date) { toast("Event date is required", "err"); return; }
    setBusy(true);
    try {
      await api.post("/workforce/department-events", {
        department_key: data?.department.key,
        title: event.title.trim(),
        kind: event.kind,
        date: event.date,
        start_time: event.kind === "holiday" ? "" : event.start,
        end_time: event.kind === "holiday" ? "" : event.end,
        all_day: event.kind === "holiday",
        location: event.location.trim(),
        description: event.description.trim(),
      });
      toast(event.kind === "holiday" ? "Holiday added" : "Department event added", "ok", "It is now visible in Department Activity and the department calendar.");
      setEventOpen(false);
      setEvent({ title: "", kind: "event", date: today(), start: "10:00", end: "11:00", location: "", description: "" });
      await load();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create event", "err");
    } finally { setBusy(false); }
  };

  // Global admins can use the normal organization pages. This panel is designed
  // for department/team/employee logins so the scope difference is immediately visible.
  if (["Super Admin", "Admin"].includes(roleName)) return null;

  return <section className="mx-auto max-w-[1380px] px-3 pt-3 sm:px-4 md:px-6 md:pt-6">
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-ink-100 p-4 dark:border-ink-800 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="green">Live scope</Badge>{data && <Badge tone="violet">L{data.level}</Badge>}<Badge tone="slate">{data?.scope || "department"}</Badge></div>
          <h2 className="hd flex items-center gap-2 text-[18px]"><Users size={18}/>Department Employees & Current Work</h2>
          <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-ink-500">Tasks assigned by a Department Head/Team Lead appear under that employee immediately. Department events, meetings, projects, follow-ups and service records are also collected into the live department activity stream.</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {data?.can_manage && <Btn size="xs" onClick={openTask}><Plus size={12}/>Assign Task</Btn>}
          {data?.can_manage && <Btn size="xs" variant="outline" onClick={() => setEventOpen(true)}><CalendarDays size={12}/>Add Event</Btn>}
          <Btn size="xs" variant="outline" loading={loading} onClick={() => void load()}><RefreshCw size={12}/>Refresh</Btn>
        </div>
      </div>

      {loading ? <div className="p-8 text-center text-[12px] text-ink-400">Loading department employees and work…</div> : !data ? <div className="p-8 text-center text-[12px] text-ink-400">No department overview is available for this role.</div> : <div className="p-4">
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/20 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-bold text-[13px]">{data.department.name}</div><div className="mt-0.5 text-[10.5px] text-ink-500">Visible according to your {data.scope} scope</div></div>
          <Badge tone="green">{data.employee_count} visible employee{data.employee_count === 1 ? "" : "s"}</Badge>
        </div>

        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between gap-2"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-400"><CalendarDays size={12}/>Department Activity</div><Badge tone="slate">Latest {Math.min(data.activity.length, 12)}</Badge></div>
          {data.activity.length === 0 ? <div className="rounded-lg border border-dashed border-ink-200 p-4 text-center text-[11px] text-ink-400 dark:border-ink-700">No department activity yet.</div> : <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{data.activity.slice(0, 12).map((item) => <div key={`${item.type}-${item.id}-${item.title}`} className="rounded-lg border border-ink-100 p-3 dark:border-ink-800"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1"><Badge tone={activityTone(item.type)}>{item.type}</Badge>{item.assigned_user_name && <Badge tone="slate">{item.assigned_user_name}</Badge>}</div><div className="mt-1.5 text-[11.5px] font-semibold leading-snug">{item.title}</div></div><Badge tone={item.status === "Completed" || item.status === "Approved" ? "green" : "slate"}>{item.status}</Badge></div>{item.description && <div className="mt-1.5 line-clamp-2 text-[10.5px] text-ink-400">{item.description}</div>}<div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9.5px] text-ink-400">{item.due_date && <span>{item.type === "Event" || item.type === "Holiday" || item.type === "Meeting" ? "Date" : "Due"}: {shortDate(item.due_date)}</span>}{item.time && <span>{item.time}</span>}{item.location && <span>{item.location}</span>}{item.participant_names?.length ? <span>{item.participant_names.join(", ")}</span> : null}{item.created_by_name && <span>By {item.created_by_name}</span>}</div></div>)}</div>}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.employees.map((employee) => <article key={employee.id} className="rounded-xl border border-ink-100 bg-surface p-3.5 dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><strong className="truncate text-[13.5px]">{employee.name}</strong><Badge tone="amber">L{employee.access_level}</Badge></div><div className="mt-1 text-[11px] font-semibold text-ink-600 dark:text-ink-300">{employee.role_name}</div>{employee.team_name && <div className="mt-0.5 text-[10.5px] text-ink-400">Team: {employee.team_name}</div>}{employee.reporting_manager_name && <div className="mt-0.5 text-[10.5px] text-ink-400">Reports to: {employee.reporting_manager_name}</div>}</div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><Briefcase size={15}/></span>
            </div>

            {employee.primary_function && <div className="mt-3 rounded-lg bg-ink-50 p-2.5 text-[10.5px] leading-relaxed text-ink-500 dark:bg-ink-800/50">{employee.primary_function}</div>}

            <div className="mt-3"><div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-400"><ListChecks size={12}/>Current Work</div>{employee.work_items.length === 0 ? <div className="rounded-lg border border-dashed border-ink-200 p-3 text-center text-[10.5px] text-ink-400 dark:border-ink-700">No work assigned.</div> : <div className="space-y-2">{employee.work_items.slice(0, 6).map((work) => <div key={`${work.type}-${work.id}`} className="rounded-lg border border-ink-100 p-2.5 dark:border-ink-800"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1"><Badge tone={work.type === "Project" ? "violet" : work.type === "Task" ? "green" : "slate"}>{work.type}</Badge>{work.priority && <Badge tone={work.priority === "High" || work.priority === "Urgent" ? "red" : work.priority === "Low" ? "slate" : "amber"}>{work.priority}</Badge>}</div><div className="mt-1.5 text-[11.5px] font-semibold leading-snug">{work.title}</div></div><Badge tone={work.status === "Completed" ? "green" : "slate"}>{work.status}</Badge></div>{work.progress != null && <div className="mt-2"><div className="mb-1 flex justify-between text-[9.5px] text-ink-400"><span>Progress</span><span>{work.progress}%</span></div><div className="h-1.5 rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, work.progress))}%` }}/></div></div>}<div className="mt-2 flex flex-wrap items-center gap-2 text-[9.5px] text-ink-400"><span className="flex items-center gap-1"><CalendarDays size={10}/>{work.type === "Meeting" ? "Date" : "Due"} {shortDate(work.due_date)}</span>{work.time && <span>{work.time}</span>}{work.location && <span>{work.location}</span>}</div></div>)}</div>}</div>
            <div className="mt-3 truncate border-t border-ink-100 pt-2 text-[9.5px] text-ink-400 dark:border-ink-800">{employee.email}</div>
          </article>)}
        </div>
      </div>}
    </div>

    {taskOpen && <Modal open wide onClose={() => !busy && setTaskOpen(false)} title="Assign Department Task" footer={<><Btn variant="ghost" onClick={() => setTaskOpen(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void saveTask()}>Assign Task</Btn></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee" req><Select value={task.employeeId} onChange={(e) => setTask((p) => ({ ...p, employeeId: e.target.value }))}><option value="">Select employee</option>{assignable.map((employee) => <option key={employee.id} value={employee.id}>L{employee.access_level} · {employee.name} · {employee.role_name}</option>)}</Select></Field>
        <Field label="Priority"><Select value={task.priority} onChange={(e) => setTask((p) => ({ ...p, priority: e.target.value }))}>{["Low", "Medium", "High", "Urgent"].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Task title" req><Input value={task.title} onChange={(e) => setTask((p) => ({ ...p, title: e.target.value }))} placeholder="What should this employee complete?" /></Field>
        <Field label="Due date"><Input type="date" value={task.dueDate} onChange={(e) => setTask((p) => ({ ...p, dueDate: e.target.value }))} /></Field>
        <div className="sm:col-span-2"><Field label="Description"><Textarea value={task.description} onChange={(e) => setTask((p) => ({ ...p, description: e.target.value }))} placeholder="Expected output, notes or acceptance criteria" /></Field></div>
      </div>
    </Modal>}

    {eventOpen && <Modal open wide onClose={() => !busy && setEventOpen(false)} title="Add Department Event" footer={<><Btn variant="ghost" onClick={() => setEventOpen(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void saveEvent()}>{event.kind === "holiday" ? "Add Holiday" : "Add Event"}</Btn></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type"><Select value={event.kind} onChange={(e) => setEvent((p) => ({ ...p, kind: e.target.value }))}><option value="event">Event</option><option value="holiday">Holiday</option></Select></Field>
        <Field label="Date" req><Input type="date" value={event.date} onChange={(e) => setEvent((p) => ({ ...p, date: e.target.value }))} /></Field>
        <Field label="Title" req><Input value={event.title} onChange={(e) => setEvent((p) => ({ ...p, title: e.target.value }))} placeholder="Department review / client meeting / training" /></Field>
        <Field label="Location"><Input value={event.location} onChange={(e) => setEvent((p) => ({ ...p, location: e.target.value }))} placeholder="Office / Online / Client site" /></Field>
        {event.kind === "event" && <><Field label="Start time"><Input type="time" value={event.start} onChange={(e) => setEvent((p) => ({ ...p, start: e.target.value }))} /></Field><Field label="End time"><Input type="time" value={event.end} onChange={(e) => setEvent((p) => ({ ...p, end: e.target.value }))} /></Field></>}
        <div className="sm:col-span-2"><Field label="Description"><Textarea value={event.description} onChange={(e) => setEvent((p) => ({ ...p, description: e.target.value }))} /></Field></div>
      </div>
    </Modal>}
  </section>;
}
