import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Printer, Receipt, Wallet, TrendingDown, MessageCircle, Send, Pencil, X, Download } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB, uid } from "../lib/db";
import { docTotals, paidFor, sweepInvoices, nextDocNumber, logAct, logAudit, waLink, renderTemplate, runTriggers, toCSV, downloadFile, fmtD, todayISO, addDaysISO, inr } from "../lib/services";
import type { Invoice, Payment, PayMode, DocItem } from "../lib/types";
import { Btn, Badge, Modal, Drawer, Field, Input, Select, Textarea, Tabs, EmptyState, Money, statusTone, Menu, MenuItem } from "../components/ui";
import { DocEditor, DocPrint } from "../components/docui";
import { usePrint } from "../components/ui";

function InvoiceModal({ initial, onDone, editing }: { initial: Partial<Invoice>; onDone: () => void; editing: boolean }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [f, setF] = useState(initial);
  const [items, setItems] = useState<DocItem[]>(initial.items || []);
  const [disc, setDisc] = useState(initial.discountPct || 0);
  const save = () => {
    if (!f.customerId) { toast("Select a customer", "err"); return; }
    if (items.length === 0) { toast("Add at least one line item", "err"); return; }
    if (editing && f.id) {
      mutate((db) => { const x = db.invoices.find((y) => y.id === f.id); if (x) Object.assign(x, { ...f, items, discountPct: disc }); });
      logAudit(user!.id, "Invoice Modified", f.number || "", "Items/terms edited");
      toast("Invoice updated");
    } else {
      const num = nextDocNumber(d, "INV");
      mutate((db) => { db.invoices.unshift({ id: uid(), number: num, customerId: f.customerId!, date: f.date || todayISO(), dueDate: f.dueDate || addDaysISO(15), items, discountPct: disc, status: "Draft", notes: f.notes || "", createdBy: user!.id, createdAt: new Date().toISOString() }); });
      logAct("invoice", num, user!.id, "Invoice generated", inr(docTotals(items, disc).total));
      toast("Invoice created", "ok", num);
    }
    onDone();
  };
  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-3">
        <Field label="Customer" req><Select value={f.customerId || ""} onChange={(e) => setF((p) => ({ ...p, customerId: e.target.value }))}><option value="">Select…</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}</Select></Field>
        <Field label="Invoice date"><Input type="date" value={f.date || todayISO()} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} /></Field>
        <Field label="Due date"><Input type="date" value={f.dueDate || addDaysISO(15)} onChange={(e) => setF((p) => ({ ...p, dueDate: e.target.value }))} /></Field>
      </div>
      <DocEditor items={items} discountPct={disc} onChange={(i, dd) => { setItems(i); setDisc(dd); }} />
      <Field label="Notes" className="mt-3"><Textarea value={f.notes || ""} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} /></Field>
      <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn onClick={save}>{editing ? "Save changes" : "Create invoice"}</Btn></div>
    </div>
  );
}

function PaymentModal({ invoiceId, onDone }: { invoiceId?: string; onDone: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [invId, setInvId] = useState(invoiceId || "");
  const inv = d.invoices.find((i) => i.id === invId);
  const balance = inv ? Math.max(0, docTotals(inv.items, inv.discountPct).total - paidFor(d, inv.id)) : 0;
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState<PayMode>("UPI");
  const [txn, setTxn] = useState("");
  const [notes, setNotes] = useState("");
  const [init, setInit] = useState(false);
  if (inv && !init) { setInit(true); setAmount(balance); }
  const save = () => {
    if (!inv) { toast("Pick an invoice", "err"); return; }
    if (!amount || amount <= 0) { toast("Enter a valid amount", "err"); return; }
    mutate((db) => {
      db.payments.unshift({ id: uid(), invoiceId: inv.id, customerId: inv.customerId, amount, date, mode, txnId: txn, notes, recordedBy: user!.id, createdAt: new Date().toISOString() });
      sweepInvoices(db);
      logAct("invoice", inv.id, user!.id, "Payment received", `${inr(amount)} via ${mode}`);
      logAudit(user!.id, "Payment Recorded", inv.number, `${inr(amount)} via ${mode}`);
      db.notices.unshift({ id: uid(), userId: "managers", title: `Payment received — ${inv.number}`, body: `${inr(amount)} via ${mode} from ${db.customers.find((c) => c.id === inv.customerId)?.company || ""}`, read: false, at: new Date().toISOString(), link: "/invoices?tab=payments", kind: "invoice" });
    });
    toast("Payment recorded", "ok", `${inr(amount)} · ${mode}`);
    onDone();
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Invoice" req className="col-span-2">
        <Select value={invId} onChange={(e) => { setInvId(e.target.value); setInit(false); }} disabled={!!invoiceId}>
          <option value="">Select…</option>
          {d.invoices.filter((i) => i.status !== "Cancelled" && i.status !== "Paid").map((i) => <option key={i.id} value={i.id}>{i.number} · {d.customers.find((c) => c.id === i.customerId)?.company} · bal {inr(Math.max(0, docTotals(i.items, i.discountPct).total - paidFor(d, i.id)))}</option>)}
        </Select>
      </Field>
      <Field label="Amount (₹)" req><Input type="number" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
      <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value as PayMode)}>{["Cash", "UPI", "Bank Transfer", "Card", "Cheque", "Other"].map((m) => <option key={m}>{m}</option>)}</Select></Field>
      <Field label="Transaction ID"><Input value={txn} onChange={(e) => setTxn(e.target.value)} placeholder="UPI-12345 / NEFT…" /></Field>
      <Field label="Notes" className="col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {inv && <div className="num col-span-2 rounded-md bg-ink-50 px-3 py-2 text-[12px] text-ink-500 dark:bg-ink-800/60">Invoice total {inr(docTotals(inv.items, inv.discountPct).total)} · paid {inr(paidFor(d, inv.id))} · balance {inr(balance)}</div>}
      <div className="col-span-2 flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn onClick={save}><Wallet size={14} /> Record payment</Btn></div>
    </div>
  );
}

export default function Invoices() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const { print } = usePrint();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "invoices";
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [payForId, setPayForId] = useState<string | null | "any">(null);
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [expModal, setExpModal] = useState(false);
  const [exp, setExp] = useState({ category: "Software", vendor: "", amount: 0, date: todayISO(), notes: "" });
  const today = todayISO();
  useEffect(() => { setOpenId(params.get("open")); }, [params]);

  const list = useMemo(() => d.invoices, [d.invoices]);
  const open = openId ? d.invoices.find((x) => x.id === openId) : null;
  const outstanding = d.invoices.filter((i) => !["Cancelled", "Draft", "Paid"].includes(i.status)).reduce((a, i) => a + Math.max(0, docTotals(i.items, i.discountPct).total - paidFor(d, i.id)), 0);

  const sendReminder = (inv: Invoice) => {
    const c = d.customers.find((x) => x.id === inv.customerId);
    const t = d.templates.find((x) => x.channel === "whatsapp" && x.name === "Payment Reminder")!;
    const bal = Math.max(0, docTotals(inv.items, inv.discountPct).total - paidFor(d, inv.id));
    const body = renderTemplate(t.body, { customer_name: c?.name || "there", company_name: d.settings.company.name, invoice_number: inv.number, amount_due: inr(bal) });
    window.open(waLink(c?.whatsapp || c?.phone || "", body), "_blank");
    logAct("invoice", inv.id, user!.id, "WhatsApp action opened", `Payment reminder ${inv.number}`);
  };
  const markSent = (inv: Invoice) => {
    mutate((db) => { const x = db.invoices.find((y) => y.id === inv.id); if (x && x.status === "Draft") x.status = "Sent"; });
    logAct("invoice", inv.id, user!.id, "Invoice sent", inv.number);
    toast("Invoice marked sent");
  };
  const doPrint = (inv: Invoice) => {
    const c = d.customers.find((x) => x.id === inv.customerId);
    if (!c) return;
    print(<DocPrint kind="Tax Invoice" number={inv.number} customer={c} settings={d.settings.company} date={inv.date} extraLabel="Due date" extraValue={fmtD(inv.dueDate)} items={inv.items} discountPct={inv.discountPct} terms="Payment due by the date above. Late payments may attract 1.5% monthly interest." notes={inv.notes} status={inv.status} />);
  };
  const saveExpense = () => {
    if (!exp.vendor.trim() || !exp.amount) { toast("Vendor and amount required", "err"); return; }
    mutate((db) => db.expenses.unshift({ id: uid(), ...exp, recordedBy: user!.id, createdAt: new Date().toISOString() }));
    logAct("expense", "new", user!.id, "Expense recorded", `${exp.category} · ${inr(exp.amount)}`);
    toast("Expense added"); setExpModal(false); setExp({ category: "Software", vendor: "", amount: 0, date: todayISO(), notes: "" });
  };

  return (
    <div className="mx-auto max-w-[1250px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Billing & Money</h1><p className="text-[12.5px] text-ink-500">Outstanding across invoices: <b className="num text-red-500">{inr(outstanding)}</b></p></div>
        <div className="flex gap-2">
          {tab === "expenses" && can("expenses", "create") && <Btn size="sm" variant="outline" onClick={() => setExpModal(true)}><Plus size={14} /> Expense</Btn>}
          {tab === "payments" && can("payments", "create") && <Btn size="sm" variant="outline" onClick={() => setPayForId("any")}><Plus size={14} /> Record payment</Btn>}
          {tab === "invoices" && can("invoices", "create") && <Btn size="sm" onClick={() => setModal(true)}><Plus size={14} /> New invoice</Btn>}
        </div>
      </div>
      <Tabs className="mb-4" tabs={[{ key: "invoices", label: "Invoices", count: d.invoices.length }, { key: "payments", label: "Payments", count: d.payments.length }, { key: "expenses", label: "Expenses", count: d.expenses.length }]} active={tab} onChange={(k) => setParams({ tab: k })} />

      {tab === "invoices" && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Number</th><th className="th">Customer</th><th className="th">Issued</th><th className="th">Due</th><th className="th">Total</th><th className="th">Paid</th><th className="th">Balance</th><th className="th">Status</th><th className="th text-right">Actions</th></tr></thead>
            <tbody>{list.map((inv) => {
              const c = d.customers.find((x) => x.id === inv.customerId);
              const t = docTotals(inv.items, inv.discountPct).total; const p = paidFor(d, inv.id); const bal = Math.max(0, t - p);
              return (
                <tr key={inv.id} className="cursor-pointer border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50" onClick={() => { setOpenId(inv.id); setParams({ tab, open: inv.id }); }}>
                  <td className="td num font-bold text-brand-700 dark:text-brand-300">{inv.number}</td>
                  <td className="td font-medium">{c?.company || "—"}</td>
                  <td className="td num text-[12px] text-ink-400">{fmtD(inv.date)}</td>
                  <td className={`td num text-[12px] ${inv.dueDate < today && bal > 0 ? "font-bold text-red-500" : "text-ink-400"}`}>{fmtD(inv.dueDate)}</td>
                  <td className="td num font-semibold">{inr(t)}</td>
                  <td className="td num text-emerald-600">{inr(p)}</td>
                  <td className="td num font-semibold text-red-500">{bal ? inr(bal) : "—"}</td>
                  <td className="td"><Badge tone={statusTone(inv.status)}>{inv.status}</Badge></td>
                  <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                    <Menu align="right" trigger={<Btn variant="ghost" size="xs">⋯</Btn>}>
                      <MenuItem onClick={() => doPrint(inv)}><Printer size={13} /> PDF / Print</MenuItem>
                      {can("payments", "create") && bal > 0 && <MenuItem onClick={() => setPayForId(inv.id)}><Wallet size={13} /> Record payment</MenuItem>}
                      {bal > 0 && <MenuItem onClick={() => sendReminder(inv)}><MessageCircle size={13} /> WhatsApp reminder</MenuItem>}
                      {inv.status === "Draft" && can("invoices", "edit") && <MenuItem onClick={() => markSent(inv)}><Send size={13} /> Mark sent</MenuItem>}
                      {inv.status === "Draft" && can("invoices", "edit") && <MenuItem onClick={() => setEditId(inv.id)}><Pencil size={13} /> Edit draft</MenuItem>}
                      {inv.status === "Draft" && can("invoices", "edit") && <MenuItem danger onClick={() => { mutate((db) => { const x = db.invoices.find((y) => y.id === inv.id); if (x) x.status = "Cancelled"; }); logAudit(user!.id, "Invoice Modified", inv.number, "Cancelled"); toast("Invoice cancelled", "warn"); }}><X size={13} /> Cancel invoice</MenuItem>}
                    </Menu>
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {list.length === 0 && <EmptyState icon={<Receipt size={24} />} title="No invoices" body="Convert an accepted quotation or create an invoice here." />}
        </div>
      )}

      {tab === "payments" && (
        <div>
          <div className="mb-3 flex justify-end">
            <Btn variant="outline" size="sm" onClick={() => downloadFile(`payments-${today}.csv`, toCSV(["Date", "Invoice", "Customer", "Amount", "Mode", "Txn ID"], d.payments.map((p) => [p.date, d.invoices.find((i) => i.id === p.invoiceId)?.number || "", d.customers.find((c) => c.id === p.customerId)?.company || "", p.amount, p.mode, p.txnId])))}><Download size={13} /> Export CSV</Btn>
          </div>
          <div className="card overflow-hidden"><table className="w-full">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Date</th><th className="th">Invoice</th><th className="th">Customer</th><th className="th">Mode</th><th className="th">Txn ID</th><th className="th text-right">Amount</th><th className="th">By</th></tr></thead>
            <tbody>{[...d.payments].sort((a, b) => b.date.localeCompare(a.date)).map((p) => (
              <tr key={p.id} className="border-b border-ink-100/70 dark:border-ink-800">
                <td className="td num text-[12px]">{fmtD(p.date)}</td>
                <td className="td num font-semibold text-brand-700 dark:text-brand-300">{d.invoices.find((i) => i.id === p.invoiceId)?.number || "—"}</td>
                <td className="td">{d.customers.find((c) => c.id === p.customerId)?.company || "—"}</td>
                <td className="td"><Badge tone="slate">{p.mode}</Badge></td>
                <td className="td num text-[11.5px] text-ink-400">{p.txnId || "—"}</td>
                <td className="td num text-right font-bold text-emerald-600">{inr(p.amount)}</td>
                <td className="td text-[12px] text-ink-400">{d.users.find((u) => u.id === p.recordedBy)?.name.split(" ")[0]}</td>
              </tr>
            ))}</tbody>
          </table>
          {d.payments.length === 0 && <EmptyState icon={<Wallet size={24} />} title="No payments recorded" />}
          </div>
        </div>
      )}

      {tab === "expenses" && (
        <div>
          <div className="mb-3 flex justify-end">
            <Btn variant="outline" size="sm" onClick={() => downloadFile(`expenses-${today}.csv`, toCSV(["Date", "Category", "Vendor", "Amount", "Notes"], d.expenses.map((x) => [x.date, x.category, x.vendor, x.amount, x.notes])))}><Download size={13} /> Export CSV</Btn>
          </div>
          <div className="card overflow-hidden"><table className="w-full">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Date</th><th className="th">Category</th><th className="th">Vendor</th><th className="th">Notes</th><th className="th text-right">Amount</th><th className="th w-10"></th></tr></thead>
            <tbody>{[...d.expenses].sort((a, b) => b.date.localeCompare(a.date)).map((x) => (
              <tr key={x.id} className="border-b border-ink-100/70 dark:border-ink-800">
                <td className="td num text-[12px]">{fmtD(x.date)}</td>
                <td className="td"><Badge tone="slate"><TrendingDown size={10} /> {x.category}</Badge></td>
                <td className="td font-medium">{x.vendor}</td>
                <td className="td text-[12px] text-ink-400">{x.notes || "—"}</td>
                <td className="td num text-right font-bold text-red-500">{inr(x.amount)}</td>
                <td className="td">{can("expenses", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => { if (window.confirm("Delete expense?")) mutate((db) => { db.expenses = db.expenses.filter((y) => y.id !== x.id); }); }}><X size={13} /></button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {d.expenses.length === 0 && <EmptyState icon={<TrendingDown size={24} />} title="No expenses" />}
          </div>
        </div>
      )}

      {modal && <Modal open onClose={() => setModal(false)} title="New invoice" wide><InvoiceModal initial={{ date: todayISO(), dueDate: addDaysISO(15) }} onDone={() => setModal(false)} editing={false} /></Modal>}
      {editId && <Modal open onClose={() => setEditId(null)} title="Edit invoice draft" wide><InvoiceModal initial={{ ...d.invoices.find((x) => x.id === editId)! }} onDone={() => setEditId(null)} editing /></Modal>}
      {payForId && <Modal open onClose={() => setPayForId(null)} title="Record payment"><PaymentModal invoiceId={payForId === "any" ? undefined : payForId} onDone={() => setPayForId(null)} /></Modal>}
      {expModal && (
        <Modal open onClose={() => setExpModal(false)} title="Add expense">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category"><Select value={exp.category} onChange={(e) => setExp((p) => ({ ...p, category: e.target.value }))}>{["Office Rent", "Salaries", "Advertising", "Travel", "Software", "Utilities", "Misc"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Vendor" req><Input value={exp.vendor} onChange={(e) => setExp((p) => ({ ...p, vendor: e.target.value }))} /></Field>
            <Field label="Amount (₹)" req><Input type="number" value={exp.amount || ""} onChange={(e) => setExp((p) => ({ ...p, amount: Number(e.target.value) }))} /></Field>
            <Field label="Date"><Input type="date" value={exp.date} onChange={(e) => setExp((p) => ({ ...p, date: e.target.value }))} /></Field>
            <Field label="Notes" className="col-span-2"><Textarea value={exp.notes} onChange={(e) => setExp((p) => ({ ...p, notes: e.target.value }))} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setExpModal(false)}>Cancel</Btn><Btn onClick={saveExpense}>Save expense</Btn></div>
        </Modal>
      )}
      {open && (
        <Drawer open onClose={() => { setOpenId(null); setParams({ tab }); }} title={<span className="num">{open.number}</span>} headerExtra={<Btn variant="outline" size="sm" onClick={() => doPrint(open)}><Printer size={13} /> PDF</Btn>}>
          <div className="p-5">
            {(() => {
              const t = docTotals(open.items, open.discountPct).total; const p = paidFor(d, open.id);
              return (
                <div className="mb-4 grid grid-cols-3 gap-3">
                  <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Total</div><Money v={t} className="text-lg font-bold text-ink-800 dark:text-ink-100" /></div>
                  <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Paid</div><Money v={p} className="text-lg font-bold text-emerald-600" /></div>
                  <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Balance</div><Money v={Math.max(0, t - p)} className={`text-lg font-bold ${t - p > 0 ? "text-red-500" : "text-ink-500"}`} /></div>
                </div>
              );
            })()}
            <div className="mb-2 flex items-center justify-between"><h4 className="hd text-[13.5px]">Payment history</h4>
              {can("payments", "create") && open.status !== "Cancelled" && <Btn size="xs" onClick={() => setPayForId(open.id)}><Wallet size={12} /> Record</Btn>}</div>
            {d.payments.filter((p) => p.invoiceId === open.id).map((p) => (
              <div key={p.id} className="mb-2 flex items-center justify-between rounded-md border border-ink-100 p-2.5 dark:border-ink-800">
                <span className="text-[12.5px]">{fmtD(p.date)} · {p.mode}{p.txnId ? ` · ${p.txnId}` : ""}</span>
                <Money v={p.amount} className="font-bold text-emerald-600" />
              </div>
            ))}
            {d.payments.filter((p) => p.invoiceId === open.id).length === 0 && <p className="text-[12.5px] text-ink-400">No payments yet.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <Btn variant="outline" size="sm" onClick={() => sendReminder(open)}><MessageCircle size={13} /> WhatsApp reminder</Btn>
              {open.status === "Draft" && can("invoices", "edit") && <Btn size="sm" onClick={() => markSent(open)}><Send size={13} /> Mark sent</Btn>}
            </div>
            {open.notes && <p className="mt-3 rounded-md bg-ink-50 p-3 text-[12px] text-ink-500 dark:bg-ink-800/60">{open.notes}</p>}
          </div>
        </Drawer>
      )}
    </div>
  );
}
export { runTriggers };
