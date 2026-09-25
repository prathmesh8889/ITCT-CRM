import { useEffect, useMemo, useState } from "react";
import { EyeOff, RotateCcw, Save, Search, ShieldCheck, UserCog, Users } from "lucide-react";
import { api } from "../lib/api";
import { Badge, Btn, Input, Select } from "../components/ui";
import { useStore } from "../store";

type AccessUser = {
  id: number;
  name: string;
  email: string;
  department: string;
  designation: string;
  role_id: number | null;
  role_name: string;
  team_id: number | null;
  team_name: string;
  active: boolean;
  protected: boolean;
  role_perms: Record<string, string[]>;
  role_default_perms: Record<string, string[]>;
  overrides: Record<string, string[]>;
  effective_perms: Record<string, string[]>;
};

type AccessPayload = {
  modules: string[];
  perms: string[];
  users: AccessUser[];
};

const LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  targets: "Sales Targets",
  leads: "Leads",
  ads: "Ads Leads",
  discovery: "Lead Discovery",
  customers: "Customers",
  companies: "Companies",
  contacts: "Contacts",
  deals: "Pipeline / Deals",
  followups: "Follow-ups",
  tasks: "Tasks",
  meetings: "Meetings",
  calendar: "Calendar",
  calls: "Calls",
  products: "Products & Services",
  quotations: "Quotations",
  invoices: "Invoices",
  payments: "Payments",
  expenses: "Expenses",
  employees: "Employees",
  teams: "Teams",
  departments: "Departments",
  access_levels: "Access Levels",
  reports: "Reports & Analytics",
  notifications: "Notifications",
  automation: "Automation Rules",
  audit: "Audit Log",
  settings: "Settings",
};

const GROUP: Record<string, string> = {
  dashboard: "Overview", reports: "Overview",
  targets: "Sales", leads: "Sales", ads: "Sales", discovery: "Sales", customers: "Sales", companies: "Sales", contacts: "Sales", deals: "Sales",
  followups: "Workflow", tasks: "Workflow", meetings: "Workflow", calendar: "Workflow", calls: "Workflow",
  products: "Finance", quotations: "Finance", invoices: "Finance", payments: "Finance", expenses: "Finance",
  employees: "Administration", teams: "Administration", departments: "Administration", access_levels: "Administration",
  automation: "Administration", audit: "Administration", settings: "Administration", notifications: "Administration",
};

const PERM_LABEL: Record<string, string> = {
  view: "View",
  create: "Add",
  edit: "Edit",
  delete: "Delete",
  assign: "Assign",
  export: "Export",
  approve: "Approve",
};

const cloneMap = (m: Record<string, string[]> = {}) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));

export default function AccessControl() {
  const { toast } = useStore();
  const [data, setData] = useState<AccessPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async (keepId?: number | null) => {
    setLoading(true);
    try {
      const r = await api.get<AccessPayload>("/access-control/users");
      const payload = r.data;
      setData(payload);
      const id = keepId && payload.users.some((u) => u.id === keepId)
        ? keepId
        : payload.users.find((u) => !u.protected)?.id ?? payload.users[0]?.id ?? null;
      setSelectedId(id);
      const picked = payload.users.find((u) => u.id === id);
      setDraft(cloneMap(picked?.overrides || {}));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load employee access settings", "err");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const selected = data?.users.find((u) => u.id === selectedId) || null;
  const hasOverride = (module: string) => Object.prototype.hasOwnProperty.call(draft, module);
  const shownPerms = (module: string) =>
    hasOverride(module) ? (draft[module] || []) : (selected?.role_default_perms?.[module] || []);

  const selectUser = (id: number) => {
    const u = data?.users.find((x) => x.id === id);
    setSelectedId(id);
    setDraft(cloneMap(u?.overrides || {}));
  };

  const togglePerm = (module: string, perm: string, checked: boolean) => {
    if (!selected || selected.protected) return;
    const current = new Set(shownPerms(module));
    if (checked) {
      current.add(perm);
      if (perm !== "view") current.add("view");
    } else {
      current.delete(perm);
      if (perm === "view") current.clear();
    }
    setDraft((d) => ({ ...d, [module]: [...current] }));
  };

  const useRoleDefault = (module: string) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[module];
      return next;
    });
  };

  const hidePage = (module: string) => setDraft((d) => ({ ...d, [module]: [] }));
  const fullAccess = (module: string) =>
    setDraft((d) => ({ ...d, [module]: [...(data?.perms || [])] }));

  const changed = useMemo(() => {
    if (!selected) return false;
    return JSON.stringify(draft) !== JSON.stringify(selected.overrides || {});
  }, [draft, selected]);

  const save = async () => {
    if (!selected || selected.protected) return;
    setSaving(true);
    try {
      const r = await api.patch<{ overrides: Record<string, string[]>; effective_perms: Record<string, string[]> }>(
        `/access-control/users/${selected.id}`,
        { overrides: draft },
      );
      setData((prev) => prev ? {
        ...prev,
        users: prev.users.map((u) => u.id === selected.id
          ? { ...u, overrides: cloneMap(r.data.overrides), effective_perms: cloneMap(r.data.effective_perms) }
          : u),
      } : prev);
      setDraft(cloneMap(r.data.overrides));
      toast("Employee access updated", "ok", "The new permissions are enforced by the backend immediately.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save employee access", "err");
    } finally { setSaving(false); }
  };

  const resetAll = async () => {
    if (!selected || selected.protected) return;
    if (!window.confirm(`Reset all custom access for ${selected.name} to the ${selected.role_name} role defaults?`)) return;
    setSaving(true);
    try {
      const r = await api.delete<{ effective_perms: Record<string, string[]> }>(`/access-control/users/${selected.id}`);
      setData((prev) => prev ? {
        ...prev,
        users: prev.users.map((u) => u.id === selected.id
          ? { ...u, overrides: {}, effective_perms: cloneMap(r.data.effective_perms) }
          : u),
      } : prev);
      setDraft({});
      toast("Role defaults restored", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reset employee access", "err");
    } finally { setSaving(false); }
  };

  const employees = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.users || []).filter((u) =>
      !q || `${u.name} ${u.email} ${u.role_name} ${u.department} ${u.team_name}`.toLowerCase().includes(q));
  }, [data?.users, query]);

  const modules = useMemo(() => {
    const list = data?.modules || [];
    return list.filter((m) => group === "All" || (GROUP[m] || "Other") === group);
  }, [data?.modules, group]);

  const customCount = Object.keys(draft).length;

  return (
    <div className="mx-auto max-w-[1480px] p-3 sm:p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={22} className="text-brand-600" />
            <h1 className="hd text-[22px]">Employee Access Control</h1>
          </div>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-500">
            Super Admin can control exactly which CRM pages and actions each employee can use. Custom employee access overrides the role default for that page.
          </p>
        </div>
        {selected && !selected.protected && (
          <div className="flex flex-wrap gap-2">
            <Btn variant="outline" size="sm" disabled={!customCount || saving} onClick={() => void resetAll()}>
              <RotateCcw size={13} /> Reset to role defaults
            </Btn>
            <Btn size="sm" loading={saving} disabled={!changed} onClick={() => void save()}>
              <Save size={13} /> Save access
            </Btn>
          </div>
        )}
      </div>

      <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50/70 p-3 text-[12px] leading-relaxed text-brand-900 dark:border-brand-900/60 dark:bg-brand-950/25 dark:text-brand-200">
        <strong>How it works:</strong> turn off <strong>View</strong> to hide a page and block its API access. Add/Edit/Delete/Assign/Export/Approve are also enforced by the backend, not only hidden in the UI. Super Admin access itself is protected and cannot be restricted.
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="card h-fit overflow-hidden lg:sticky lg:top-3">
          <div className="border-b border-ink-100 p-3 dark:border-ink-800">
            <div className="mb-2 flex items-center gap-2"><Users size={15} /><span className="hd text-[13px]">Employees</span></div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder="Search employee…" />
            </div>
          </div>
          <div className="max-h-[65vh] overflow-y-auto p-1.5">
            {loading && <div className="p-4 text-center text-[12px] text-ink-400">Loading employees…</div>}
            {!loading && employees.map((u) => (
              <button key={u.id} onClick={() => selectUser(u.id)}
                className={`mb-1 w-full rounded-md px-3 py-2.5 text-left transition-colors ${selectedId === u.id ? "bg-brand-50 text-brand-800 dark:bg-brand-950/35 dark:text-brand-200" : "hover:bg-ink-50 dark:hover:bg-ink-800/60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-semibold">{u.name}</div>
                    <div className="mt-0.5 truncate text-[10.5px] text-ink-400">{u.email}</div>
                  </div>
                  {u.protected ? <Badge tone="red">Protected</Badge> : Object.keys(u.overrides || {}).length > 0 ? <Badge tone="amber">Custom</Badge> : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-ink-400">
                  <span>{u.role_name}</span>{u.department && <span>· {u.department}</span>}
                </div>
              </button>
            ))}
            {!loading && employees.length === 0 && <div className="p-4 text-center text-[12px] text-ink-400">No employees found.</div>}
          </div>
        </aside>

        <section className="min-w-0">
          {!selected ? (
            <div className="card p-10 text-center text-[13px] text-ink-500"><UserCog size={28} className="mx-auto mb-2 text-ink-300" />Select an employee to manage access.</div>
          ) : (
            <>
              <div className="card mb-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="hd text-[17px]">{selected.name}</h2>
                      <Badge tone={selected.active ? "green" : "slate"}>{selected.active ? "Active" : "Disabled"}</Badge>
                      <Badge tone={selected.protected ? "red" : customCount ? "amber" : "blue"}>
                        {selected.protected ? "Super Admin protected" : customCount ? `${customCount} custom page rule(s)` : "Role defaults"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11.5px] text-ink-500">
                      {selected.role_name}{selected.designation ? ` · ${selected.designation}` : ""}{selected.department ? ` · ${selected.department}` : ""}{selected.team_name ? ` · ${selected.team_name}` : ""}
                    </div>
                  </div>
                  <Select className="!w-auto" value={group} onChange={(e) => setGroup(e.target.value)}>
                    {["All", "Overview", "Sales", "Workflow", "Finance", "Administration", "Other"].map((g) => <option key={g}>{g}</option>)}
                  </Select>
                </div>
              </div>

              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px]">
                    <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50">
                      <tr>
                        <th className="th sticky left-0 z-10 min-w-[230px] bg-ink-50/95 dark:bg-ink-800/95">Page / Module</th>
                        <th className="th">Mode</th>
                        {(data?.perms || []).map((p) => <th key={p} className="th text-center">{PERM_LABEL[p] || p}</th>)}
                        <th className="th text-right">Quick</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modules.map((m) => {
                        const list = shownPerms(m);
                        const custom = hasOverride(m);
                        return (
                          <tr key={m} className="border-b border-ink-100 last:border-0 dark:border-ink-800/70">
                            <td className="td sticky left-0 z-[5] bg-surface dark:bg-ink-900">
                              <div className="font-semibold">{LABELS[m] || m}</div>
                              <div className="mt-0.5 text-[10px] text-ink-400">{GROUP[m] || "Other"} · {m}</div>
                            </td>
                            <td className="td">
                              {selected.protected ? <Badge tone="red">Full access</Badge> : custom ? (
                                <button className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10.5px] font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300" onClick={() => useRoleDefault(m)}>
                                  Custom · use role default
                                </button>
                              ) : <Badge tone="slate">Role default</Badge>}
                            </td>
                            {(data?.perms || []).map((p) => {
                              const checked = list.includes(p);
                              return (
                                <td key={p} className="td text-center">
                                  <label className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${checked ? "border-brand-500 bg-brand-50 dark:bg-brand-950/30" : "border-ink-200 dark:border-ink-700"} ${selected.protected ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-brand-400"}`}>
                                    <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--brand-600)]" disabled={selected.protected} checked={checked}
                                      onChange={(e) => togglePerm(m, p, e.target.checked)} />
                                  </label>
                                </td>
                              );
                            })}
                            <td className="td">
                              {!selected.protected && <div className="flex justify-end gap-1">
                                <Btn size="xs" variant="ghost" onClick={() => hidePage(m)}><EyeOff size={11} /> Hide</Btn>
                                <Btn size="xs" variant="outline" onClick={() => fullAccess(m)}>Full</Btn>
                              </div>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {changed && !selected.protected && (
                <div className="sticky bottom-3 mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 shadow-lg dark:border-amber-900 dark:bg-amber-950/80">
                  <div className="text-[11.5px] text-amber-800 dark:text-amber-200">You have unsaved access changes for {selected.name}.</div>
                  <Btn size="sm" loading={saving} onClick={() => void save()}><Save size={13} /> Save access</Btn>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
