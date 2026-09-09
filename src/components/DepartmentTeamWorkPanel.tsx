import { useEffect, useState } from "react";
import { Briefcase, CalendarDays, ListChecks, RefreshCw, Users } from "lucide-react";
import { api } from "../lib/api";
import { useStore } from "../store";
import { Badge, Btn } from "./ui";

type WorkItem = {
  type: "Task" | "Project";
  id: number;
  code?: string;
  title: string;
  description?: string;
  status: string;
  priority?: string | null;
  progress?: number | null;
  due_date?: string | null;
  last_update?: string;
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
  employee_count: number;
  employees: DepartmentEmployee[];
};

const shortDate = (value?: string | null) => value ? String(value).slice(0, 10) : "—";

export default function DepartmentTeamWorkPanel() {
  const { roleName, toast } = useStore();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

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

  // Global admins can use the normal organization pages. This panel is designed
  // for department/team/employee logins so the scope difference is immediately visible.
  if (["Super Admin", "Admin"].includes(roleName)) return null;

  return <section className="mx-auto max-w-[1380px] px-3 pt-3 sm:px-4 md:px-6 md:pt-6">
    <div className="card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-ink-100 p-4 dark:border-ink-800 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2"><Badge tone="green">Live scope</Badge>{data && <Badge tone="violet">L{data.level}</Badge>}<Badge tone="slate">{data?.scope || "department"}</Badge></div>
          <h2 className="hd flex items-center gap-2 text-[18px]"><Users size={18}/>Department Employees & Current Work</h2>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">Login scope decides which employees and work are visible. L3 sees the department, L4 sees the team, and L5/L6 see only their own workspace.</p>
        </div>
        <Btn size="xs" variant="outline" loading={loading} onClick={() => void load()}><RefreshCw size={12}/>Refresh</Btn>
      </div>

      {loading ? <div className="p-8 text-center text-[12px] text-ink-400">Loading department employees and work…</div> : !data ? <div className="p-8 text-center text-[12px] text-ink-400">No department overview is available for this role.</div> : <div className="p-4">
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-brand-100 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-950/20 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-bold text-[13px]">{data.department.name}</div><div className="mt-0.5 text-[10.5px] text-ink-500">Visible according to your {data.scope} scope</div></div>
          <Badge tone="green">{data.employee_count} visible employee{data.employee_count === 1 ? "" : "s"}</Badge>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.employees.map((employee) => <article key={employee.id} className="rounded-xl border border-ink-100 bg-surface p-3.5 dark:border-ink-800 dark:bg-ink-900">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><strong className="truncate text-[13.5px]">{employee.name}</strong><Badge tone="amber">L{employee.access_level}</Badge></div><div className="mt-1 text-[11px] font-semibold text-ink-600 dark:text-ink-300">{employee.role_name}</div>{employee.team_name && <div className="mt-0.5 text-[10.5px] text-ink-400">Team: {employee.team_name}</div>}{employee.reporting_manager_name && <div className="mt-0.5 text-[10.5px] text-ink-400">Reports to: {employee.reporting_manager_name}</div>}</div>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><Briefcase size={15}/></span>
            </div>

            {employee.primary_function && <div className="mt-3 rounded-lg bg-ink-50 p-2.5 text-[10.5px] leading-relaxed text-ink-500 dark:bg-ink-800/50">{employee.primary_function}</div>}

            <div className="mt-3"><div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-ink-400"><ListChecks size={12}/>Current Work</div>{employee.work_items.length === 0 ? <div className="rounded-lg border border-dashed border-ink-200 p-3 text-center text-[10.5px] text-ink-400 dark:border-ink-700">No work assigned.</div> : <div className="space-y-2">{employee.work_items.slice(0, 4).map((work) => <div key={`${work.type}-${work.id}`} className="rounded-lg border border-ink-100 p-2.5 dark:border-ink-800"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex flex-wrap items-center gap-1"><Badge tone={work.type === "Project" ? "violet" : "slate"}>{work.type}</Badge>{work.priority && <Badge tone={work.priority === "High" ? "red" : work.priority === "Low" ? "slate" : "amber"}>{work.priority}</Badge>}</div><div className="mt-1.5 text-[11.5px] font-semibold leading-snug">{work.title}</div></div><Badge tone={work.status === "Completed" ? "green" : "slate"}>{work.status}</Badge></div>{work.progress != null && <div className="mt-2"><div className="mb-1 flex justify-between text-[9.5px] text-ink-400"><span>Progress</span><span>{work.progress}%</span></div><div className="h-1.5 rounded-full bg-ink-100 dark:bg-ink-800"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(0, Math.min(100, work.progress))}%` }}/></div></div>}<div className="mt-2 flex items-center gap-1 text-[9.5px] text-ink-400"><CalendarDays size={10}/>Due {shortDate(work.due_date)}</div></div>)}</div>}</div>
            <div className="mt-3 truncate border-t border-ink-100 pt-2 text-[9.5px] text-ink-400 dark:border-ink-800">{employee.email}</div>
          </article>)}
        </div>
      </div>}
    </div>
  </section>;
}
