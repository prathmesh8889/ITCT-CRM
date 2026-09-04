import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { X, CheckCircle2, AlertTriangle, Info, XCircle, Inbox, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import type { Temperature } from "../lib/types";
import { inr } from "../lib/services";

// ---------- buttons ----------
type BtnVariant = "primary" | "soft" | "ghost" | "danger" | "outline" | "amber";
export function Btn({ variant = "primary", size = "md", loading, className = "", children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "xs"; loading?: boolean }) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-all duration-150 active:scale-[0.97] disabled:opacity-45 disabled:pointer-events-none whitespace-nowrap";
  const sizes = { xs: "text-[11px] px-2 py-1", sm: "text-xs px-2.5 py-1.5", md: "text-[13px] px-3.5 py-2" };
  const variants: Record<BtnVariant, string> = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm shadow-brand-900/20",
    soft: "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-900/40 dark:text-brand-200 dark:hover:bg-brand-900/60",
    ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-ink-800 dark:hover:text-ink-50",
    outline: "border border-ink-200 text-ink-700 hover:border-brand-400 hover:text-brand-700 bg-white dark:bg-ink-800 dark:border-ink-600 dark:text-ink-200 dark:hover:text-brand-300",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
    amber: "bg-amber-250 text-ink-900 hover:brightness-95 shadow-sm",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest}>
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

// ---------- badges ----------
export type Tone = "teal" | "amber" | "red" | "green" | "slate" | "blue" | "violet";
const tones: Record<Tone, string> = {
  teal: "bg-brand-50 text-brand-700 border-brand-200/70 dark:bg-brand-900/35 dark:text-brand-200 dark:border-brand-800",
  amber: "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-900/25 dark:text-amber-300 dark:border-amber-800/60",
  red: "bg-red-50 text-red-700 border-red-200/80 dark:bg-red-900/25 dark:text-red-300 dark:border-red-800/60",
  green: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-900/25 dark:text-emerald-300 dark:border-emerald-800/60",
  slate: "bg-ink-100/80 text-ink-600 border-ink-200 dark:bg-ink-800 dark:text-ink-300 dark:border-ink-700",
  blue: "bg-sky-50 text-sky-700 border-sky-200/80 dark:bg-sky-900/25 dark:text-sky-300 dark:border-sky-800/60",
  violet: "bg-violet-50 text-violet-700 border-violet-200/80 dark:bg-violet-900/25 dark:text-violet-300 dark:border-violet-800/60",
};
export function Badge({ tone = "slate", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide ${tones[tone]} ${className}`}>{children}</span>;
}
export function statusTone(s: string): Tone {
  const map: Record<string, Tone> = {
    New: "blue", Contacted: "slate", Interested: "teal", Qualified: "violet", Proposal: "amber",
    Negotiation: "amber", Converted: "green", Won: "green", Lost: "red", Closed: "red",
    Draft: "slate", Sent: "blue", Accepted: "green", Rejected: "red", Expired: "slate",
    Paid: "green", "Partially Paid": "amber", Overdue: "red", Cancelled: "slate",
    Scheduled: "blue", Completed: "green", Missed: "red", Rescheduled: "amber",
    Pending: "slate", "In Progress": "blue", Active: "green", Inactive: "slate", "On Hold": "amber",
    Valid: "green", "Partially Valid": "amber", Invalid: "red", "Needs Review": "amber",
    Running: "blue", Queued: "slate", Paused: "amber", Failed: "red", "Partially Completed": "amber",
  };
  return map[s] || "slate";
}
export function TempBadge({ t }: { t: Temperature | null }) {
  if (!t) return <span className="text-ink-400 text-xs">—</span>;
  const cls = t === "Hot" ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/25 dark:text-red-300 dark:border-red-800/60"
    : t === "Warm" ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/25 dark:text-amber-300 dark:border-amber-800/60"
    : "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/25 dark:text-sky-300 dark:border-sky-800/60";
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] font-bold ${cls}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${t === "Hot" ? "bg-red-500" : t === "Warm" ? "bg-amber-500" : "bg-sky-500"}`} />{t}
  </span>;
}

// ---------- overlays ----------
export function Modal({ open, onClose, title, children, wide, footer }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/55 p-4 pt-[7vh] backdrop-blur-[2px] a-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`a-scale-in w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-lg border border-ink-200 bg-surface shadow-2xl dark:border-ink-700 dark:bg-ink-900`}>
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5 dark:border-ink-800">
          <h3 className="hd text-[15px]">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><X size={16} /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3 dark:border-ink-800">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = "max-w-xl", headerExtra }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string; headerExtra?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (open) window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-ink-950/50 backdrop-blur-[2px] a-fade-in" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`a-slide-l absolute right-0 top-0 flex h-full w-full ${width} flex-col border-l border-ink-200 bg-paper shadow-2xl dark:border-ink-700 dark:bg-[#0d1215]`}>
        <div className="flex items-center justify-between gap-2 border-b border-ink-200/80 bg-surface px-5 py-3.5 dark:border-ink-700 dark:bg-ink-900">
          <div className="min-w-0 flex-1 hd text-[15px] truncate">{title}</div>
          <div className="flex items-center gap-2">{headerExtra}
            <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ---------- form primitives ----------
export function Field({ label, children, className = "", req }: { label: string; children: ReactNode; className?: string; req?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className="lbl">{label}{req && <span className="text-red-500"> *</span>}</span>
      {children}
    </label>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`inp ${props.className || ""}`} />;
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`inp ${props.className || ""}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`inp min-h-[70px] ${props.className || ""}`} />;
}
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-[13px] text-ink-700 dark:text-ink-200">
      <span className={`relative h-[18px] w-[32px] rounded-full transition-colors ${on ? "bg-brand-600" : "bg-ink-300 dark:bg-ink-600"}`}>
        <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow transition-transform ${on ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
      </span>
      {label}
    </button>
  );
}

// ---------- misc ----------
export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}>{initials}</span>
  );
}
export function Progress({ value, tone = "teal" }: { value: number; tone?: "teal" | "amber" | "red" }) {
  const c = tone === "red" ? "bg-red-500" : tone === "amber" ? "bg-amber-500" : "bg-brand-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-ink-800">
      <div className={`a-bar h-full rounded-full ${c}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="a-fade-up flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="rounded-full border border-dashed border-ink-300 p-4 text-ink-400 dark:border-ink-600">{icon || <Inbox size={26} />}</div>
      <div className="hd text-[15px]">{title}</div>
      {body && <p className="max-w-sm text-[13px] text-ink-500">{body}</p>}
      {action}
    </div>
  );
}
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}
export function Pagination({ page, pages, onPage, total, shown }: { page: number; pages: number; onPage: (p: number) => void; total: number; shown: number }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-3">
      <span className="num text-[11px] text-ink-500">{shown} of {total} records</span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-ink-200 p-1 text-ink-500 hover:text-brand-600 disabled:opacity-35 dark:border-ink-700"><ChevronLeft size={15} /></button>
        <span className="num px-2 text-xs text-ink-600 dark:text-ink-300">{page} / {Math.max(1, pages)}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded border border-ink-200 p-1 text-ink-500 hover:text-brand-600 disabled:opacity-35 dark:border-ink-700"><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}
export function Tabs({ tabs, active, onChange, className = "" }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (k: string) => void; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1 rounded-lg border border-ink-200/80 bg-ink-100/60 p-1 dark:border-ink-700 dark:bg-ink-800/60 ${className}`}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-all ${active === t.key ? "bg-surface text-ink-900 shadow-sm dark:bg-ink-900 dark:text-ink-50" : "text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"}`}>
          {t.label}{t.count !== undefined && <span className="num ml-1.5 text-[10.5px] text-ink-400">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ob = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { el.classList.add("on"); ob.disconnect(); } }), { threshold: 0.08 });
    ob.observe(el);
    return () => ob.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</div>;
}

// ---------- dropdown ----------
export function Menu({ trigger, children, align = "right" }: { trigger: ReactNode; children: ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div onClick={() => setOpen(false)}
          className={`a-scale-in absolute z-40 mt-1.5 min-w-[190px] overflow-hidden rounded-lg border border-ink-200 bg-surface py-1 shadow-xl dark:border-ink-700 dark:bg-ink-900 ${align === "right" ? "right-0" : "left-0"}`}>
          {children}
        </div>
      )}
    </div>
  );
}
export function MenuItem({ onClick, children, danger }: { onClick?: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${danger ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" : "text-ink-700 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-800"}`}>
      {children}
    </button>
  );
}

// ---------- money ----------
export function Money({ v, className = "" }: { v: number; className?: string }) {
  return <span className={`num ${className}`}>{inr(v)}</span>;
}

// ---------- print pipeline ----------
const PrintCtx = createContext<{ print: (node: ReactNode) => void }>({ print: () => {} });
export function usePrint() { return useContext(PrintCtx); }
export function PrintProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<ReactNode>(null);
  useEffect(() => {
    if (doc) {
      const t = setTimeout(() => { window.print(); setDoc(null); }, 120);
      return () => clearTimeout(t);
    }
  }, [doc]);
  return (
    <PrintCtx.Provider value={{ print: (n) => setDoc(n) }}>
      {children}
      {createPortal(<div className="print-doc">{doc}</div>, document.getElementById("print-root")!)}
    </PrintCtx.Provider>
  );
}

// ---------- toasts ----------
export function ToastHost({ toasts, drop }: { toasts: { id: string; title: string; body?: string; kind: string }[]; drop: (id: string) => void }) {
  const icons: Record<string, ReactNode> = {
    ok: <CheckCircle2 size={16} className="text-emerald-500" />, warn: <AlertTriangle size={16} className="text-amber-500" />,
    info: <Info size={16} className="text-sky-500" />, err: <XCircle size={16} className="text-red-500" />,
  };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[320px] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="a-slide-l pointer-events-auto flex items-start gap-2.5 rounded-lg border border-ink-200 bg-surface px-3.5 py-3 shadow-xl dark:border-ink-700 dark:bg-ink-900">
          <span className="mt-0.5">{icons[t.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">{t.title}</div>
            {t.body && <div className="mt-0.5 text-xs text-ink-500">{t.body}</div>}
          </div>
          <button onClick={() => drop(t.id)} className="text-ink-400 hover:text-ink-600"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
