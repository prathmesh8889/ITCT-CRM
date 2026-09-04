import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, BarChart3, Target, Radar, LayoutGrid, Users, PhoneCall, ListChecks,
  CalendarDays, Calendar, FileText, Receipt, Package, Bot, Briefcase, Zap, History, Settings,
  Bell, Search, Sun, Moon, Menu as MenuIcon, X, LogOut, CheckCheck, ChevronLeft, Database,
} from "lucide-react";
import { useStore } from "../store";
import { useDB } from "../lib/db";
import { globalSearch, timeAgo, todayISO } from "../lib/services";
import { DEMO_MODE, backendAvailable, notificationApi, searchApi } from "../lib/api";
import type { ApiNotice } from "../lib/apiTypes";
import { Avatar, Badge, ToastHost, statusTone } from "./ui";
import type { ModuleKey } from "../lib/types";

const NAV: { section: string; items: { to: string; label: string; icon: typeof Target; mod: ModuleKey }[] }[] = [
  { section: "Overview", items: [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, mod: "dashboard" },
    { to: "/reports", label: "Reports & Analytics", icon: BarChart3, mod: "reports" },
  ]},
  { section: "Sales", items: [
    { to: "/leads", label: "Leads", icon: Target, mod: "leads" },
    { to: "/discovery", label: "Lead Discovery", icon: Radar, mod: "discovery" },
    { to: "/pipeline", label: "Pipeline", icon: LayoutGrid, mod: "deals" },
    { to: "/customers", label: "Customers", icon: Users, mod: "customers" },
  ]},
  { section: "Workflow", items: [
    { to: "/followups", label: "Follow-ups", icon: PhoneCall, mod: "followups" },
    { to: "/tasks", label: "Tasks", icon: ListChecks, mod: "tasks" },
    { to: "/meetings", label: "Meetings", icon: CalendarDays, mod: "meetings" },
    { to: "/calendar", label: "Calendar", icon: Calendar, mod: "calendar" },
  ]},
  { section: "Finance", items: [
    { to: "/quotations", label: "Quotations", icon: FileText, mod: "quotations" },
    { to: "/invoices", label: "Invoices & Payments", icon: Receipt, mod: "invoices" },
    { to: "/products", label: "Products", icon: Package, mod: "products" },
  ]},
  { section: "Intelligence", items: [
    { to: "/assistant", label: "AI Assistant", icon: Bot, mod: "ai" },
  ]},
  { section: "Administration", items: [
    { to: "/employees", label: "Employees & Roles", icon: Briefcase, mod: "employees" },
    { to: "/automation", label: "Automation Rules", icon: Zap, mod: "automation" },
    { to: "/audit", label: "Audit Log", icon: History, mod: "audit" },
    { to: "/settings", label: "Settings", icon: Settings, mod: "settings" },
  ]},
];

function SideNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can, user, roleName } = useStore();
  const d = useDB();
  const fuDue = DEMO_MODE ? d.followups.filter((f) => f.status === "Scheduled" && f.date <= todayISO()).length : 0;
  return (
    <nav className="flex h-full flex-col overflow-y-auto px-3 pb-4">
      <div className="mb-4 flex items-center gap-2.5 px-1.5 pt-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 shadow-lg shadow-brand-900/40">
          <svg viewBox="0 0 32 32" className="h-5.5 w-5.5" width="22" height="22"><path d="M6 21c4.5-1 5.5-8 9-8s4.5 7 11 6" stroke="#F2C879" strokeWidth="3" fill="none" strokeLinecap="round" /><circle cx="6" cy="21" r="2.6" fill="#fff" /><circle cx="26" cy="19" r="2.6" fill="#fff" /></svg>
        </span>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-display text-[16px] font-bold tracking-tight text-white">ITCT <span className="text-brand-300">CRM</span></div>
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/35">Lead → Revenue</div>
          </div>
        )}
      </div>
      {NAV.map((sec) => {
        const items = sec.items.filter((i) => can(i.mod, "view"));
        if (!items.length) return null;
        return (
          <div key={sec.section} className="mb-3">
            {!collapsed && <div className="mb-1 px-2 text-[9.5px] font-bold uppercase tracking-[0.16em] text-white/25">{sec.section}</div>}
            {items.map((it) => (
              <NavLink key={it.to} to={it.to} onClick={onNavigate}
                className={({ isActive }) => `group mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-all duration-150 ${isActive ? "bg-white/[0.09] text-white shadow-[inset_2px_0_0_#F2C879]" : "text-white/55 hover:bg-white/[0.05] hover:text-white/90"}`}>
                <it.icon size={16} className="shrink-0" />
                {!collapsed && <span className="flex-1">{it.label}</span>}
                {!collapsed && it.to === "/followups" && fuDue > 0 && (
                  <span className="num rounded-full bg-amber-400/90 px-1.5 text-[10px] font-bold text-ink-950">{fuDue}</span>
                )}
              </NavLink>
            ))}
          </div>
        );
      })}
      <div className="mt-auto pt-3">
        {!collapsed && user && (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2.5">
            <div className="flex items-center gap-2">
              <Avatar name={user.name} color={user.color} size={30} />
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[12.5px] font-semibold text-white/90">{user.name}</div>
                <div className="truncate text-[10.5px] text-white/40">{roleName || d.roles.find((r) => r.id === user.roleId)?.name}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const nav = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const localHits = useMemo(() => (DEMO_MODE ? globalSearch(q) : []), [q]);
  const [remoteHits, setRemoteHits] = useState<{ kind: string; title: string; sub: string; link: string }[]>([]);
  useEffect(() => {
    if (DEMO_MODE || q.trim().length < 2) { setRemoteHits([]); return; }
    const t = setTimeout(() => {
      searchApi.get(q.trim()).then((r) => {
        const data = r.data as Record<string, { id: number; label: string; sub: string }[]>;
        const kindLink: [string, string][] = [["leads", "/leads"], ["customers", "/customers"], ["companies", "/customers"],
          ["contacts", "/customers"], ["deals", "/pipeline"], ["quotations", "/quotations"], ["invoices", "/invoices"]];
        const out: { kind: string; title: string; sub: string; link: string }[] = [];
        for (const [key, link] of kindLink) {
          for (const x of data[key] || []) {
            out.push({ kind: key === "leads" ? "Lead" : key === "customers" ? "Customer" : key === "companies" ? "Company"
              : key === "contacts" ? "Contact" : key === "deals" ? "Deal" : key === "quotations" ? "Quote" : "Invoice",
              title: x.label, sub: x.sub || "", link: `${link}?open=${x.id}` });
          }
        }
        setRemoteHits(out.slice(0, 12));
      }).catch(() => setRemoteHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const hits = DEMO_MODE ? localHits : remoteHits;
  return (
    <div className="relative hidden min-w-0 flex-1 max-w-md md:block">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
        placeholder="Search leads, customers, deals, invoices…  (Ctrl+K)"
        className="inp pl-9 bg-ink-100/50 border-transparent focus:bg-white dark:bg-ink-800/70 dark:focus:bg-ink-800" />
      {focus && q.trim().length >= 2 && (
        <div className="a-scale-in absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-2xl dark:border-ink-700 dark:bg-ink-900">
          {hits.length === 0 && <div className="px-4 py-3 text-[13px] text-ink-500">No matches for “{q}”</div>}
          <div className="max-h-80 overflow-y-auto py-1">
            {hits.map((h, i) => (
              <button key={i} onMouseDown={() => { nav(h.link); setQ(""); }}
                className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-brand-50 dark:hover:bg-ink-800">
                <Badge tone={statusTone(h.kind === "Lead" ? "New" : h.kind === "Invoice" ? "Sent" : "Qualified")}>{h.kind}</Badge>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink-800 dark:text-ink-100">{h.title}</span>
                  <span className="block truncate text-[11px] text-ink-400">{h.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NoticesBell() {
  const { user } = useStore();
  const d = useDB();
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<ApiNotice[]>([]);
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // production: poll the backend bell every 30s
  useEffect(() => {
    if (DEMO_MODE || !user) return;
    let live = true;
    const fetchN = () => notificationApi.list().then((r) => { if (live) setRemote(r.data as ApiNotice[]); }).catch(() => {});
    fetchN();
    const iv = setInterval(fetchN, 30000);
    return () => { live = false; clearInterval(iv); };
  }, [user]);
  if (!user) return null;
  const isMgr = ["r_super", "r_admin", "r_mgr"].includes(user.roleId);
  const demoList = d.notices.filter((n) => n.userId === user.id || (n.userId === "managers" && isMgr))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
  const list: { id: string; title: string; body: string; read: boolean; at: string; link: string }[] = DEMO_MODE
    ? demoList
    : remote.map((n) => ({ id: String(n.id), title: n.title, body: n.body, read: n.read, at: n.at, link: n.link }));
  const unread = list.filter((n) => !n.read).length;
  const markAll = () => {
    if (!DEMO_MODE) { notificationApi.readAll().then(() => setRemote((r) => r.map((n) => ({ ...n, read: true })))).catch(() => {}); return; }
    const { mutate } = require_db();
    mutate((db) => { db.notices.forEach((n) => { if (demoList.some((x) => x.id === n.id)) n.read = true; }); });
  };
  const markOne = (id: string) => {
    if (!DEMO_MODE) {
      notificationApi.markRead(Number(id)).then(() => setRemote((r) => r.map((n) => (String(n.id) === id ? { ...n, read: true } : n)))).catch(() => {});
    } else {
      const { mutate } = require_db();
      mutate((db) => { const x = db.notices.find((y) => y.id === id); if (x) x.read = true; });
    }
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-100">
        <Bell size={17} />
        {unread > 0 && (
          <>
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9.5px] font-bold text-white">{unread}</span>
            <span className="absolute right-1 top-1 h-4 w-4 rounded-full bg-red-500" style={{ animation: "pingSoft 1.6s ease-out infinite" }} />
          </>
        )}
      </button>
      {open && (
        <div className="a-scale-in absolute right-0 top-full z-50 mt-1.5 w-[340px] overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-2xl dark:border-ink-700 dark:bg-ink-900">
          <div className="flex items-center justify-between border-b border-ink-100 px-3.5 py-2.5 dark:border-ink-800">
            <span className="hd text-[13px]">Notifications</span>
            <button onClick={markAll} className="flex items-center gap-1 text-[11.5px] font-medium text-brand-600 hover:text-brand-700"><CheckCheck size={13} /> Mark all read</button>
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {list.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-ink-400">You're all caught up.</div>}
            {list.map((n) => (
              <button key={n.id}
                onClick={() => { markOne(n.id); nav(n.link); setOpen(false); }}
                className={`flex w-full items-start gap-2.5 border-b border-ink-100/70 px-3.5 py-2.5 text-left transition-colors hover:bg-ink-50 dark:border-ink-800 dark:hover:bg-ink-800/60 ${n.read ? "opacity-65" : ""}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-ink-200 dark:bg-ink-700" : "bg-brand-500"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">{n.title}</span>
                  <span className="block text-[11.5px] leading-snug text-ink-500">{n.body}</span>
                  <span className="num mt-0.5 block text-[10px] text-ink-400">{timeAgo(n.at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
// small helper to reach mutate without circular import noise
import { mutate as dbMutate } from "../lib/db";
function require_db() { return { mutate: dbMutate }; }

function ConnectionPill() {
  const [state, setState] = useState<"checking" | "ok" | "down">(DEMO_MODE ? "ok" : "checking");
  useEffect(() => {
    if (DEMO_MODE) return;
    let live = true;
    const check = () => backendAvailable().then((ok) => { if (live) setState(ok ? "ok" : "down"); });
    check();
    const iv = setInterval(check, 25000);
    return () => { live = false; clearInterval(iv); };
  }, []);
  if (DEMO_MODE) {
    return (
      <span className="mr-1 hidden items-center gap-1.5 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1 text-[10.5px] font-bold text-amber-700 lg:flex dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-300">
        <Database size={11} /> DEMO MODE · browser data
      </span>
    );
  }
  return (
    <span className={`mr-1 hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-bold lg:flex ${state === "ok" ? "border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-300" : state === "down" ? "border-red-300/70 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-900/25 dark:text-red-300" : "border-ink-200/80 bg-ink-100/50 text-ink-500 dark:border-ink-700 dark:bg-ink-800/60 dark:text-ink-400"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${state === "ok" ? "animate-pulse bg-emerald-500" : state === "down" ? "bg-red-500" : "bg-ink-400"}`} />
      {state === "ok" ? "Backend · PostgreSQL" : state === "down" ? "Backend offline" : "Connecting…"}
    </span>
  );
}

export default function AppLayout() {
  const { dark, toggleDark, logout, user } = useStore();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("itct.side") === "1");
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const toggleCollapse = () => setCollapsed((c) => { localStorage.setItem("itct.side", c ? "0" : "1"); return !c; });
  if (!user) return null;
  return (
    <div className="flex h-screen overflow-hidden">
      {/* desktop sidebar */}
      <aside className={`side-tex hidden shrink-0 flex-col bg-deep transition-[width] duration-300 md:flex ${collapsed ? "w-[64px]" : "w-[228px]"}`}>
        <SideNav collapsed={collapsed} />
      </aside>
      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink-950/60 a-fade-in" onClick={() => setMobileOpen(false)} />
          <aside className="side-tex a-slide-l absolute left-0 top-0 h-full w-[250px] bg-deep">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-4 text-white/50 hover:text-white"><X size={18} /></button>
            <SideNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[54px] shrink-0 items-center gap-2 border-b border-ink-200/80 bg-surface/90 px-3 backdrop-blur md:px-5 dark:border-ink-800 dark:bg-ink-900/90">
          <button className="rounded-md p-2 text-ink-500 hover:bg-ink-100 md:hidden dark:hover:bg-ink-800" onClick={() => setMobileOpen(true)}><MenuIcon size={18} /></button>
          <button className="hidden rounded-md p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700 md:block dark:hover:bg-ink-800" onClick={toggleCollapse} title="Toggle sidebar">
            <ChevronLeft size={16} className={`transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} />
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <ConnectionPill />
            <button onClick={toggleDark} className="rounded-md p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 dark:hover:bg-ink-800 dark:hover:text-ink-100" title="Toggle theme">
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <NoticesBell />
            <div className="mx-1.5 h-6 w-px bg-ink-200 dark:bg-ink-700" />
            <button onClick={logout} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ink-600 transition-colors hover:bg-ink-100 hover:text-red-600 dark:text-ink-300 dark:hover:bg-ink-800" title="Sign out">
              <Avatar name={user.name} color={user.color} size={26} />
              <span className="hidden text-[13px] font-semibold sm:block">{user.name.split(" ")[0]}</span>
              <LogOut size={14} className="text-ink-400" />
            </button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
