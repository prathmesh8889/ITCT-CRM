import { Plus, Trash2 } from "lucide-react";
import { useDB, uid } from "../lib/db";
import { docTotals, inr } from "../lib/services";
import type { DocItem, Customer, CompanySettings } from "../lib/types";
import { Btn, Select, Input, Money } from "./ui";

// ---------------- line-item editor ----------------
export function DocEditor({ items, discountPct, onChange }: {
  items: DocItem[]; discountPct: number;
  onChange: (items: DocItem[], disc: number) => void;
}) {
  const d = useDB();
  const setItem = (id: string, patch: Partial<DocItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)), discountPct);
  const addFromProduct = (pid: string) => {
    const p = d.products.find((x) => x.id === pid);
    if (!p) return;
    onChange([...items, { id: uid(), name: p.name, productId: p.id, qty: 1, rate: p.price, discountPct: 0, gstPct: p.gstPct }], discountPct);
  };
  const totals = docTotals(items, discountPct);
  return (
    <div>
      <div className="overflow-x-auto rounded-md border border-ink-200 dark:border-ink-700">
        <table className="w-full">
          <thead className="bg-ink-100/70 dark:bg-ink-800">
            <tr><th className="th">Item</th><th className="th w-16">Qty</th><th className="th w-24">Rate</th><th className="th w-16">Disc %</th><th className="th w-16">GST %</th><th className="th w-24">Amount</th><th className="th w-8"></th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-ink-100 dark:border-ink-800">
                <td className="td"><Input value={i.name} onChange={(e) => setItem(i.id, { name: e.target.value })} /></td>
                <td className="td"><Input type="number" min={1} value={i.qty} onChange={(e) => setItem(i.id, { qty: Math.max(1, Number(e.target.value)) })} /></td>
                <td className="td"><Input type="number" value={i.rate} onChange={(e) => setItem(i.id, { rate: Math.max(0, Number(e.target.value)) })} /></td>
                <td className="td"><Input type="number" value={i.discountPct} onChange={(e) => setItem(i.id, { discountPct: Math.min(100, Math.max(0, Number(e.target.value))) })} /></td>
                <td className="td"><Input type="number" value={i.gstPct} onChange={(e) => setItem(i.id, { gstPct: Math.max(0, Number(e.target.value)) })} /></td>
                <td className="td num font-semibold">{inr(i.qty * i.rate * (1 - i.discountPct / 100))}</td>
                <td className="td"><button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => onChange(items.filter((x) => x.id !== i.id), discountPct)}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Select className="!w-auto" defaultValue="" onChange={(e) => { if (e.target.value) { addFromProduct(e.target.value); e.target.value = ""; } }}>
          <option value="" disabled>+ Add from product catalog…</option>
          {d.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.price)}</option>)}
        </Select>
        <Btn variant="ghost" size="sm" onClick={() => onChange([...items, { id: uid(), name: "Custom line item", qty: 1, rate: 0, discountPct: 0, gstPct: 18 }], discountPct)}><Plus size={13} /> Blank line</Btn>
      </div>
      <div className="mt-3 ml-auto w-full max-w-[280px] space-y-1 rounded-md bg-ink-50 p-3 text-[12.5px] dark:bg-ink-800/60">
        <div className="flex justify-between text-ink-500"><span>Subtotal</span><Money v={totals.subtotal} /></div>
        {totals.itemDiscount > 0 && <div className="flex justify-between text-ink-500"><span>Item discounts</span><span className="num text-red-500">−{inr(totals.itemDiscount)}</span></div>}
        <div className="flex items-center justify-between text-ink-500">
          <span className="flex items-center gap-1.5">Overall discount <Input type="number" className="!w-14 !px-1 !py-0.5 text-center" value={discountPct} onChange={(e) => onChange(items, Math.min(100, Math.max(0, Number(e.target.value))))} />%</span>
          <span className="num text-red-500">−{inr(totals.discount)}</span>
        </div>
        <div className="flex justify-between text-ink-500"><span>GST</span><Money v={totals.tax} /></div>
        <div className="flex justify-between border-t border-ink-200 pt-1.5 text-[14px] font-bold text-ink-900 dark:border-ink-700 dark:text-ink-50"><span>Grand total</span><Money v={totals.total} /></div>
      </div>
    </div>
  );
}

// ---------------- printable document ----------------
export function DocPrint({ kind, number, customer, settings, date, extraLabel, extraValue, items, discountPct, terms, notes, status }: {
  kind: "Quotation" | "Invoice" | "Tax Invoice"; number: string; customer: Customer; settings: CompanySettings;
  date: string; extraLabel: string; extraValue: string; items: DocItem[]; discountPct: number;
  terms: string; notes: string; status: string;
}) {
  const t = docTotals(items, discountPct);
  const fmt = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", fontFamily: "'IBM Plex Sans', sans-serif", color: "#14191c", fontSize: 12.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #0F766E", paddingBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 46, height: 46, borderRadius: 10, background: "#0F766E", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Space Grotesk'", fontWeight: 700, fontSize: 22 }}>{settings.logoMark}</div>
          <div>
            <div style={{ fontFamily: "'Space Grotesk'", fontSize: 19, fontWeight: 700 }}>{settings.name}</div>
            <div style={{ color: "#5b6570", fontSize: 11 }}>{settings.tagline}</div>
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11, color: "#5b6570", lineHeight: 1.6 }}>
          <div>{settings.address}</div>
          <div>{settings.phone} · {settings.email}</div>
          <div>GSTIN: {settings.gstin} · PAN: {settings.pan}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "18px 0", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: "'Space Grotesk'", fontSize: 24, fontWeight: 700, color: "#0F766E", letterSpacing: "-0.02em" }}>{kind.toUpperCase()}</div>
          <div style={{ fontFamily: "'IBM Plex Mono'", fontSize: 13, fontWeight: 600 }}>{number}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: 11.5 }}>
          <div><b>Date:</b> {fmt(date)}</div>
          <div><b>{extraLabel}:</b> {extraValue}</div>
          <div><b>Status:</b> {status}</div>
        </div>
      </div>
      <div style={{ background: "#f4f6f4", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#5b6570" }}>Bill To</div>
        <div style={{ fontWeight: 700, marginTop: 2 }}>{customer.company}</div>
        <div>{customer.name} · {customer.city}{customer.state ? `, ${customer.state}` : ""}</div>
        <div>{customer.phone}{customer.email ? ` · ${customer.email}` : ""}</div>
        {customer.gstin && <div>GSTIN: {customer.gstin}</div>}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#0F766E", color: "#fff" }}>
            <th style={{ textAlign: "left", padding: "8px 10px", borderRadius: "6px 0 0 6px" }}>#</th>
            <th style={{ textAlign: "left", padding: "8px 10px" }}>Description</th>
            <th style={{ textAlign: "right", padding: "8px 10px" }}>Qty</th>
            <th style={{ textAlign: "right", padding: "8px 10px" }}>Rate</th>
            <th style={{ textAlign: "right", padding: "8px 10px" }}>Disc</th>
            <th style={{ textAlign: "right", padding: "8px 10px" }}>GST</th>
            <th style={{ textAlign: "right", padding: "8px 10px", borderRadius: "0 6px 6px 0" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={i.id} style={{ borderBottom: "1px solid #e3e7e3" }}>
              <td style={{ padding: "8px 10px", color: "#5b6570" }}>{idx + 1}</td>
              <td style={{ padding: "8px 10px", fontWeight: 600 }}>{i.name}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono'" }}>{i.qty}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono'" }}>{inr(i.rate)}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono'" }}>{i.discountPct}%</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono'" }}>{i.gstPct}%</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: "'IBM Plex Mono'", fontWeight: 600 }}>{inr(i.qty * i.rate * (1 - i.discountPct / 100))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <div style={{ width: 260, fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#5b6570" }}><span>Subtotal</span><span style={{ fontFamily: "'IBM Plex Mono'" }}>{inr(t.subtotal)}</span></div>
          {(t.itemDiscount + t.discount > 0) && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#b3402e" }}><span>Discount</span><span style={{ fontFamily: "'IBM Plex Mono'" }}>−{inr(t.itemDiscount + t.discount)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", color: "#5b6570" }}><span>GST</span><span style={{ fontFamily: "'IBM Plex Mono'" }}>{inr(t.tax)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 4px", borderTop: "2px solid #0F766E", fontWeight: 700, fontSize: 14 }}><span>Grand Total</span><span style={{ fontFamily: "'IBM Plex Mono'" }}>{inr(t.total)}</span></div>
        </div>
      </div>
      {terms && <div style={{ marginTop: 16, fontSize: 11, color: "#5b6570" }}><b style={{ color: "#14191c" }}>Terms & conditions:</b> {terms}</div>}
      {notes && <div style={{ marginTop: 6, fontSize: 11, color: "#5b6570" }}><b style={{ color: "#14191c" }}>Notes:</b> {notes}</div>}
      <div style={{ marginTop: 34, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ fontSize: 10.5, color: "#8a939c" }}>This is a computer-generated {kind.toLowerCase()} from {settings.name}.</div>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 170, borderTop: "1.5px solid #14191c", paddingTop: 5, fontSize: 11 }}>Authorised Signatory</div>
        </div>
      </div>
    </div>
  );
}
