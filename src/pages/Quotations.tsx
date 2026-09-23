import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Pencil, Copy, Printer, FileText, Send, Check, X, MessageCircle, ArrowRight } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB } from "../lib/db";
import { docTotals, logAct, waLink, renderTemplate, fmtD, todayISO, addDaysISO, inr } from "../lib/services";
import { quotationApi } from "../lib/api";
import { fromApiQuotation, fromApiInvoice, toApiItems } from "../lib/mappers";
import type { Quotation, QuoteStatus, DocItem } from "../lib/types";
import { Btn, Badge, Modal, Drawer, Field, Input, Select, Textarea, EmptyState, Money, statusTone, Menu, MenuItem } from "../components/ui";
import { DocEditor, DocPrint } from "../components/docui";
import { usePrint } from "../components/ui";

function QuoteModal({ initial, onDone, editing }: { initial: Partial<Quotation>; onDone: () => void; editing: boolean }) {
  const { toast } = useStore();
  const d = useDB();
  const [f, setF] = useState<Partial<Quotation>>(initial);
  const [items, setItems] = useState<DocItem[]>(initial.items || []);
  const [disc, setDisc] = useState(initial.discountPct || 0);
  const [busy, setBusy] = useState(false);
  const save = async (status?: QuoteStatus) => {
    if (!f.customerId) { toast("Select a customer", "err"); return; }
    if (items.length === 0) { toast("Add at least one line item", "err"); return; }
    setBusy(true);
    try {
      const body = {
        customer_id: Number(f.customerId),
        date: f.date || todayISO(),
        valid_until: f.validUntil || addDaysISO(15),
        items: toApiItems(items),
        terms: f.terms || "50% advance, balance on delivery.",
        notes: f.notes || "",
        status: status || (editing ? f.status : "Draft") || "Draft",
      };
      const r = editing && f.id
        ? await quotationApi.update(Number(f.id), body)
        : await quotationApi.create(body);
      const row = { ...fromApiQuotation(r.data as any), discountPct: disc };
      mutate((db) => {
        const index = db.quotations.findIndex((x) => x.id === row.id);
        if (index >= 0) db.quotations[index] = row; else db.quotations.unshift(row);
      });
      toast(editing ? "Quotation updated" : "Quotation created", "ok", row.number);
      onDone();
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save quotation", "err"); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Field label="Customer" req><Select value={f.customerId || ""} onChange={(e) => setF((p) => ({ ...p, customerId: e.target.value }))}><option value="">Select…</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}</Select></Field>
        <Field label="Date"><Input type="date" value={f.date || todayISO()} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} /></Field>
        <Field label="Valid until"><Input type="date" value={f.validUntil || addDaysISO(15)} onChange={(e) => setF((p) => ({ ...p, validUntil: e.target.value }))} /></Field>
      </div>
      <DocEditor items={items} discountPct={disc} onChange={(i, dd) => { setItems(i); setDisc(dd); }} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Terms"><Textarea value={f.terms || ""} onChange={(e) => setF((p) => ({ ...p, terms: e.target.value }))} /></Field>
        <Field label="Notes"><Textarea value={f.notes || ""} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} /></Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
        <Btn variant="outline" loading={busy} onClick={() => void save("Draft")}>Save draft</Btn>
        <Btn loading={busy} onClick={() => void save(editing ? f.status : "Draft")}>{editing ? "Save changes" : "Create quotation"}</Btn>
      </div>
    </div>
  );
}

export default function Quotations() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const nav = useNavigate();
  const { print } = usePrint();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(params.get("new") === "1");
  const [editId, setEditId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const today = todayISO();
  useEffect(() => { setOpenId(params.get("open")); }, [params]);

  const effStatus = (qt: Quotation): QuoteStatus =>
    (qt.status === "Draft" || qt.status === "Sent") && qt.validUntil < today ? "Expired" : qt.status;

  const list = useMemo(() => d.quotations.filter((x) => !q || x.number.toLowerCase().includes(q.toLowerCase()) || d.customers.find((c) => c.id === x.customerId)?.company.toLowerCase().includes(q.toLowerCase())), [d.quotations, d.customers, q]);
  const open = openId ? d.quotations.find((x) => x.id === openId) : null;

  const setStatus = async (qt: Quotation, status: QuoteStatus) => {
    try {
      const r = await quotationApi.update(Number(qt.id), { status });
      const row = { ...fromApiQuotation(r.data as any), discountPct: qt.discountPct };
      mutate((db) => {
        const index = db.quotations.findIndex((x) => x.id === qt.id);
        if (index >= 0) db.quotations[index] = row;
      });
      toast(`Marked ${status.toLowerCase()}`, status === "Rejected" ? "warn" : "ok");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not update quotation", "err"); }
  };
  const duplicate = async (qt: Quotation) => {
    try {
      const r = await quotationApi.create({
        customer_id: Number(qt.customerId), date: todayISO(), valid_until: addDaysISO(15),
        items: toApiItems(qt.items), terms: qt.terms || "", notes: qt.notes || "", status: "Draft",
      });
      const row = { ...fromApiQuotation(r.data as any), discountPct: qt.discountPct };
      mutate((db) => db.quotations.unshift(row));
      toast("Quotation duplicated", "ok", row.number);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not duplicate quotation", "err"); }
  };
  const toInvoice = async (qt: Quotation) => {
    try {
      const r = await quotationApi.convertToInvoice(Number(qt.id));
      const inv = { ...fromApiInvoice(r.data as any), discountPct: qt.discountPct };
      mutate((db) => {
        db.invoices.unshift(inv);
        const row = db.quotations.find((x) => x.id === qt.id);
        if (row) row.status = "Accepted";
      });
      toast("Invoice created", "ok", `${inv.number} is ready in Invoices (draft).`);
      nav("/invoices");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not convert quotation", "err"); }
  };
  const removeQuotation = async (qt: Quotation) => {
    if (!window.confirm(`Delete ${qt.number}?`)) return;
    try {
      await quotationApi.remove(Number(qt.id));
      mutate((db) => { db.quotations = db.quotations.filter((x) => x.id !== qt.id); });
      if (openId === qt.id) setOpenId(null);
      toast("Quotation deleted", "warn");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete quotation", "err"); }
  };
  const sendWhatsApp = (qt: Quotation) => {
    const c = d.customers.find((x) => x.id === qt.customerId);
    const t = d.templates.find((x) => x.channel === "whatsapp" && x.name === "Quotation Reminder")!;
    const body = renderTemplate(t.body, { customer_name: c?.name || "there", employee_name: user?.name || "", company_name: d.settings.company.name, quotation_number: qt.number });
    window.open(waLink(c?.whatsapp || c?.phone || "", body), "_blank");
    logAct("quote", qt.id, user!.id, "WhatsApp action opened", `Quotation ${qt.number}`);
  };
  const doPrint = (qt: Quotation) => {
    const c = d.customers.find((x) => x.id === qt.customerId);
    if (!c) { toast("Customer missing", "err"); return; }
    print(<DocPrint kind="Quotation" number={qt.number} customer={c} settings={d.settings.company} date={qt.date} extraLabel="Valid until" extraValue={fmtD(qt.validUntil)} items={qt.items} discountPct={qt.discountPct} terms={qt.terms} notes={qt.notes} status={effStatus(qt)} />);
  };

  return (
    <div className="mx-auto max-w-[1200px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Quotations</h1><p className="text-[12.5px] text-ink-500">{d.quotations.length} quotations · {inr(d.quotations.filter((x) => effStatus(x) === "Accepted").reduce((a, x) => a + docTotals(x.items, x.discountPct).total, 0))} accepted value</p></div>
        {can("quotations", "create") && <Btn size="sm" onClick={() => setModal(true)}><Plus size={14} /> New quotation</Btn>}
      </div>
      <div className="mb-4 max-w-sm"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number or customer…" /></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full">
          <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Number</th><th className="th">Customer</th><th className="th">Date</th><th className="th">Valid until</th><th className="th">Total</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
          <tbody>{list.map((qt) => {
            const c = d.customers.find((x) => x.id === qt.customerId);
            const st = effStatus(qt);
            return (
              <tr key={qt.id} className="cursor-pointer border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50" onClick={() => { setOpenId(qt.id); setParams({ open: qt.id }); }}>
                <td className="td num font-bold text-brand-700 dark:text-brand-300">{qt.number}</td>
                <td className="td font-medium">{c?.company || "—"}</td>
                <td className="td num text-[12px] text-ink-400">{fmtD(qt.date)}</td>
                <td className={`td num text-[12px] ${qt.validUntil < today && st !== "Accepted" ? "font-bold text-red-500" : "text-ink-400"}`}>{fmtD(qt.validUntil)}</td>
                <td className="td"><Money v={docTotals(qt.items, qt.discountPct).total} className="font-semibold" /></td>
                <td className="td"><Badge tone={statusTone(st)}>{st}</Badge></td>
                <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                  <Menu align="right" trigger={<Btn variant="ghost" size="xs">⋯</Btn>}>
                    <MenuItem onClick={() => doPrint(qt)}><Printer size={13} /> PDF / Print</MenuItem>
                    <MenuItem onClick={() => sendWhatsApp(qt)}><MessageCircle size={13} /> Send on WhatsApp</MenuItem>
                    {qt.status === "Draft" && can("quotations", "edit") && <MenuItem onClick={() => void setStatus(qt, "Sent")}><Send size={13} /> Mark sent</MenuItem>}
                    {qt.status === "Sent" && can("quotations", "approve") && <>
                      <MenuItem onClick={() => void setStatus(qt, "Accepted")}><Check size={13} /> Mark accepted</MenuItem>
                      <MenuItem onClick={() => void setStatus(qt, "Rejected")}><X size={13} /> Mark rejected</MenuItem>
                    </>}
                    {(st === "Accepted" || st === "Sent") && can("invoices", "create") && <MenuItem onClick={() => void toInvoice(qt)}><ArrowRight size={13} /> Convert to invoice</MenuItem>}
                    {can("quotations", "create") && <MenuItem onClick={() => void duplicate(qt)}><Copy size={13} /> Duplicate</MenuItem>}
                    {can("quotations", "edit") && <MenuItem onClick={() => { setEditId(qt.id); setOpenId(null); }}><Pencil size={13} /> Edit</MenuItem>}
                    {can("quotations", "delete") && <MenuItem danger onClick={() => void removeQuotation(qt)}><X size={13} /> Delete</MenuItem>}
                  </Menu>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {list.length === 0 && <EmptyState icon={<FileText size={24} />} title="No quotations yet" body="Create one from the product catalog with automatic GST math." />}
      </div>

      {modal && <Modal open onClose={() => setModal(false)} title="New quotation" wide><QuoteModal initial={{ date: todayISO(), validUntil: addDaysISO(15), terms: "50% advance, balance on delivery. Prices inclusive of scope as described." }} onDone={() => setModal(false)} editing={false} /></Modal>}
      {editId && <Modal open onClose={() => setEditId(null)} title={`Edit ${d.quotations.find((x) => x.id === editId)?.number}`} wide><QuoteModal initial={{ ...d.quotations.find((x) => x.id === editId)! }} onDone={() => setEditId(null)} editing /></Modal>}
      {open && (
        <Drawer open onClose={() => { setOpenId(null); setParams({}); }} title={<span className="num">{open.number}</span>}
          headerExtra={<Btn variant="outline" size="sm" onClick={() => doPrint(open)}><Printer size={13} /> PDF</Btn>}>
          <div className="p-5">
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Total</div><Money v={docTotals(open.items, open.discountPct).total} className="text-lg font-bold text-brand-700 dark:text-brand-300" /></div>
              <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Status</div><Badge tone={statusTone(effStatus(open))} className="mt-1.5">{effStatus(open)}</Badge></div>
              <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Valid until</div><div className="num text-sm font-semibold text-ink-700 dark:text-ink-200">{fmtD(open.validUntil)}</div></div>
            </div>
            <div className="card overflow-hidden">
              <table className="w-full">
                <thead className="bg-ink-100/70 dark:bg-ink-800"><tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Rate</th><th className="th text-right">GST</th><th className="th text-right">Amount</th></tr></thead>
                <tbody>{open.items.map((i) => (
                  <tr key={i.id} className="border-t border-ink-100 dark:border-ink-800">
                    <td className="td">{i.name}</td><td className="td num text-right">{i.qty}</td><td className="td num text-right">{inr(i.rate)}</td><td className="td num text-right">{i.gstPct}%</td><td className="td num text-right font-semibold">{inr(i.qty * i.rate * (1 - i.discountPct / 100))}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {open.terms && <p className="mt-3 rounded-md bg-ink-50 p-3 text-[12px] text-ink-500 dark:bg-ink-800/60"><b>Terms:</b> {open.terms}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn variant="outline" size="sm" onClick={() => sendWhatsApp(open)}><MessageCircle size={13} /> WhatsApp</Btn>
              {open.status === "Draft" && can("quotations", "edit") && <Btn size="sm" onClick={() => void setStatus(open, "Sent")}><Send size={13} /> Mark sent</Btn>}
              {open.status === "Sent" && can("quotations", "approve") && <>
                <Btn variant="soft" size="sm" onClick={() => void setStatus(open, "Accepted")}><Check size={13} /> Accepted</Btn>
                <Btn variant="ghost" size="sm" onClick={() => void setStatus(open, "Rejected")}><X size={13} /> Rejected</Btn>
              </>}
              {(effStatus(open) === "Accepted" || effStatus(open) === "Sent") && can("invoices", "create") && <Btn variant="amber" size="sm" onClick={() => void toInvoice(open)}><ArrowRight size={13} /> Convert to invoice</Btn>}
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}
