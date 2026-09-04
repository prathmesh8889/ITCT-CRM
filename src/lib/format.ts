/** Pure formatting helpers — no database imports. Safe for backend-only paths. */

export function inr(n: number): string {
  const neg = n < 0;
  const v = Math.abs(n);
  const opts: Intl.NumberFormatOptions = Number.isInteger(Math.round(v * 100) / 100)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return (neg ? "−₹" : "₹") + new Intl.NumberFormat("en-IN", opts).format(v);
}

export function fmtD(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : fmtD(iso);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
