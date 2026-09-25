import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, Phone, MessageCircle, Mail, Building2, Users, UserCircle2 } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB } from "../lib/db";
import { waLink, telLink, docTotals, paidFor, fmtD, inr } from "../lib/services";
import type { Customer, Company, Contact } from "../lib/types";
import type { ApiCustomer } from "../lib/apiTypes";
import { customerApi, companyApi, contactApi } from "../lib/api";
import { fromApiCustomer, toApiCustomer } from "../lib/mappers";
import { Btn, Badge, Modal, Drawer, Field, Input, Select, Textarea, Tabs, EmptyState, Avatar, statusTone, Money } from "../components/ui";

const companyFromApi = (c: any): Company => ({
  id: String(c.id), name: c.name || "", industry: c.industry || "", website: c.website || "",
  phone: c.phone || "", email: c.email || "", city: c.city || "", state: c.state || "",
  address: c.address || "", gstin: c.gst || "", notes: c.notes || "", createdAt: c.created_at,
});
const contactFromApi = (c: any): Contact => ({
  id: String(c.id), name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
  title: c.designation || "", companyId: c.company_id == null ? undefined : String(c.company_id),
  phone: c.phone || "", email: c.email || "", whatsapp: c.whatsapp || "",
  city: c.city || "", notes: c.notes || "", createdAt: c.created_at,
});
const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first_name: parts.shift() || "", last_name: parts.join(" ") };
};

// ---------- customers ----------
function CustomerModal({ initial, onDone, editing }: { initial: Partial<Customer>; onDone: () => void; editing: boolean }) {
  const { toast } = useStore();
  const d = useDB();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Customer, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!f.company?.trim()) { toast("Company name is required", "err"); return; }
    setBusy(true);
    try {
      const payload = toApiCustomer({
        ...f,
        name: f.name?.trim() || f.company.trim(),
        company: f.company.trim(),
        whatsapp: f.whatsapp || f.phone || "",
        shippingAddress: f.shippingAddress || f.billingAddress || "",
        country: f.country || "India",
        status: (f.status as Customer["status"]) || "Active",
      });
      const r = editing && f.id
        ? await customerApi.update(Number(f.id), payload)
        : await customerApi.create(payload);
      const row = fromApiCustomer(r.data as ApiCustomer);
      mutate((db) => {
        const index = db.customers.findIndex((x) => x.id === row.id);
        if (index >= 0) db.customers[index] = row;
        else db.customers.unshift(row);
      });
      toast(editing ? "Customer updated" : "Customer created", "ok", row.company);
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save customer", "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Company" req><Input value={f.company || ""} onChange={(e) => set("company", e.target.value)} /></Field>
      <Field label="Contact name"><Input value={f.name || ""} onChange={(e) => set("name", e.target.value)} /></Field>
      <Field label="Phone"><Input value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} /></Field>
      <Field label="Email"><Input value={f.email || ""} onChange={(e) => set("email", e.target.value)} /></Field>
      <Field label="WhatsApp"><Input value={f.whatsapp || ""} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
      <Field label="GSTIN"><Input value={f.gstin || ""} onChange={(e) => set("gstin", e.target.value)} /></Field>
      <Field label="PAN"><Input value={f.pan || ""} onChange={(e) => set("pan", e.target.value)} /></Field>
      <Field label="City"><Input value={f.city || ""} onChange={(e) => set("city", e.target.value)} /></Field>
      <Field label="Billing address" className="col-span-2"><Textarea value={f.billingAddress || ""} onChange={(e) => set("billingAddress", e.target.value)} /></Field>
      <Field label="Account manager"><Select value={f.managerId || ""} onChange={(e) => set("managerId", e.target.value || null)}><option value="">—</option>{d.users.filter((u) => u.isSales && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      <Field label="Status"><Select value={f.status || "Active"} onChange={(e) => set("status", e.target.value as Customer["status"])}><option>Active</option><option>Inactive</option><option>On Hold</option></Select></Field>
      <div className="col-span-2 flex justify-end gap-2"><Btn variant="ghost" onClick={onDone}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{editing ? "Save" : "Create customer"}</Btn></div>
    </div>
  );
}

function CustomerDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: () => void }) {
  const { user, toast } = useStore();
  const d = useDB();
  const [tab, setTab] = useState("overview");
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const c = d.customers.find((x) => x.id === id);
  if (!c) return null;
  const deals = d.deals.filter((x) => x.customerId === c.id);
  const quotes = d.quotations.filter((x) => x.customerId === c.id);
  const invoices = d.invoices.filter((x) => x.customerId === c.id);
  const payments = d.payments.filter((x) => x.customerId === c.id);
  const fus = d.followups.filter((x) => x.entityId === c.id);
  const acts = d.activities.filter((a) => a.entityId === c.id || invoices.some((i) => i.id === a.entityId));
  const outstanding = invoices.reduce((a, i) => a + Math.max(0, docTotals(i.items, i.discountPct).total - paidFor(d, i.id)), 0);
  const mgr = d.users.find((u) => u.id === c.managerId);
  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2"><Building2 size={16} className="text-brand-600" /> {c.company}<Badge tone={statusTone(c.status)}>{c.status}</Badge></span>}
      headerExtra={<Btn variant="ghost" size="sm" onClick={onEdit}><Pencil size={13} /> Edit</Btn>}>
      <div className="p-5">
        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Lifetime value</div><Money v={payments.reduce((a, b) => a + b.amount, 0)} className="text-lg font-bold text-emerald-600" /></div>
          <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Outstanding</div><Money v={outstanding} className={`text-lg font-bold ${outstanding ? "text-red-500" : "text-ink-600 dark:text-ink-300"}`} /></div>
          <div className="card p-3 text-center"><div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">Open deals</div><div className="num text-lg font-bold text-ink-700 dark:text-ink-100">{deals.filter((x) => d.dealStages.find((s) => s.id === x.stageId)?.kind === "open").length}</div></div>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {c.phone && <Btn variant="outline" size="sm" onClick={() => window.open(telLink(c.phone), "_self")}><Phone size={13} /> Call</Btn>}
          {c.whatsapp && <Btn variant="outline" size="sm" onClick={() => { const t = d.templates.find((t) => t.channel === "whatsapp" && t.name === "Follow-up"); window.open(waLink(c.whatsapp, t ? t.body.replace(/\{\{customer_name\}\}/g, c.name).replace(/\{\{employee_name\}\}/g, user?.name || "").replace(/\{\{company_name\}\}/g, d.settings.company.name) : ""), "_blank"); }}><MessageCircle size={13} /> WhatsApp</Btn>}
          {c.email && <Btn variant="outline" size="sm" onClick={() => window.open(`mailto:${c.email}?subject=${encodeURIComponent("Following up — " + d.settings.company.name)}`)}><Mail size={13} /> Email</Btn>}
        </div>
        <Tabs tabs={[{ key: "overview", label: "Overview" }, { key: "deals", label: "Deals", count: deals.length }, { key: "quotes", label: "Quotations", count: quotes.length }, { key: "invoices", label: "Invoices", count: invoices.length }, { key: "payments", label: "Payments", count: payments.length }, { key: "followups", label: "Follow-ups", count: fus.length }, { key: "activity", label: "Activity", count: acts.length }]} active={tab} onChange={setTab} />
        <div className="a-fade-up mt-4">
          {tab === "overview" && (
            <div>
              {[["Contact", c.name], ["Phone", c.phone || "—"], ["Email", c.email || "—"], ["GSTIN", c.gstin || "—"], ["PAN", c.pan || "—"], ["City", c.city], ["Billing address", c.billingAddress || "—"], ["Manager", mgr?.name || "—"], ["Since", fmtD(c.createdAt)], ["Notes", c.notes || "—"]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-ink-100 py-2 text-[13px] last:border-0 dark:border-ink-800"><span className="text-ink-400">{k}</span><span className="max-w-[60%] text-right font-medium text-ink-700 dark:text-ink-200">{v}</span></div>
              ))}
              <div className="card mt-3 p-3">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" />
                <div className="mt-2 flex justify-end"><Btn size="sm" loading={noteBusy} disabled={!note.trim()} onClick={() => void (async () => {
                  setNoteBusy(true);
                  try {
                    const r = await customerApi.addNote(Number(c.id), note.trim());
                    const n: any = r.data;
                    mutate((db) => db.notes.unshift({ id: String(n.id), entityType: "customer", entityId: String(n.entity_id), body: n.body || "", authorId: String(n.author_id || user!.id), createdAt: n.created_at }));
                    setNote("");
                    toast("Note saved", "ok");
                  } catch (e) { toast(e instanceof Error ? e.message : "Could not save note", "err"); }
                  finally { setNoteBusy(false); }
                })()}>Save note</Btn></div>
              </div>
              {d.notes.filter((n) => n.entityId === c.id).map((n) => <div key={n.id} className="card mt-2 p-2.5 text-[12.5px] text-ink-600 dark:text-ink-300">{n.body}<div className="num mt-1 text-[10px] text-ink-400">{fmtD(n.createdAt)}</div></div>)}
            </div>
          )}
          {tab === "deals" && (deals.length === 0 ? <EmptyState title="No deals" /> : deals.map((x) => (
            <div key={x.id} className="mb-2 flex items-center justify-between rounded-md border border-ink-100 p-2.5 dark:border-ink-800"><span className="text-[13px] font-medium">{x.title}</span><span className="flex items-center gap-2"><Badge tone={statusTone(d.dealStages.find((s) => s.id === x.stageId)?.name || "")}>{d.dealStages.find((s) => s.id === x.stageId)?.name}</Badge><Money v={x.value} className="text-[12px] font-semibold" /></span></div>
          )))}
          {tab === "quotes" && (quotes.length === 0 ? <EmptyState title="No quotations" /> : quotes.map((x) => (
            <div key={x.id} className="mb-2 flex items-center justify-between rounded-md border border-ink-100 p-2.5 dark:border-ink-800"><span className="num text-[12.5px] font-semibold">{x.number}</span><span className="flex items-center gap-2"><Badge tone={statusTone(x.status)}>{x.status}</Badge><Money v={docTotals(x.items, x.discountPct).total} className="text-[12px] font-semibold" /></span></div>
          )))}
          {tab === "invoices" && (invoices.length === 0 ? <EmptyState title="No invoices" /> : invoices.map((x) => {
            const t = docTotals(x.items, x.discountPct).total; const p = paidFor(d, x.id);
            return <div key={x.id} className="mb-2 rounded-md border border-ink-100 p-2.5 dark:border-ink-800"><div className="flex items-center justify-between"><span className="num text-[12.5px] font-semibold">{x.number}</span><Badge tone={statusTone(x.status)}>{x.status}</Badge></div><div className="num mt-1 text-[11px] text-ink-400">total {inr(t)} · paid {inr(p)} · due {fmtD(x.dueDate)}</div></div>;
          }))}
          {tab === "payments" && (payments.length === 0 ? <EmptyState title="No payments" /> : payments.map((p) => (
            <div key={p.id} className="mb-2 flex items-center justify-between rounded-md border border-ink-100 p-2.5 dark:border-ink-800"><span className="text-[12.5px]">{fmtD(p.date)} · {p.mode}{p.txnId ? ` · ${p.txnId}` : ""}</span><Money v={p.amount} className="text-[12.5px] font-bold text-emerald-600" /></div>
          )))}
          {tab === "followups" && (fus.length === 0 ? <EmptyState title="No follow-ups" /> : fus.map((f) => (
            <div key={f.id} className="mb-2 flex items-center justify-between rounded-md border border-ink-100 p-2.5 dark:border-ink-800"><span className="text-[12.5px] font-medium">{f.type} · {fmtD(f.date)} {f.time}</span><Badge tone={statusTone(f.status)}>{f.status}</Badge></div>
          )))}
          {tab === "activity" && (acts.length === 0 ? <EmptyState title="No activity" /> : acts.map((a) => (
            <div key={a.id} className="border-l-2 border-brand-200 py-1.5 pl-3 dark:border-brand-800"><span className="text-[12.5px] font-medium">{a.action}</span><span className="ml-2 text-[11.5px] text-ink-400">{a.detail}</span><div className="num text-[10px] text-ink-400">{fmtD(a.at)}</div></div>
          )))}
        </div>
      </div>
    </Drawer>
  );
}

export default function Relations() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "customers";
  const [q, setQ] = useState("");
  const [custModal, setCustModal] = useState<{ open: boolean; editing: boolean; id?: string }>({ open: false, editing: false });
  const [drawerId, setDrawerId] = useState<string | null>(params.get("open"));
  const [coModal, setCoModal] = useState(false);
  const [coEdit, setCoEdit] = useState<Company | null>(null);
  const [ctModal, setCtModal] = useState(false);
  const [ctEdit, setCtEdit] = useState<Contact | null>(null);
  const [coForm, setCoForm] = useState<Partial<Company>>({});
  const [ctForm, setCtForm] = useState<Partial<Contact>>({});
  const [relBusy, setRelBusy] = useState(false);
  useEffect(() => { setDrawerId(params.get("open")); }, [params]);

  const customers = useMemo(() => {
    const s = q.toLowerCase();
    return d.customers.filter((c) => !s || [c.company, c.name, c.city, c.phone, c.email].some((v) => String(v || "").toLowerCase().includes(s)));
  }, [d.customers, q]);
  const companies = useMemo(() => d.companies.filter((c) => !q || [c.name, c.city].some((v) => String(v || "").toLowerCase().includes(q.toLowerCase()))), [d.companies, q]);
  const contacts = useMemo(() => d.contacts.filter((c) => !q || [c.name, c.email, c.phone].some((v) => String(v || "").toLowerCase().includes(q.toLowerCase()))), [d.contacts, q]);

  const removeCustomer = async (c: Customer) => {
    if (!window.confirm(`Delete customer ${c.company || c.name}?`)) return;
    try {
      await customerApi.remove(Number(c.id));
      mutate((db) => {
        db.customers = db.customers.filter((x) => x.id !== c.id);
        db.notes = db.notes.filter((n) => !(n.entityType === "customer" && n.entityId === c.id));
      });
      if (drawerId === c.id) { setDrawerId(null); setParams({ tab: "customers" }); }
      toast("Customer deleted", "warn");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete customer", "err"); }
  };
  const removeCompany = async (c: Company) => {
    if (!window.confirm(`Delete company ${c.name}? Linked contacts will be kept but unlinked.`)) return;
    try {
      await companyApi.remove(Number(c.id));
      mutate((db) => {
        db.companies = db.companies.filter((x) => x.id !== c.id);
        db.contacts = db.contacts.map((x) => x.companyId === c.id ? { ...x, companyId: undefined } : x);
      });
      toast("Company deleted", "warn");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete company", "err"); }
  };
  const removeContact = async (c: Contact) => {
    if (!window.confirm(`Delete contact ${c.name}?`)) return;
    try {
      await contactApi.remove(Number(c.id));
      mutate((db) => { db.contacts = db.contacts.filter((x) => x.id !== c.id); });
      toast("Contact deleted", "warn");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete contact", "err"); }
  };

  const saveCo = async () => {
    if (!coForm.name?.trim()) { toast("Company name required", "err"); return; }
    setRelBusy(true);
    try {
      const body = {
        name: coForm.name.trim(), industry: coForm.industry || "", website: coForm.website || "",
        phone: coForm.phone || "", email: coForm.email || "", city: coForm.city || "", state: coForm.state || "",
        address: coForm.address || "", gst: coForm.gstin || "", notes: coForm.notes || "",
      };
      const r = coEdit ? await companyApi.update(Number(coEdit.id), body) : await companyApi.create(body);
      const row = companyFromApi(r.data);
      mutate((db) => {
        const index = db.companies.findIndex((x) => x.id === row.id);
        if (index >= 0) db.companies[index] = row; else db.companies.unshift(row);
      });
      toast(coEdit ? "Company updated" : "Company created", "ok");
      setCoModal(false); setCoEdit(null); setCoForm({});
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save company", "err"); }
    finally { setRelBusy(false); }
  };
  const saveCt = async () => {
    if (!ctForm.name?.trim()) { toast("Contact name required", "err"); return; }
    setRelBusy(true);
    try {
      const names = splitName(ctForm.name);
      const body = {
        ...names, designation: ctForm.title || "", company_id: ctForm.companyId ? Number(ctForm.companyId) : null,
        phone: ctForm.phone || "", email: ctForm.email || "", whatsapp: ctForm.whatsapp || "",
        city: ctForm.city || "", notes: ctForm.notes || "",
      };
      const r = ctEdit ? await contactApi.update(Number(ctEdit.id), body) : await contactApi.create(body);
      const row = contactFromApi(r.data);
      mutate((db) => {
        const index = db.contacts.findIndex((x) => x.id === row.id);
        if (index >= 0) db.contacts[index] = row; else db.contacts.unshift(row);
      });
      toast(ctEdit ? "Contact updated" : "Contact created", "ok");
      setCtModal(false); setCtEdit(null); setCtForm({});
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save contact", "err"); }
    finally { setRelBusy(false); }
  };

  return (
    <div className="mx-auto max-w-[1300px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="hd text-[22px]">Relationships</h1>
          <p className="text-[12.5px] text-ink-500">{d.customers.length} customers · {d.companies.length} companies · {d.contacts.length} contacts</p>
        </div>
        <div className="flex gap-2">
          {tab === "companies" && can("companies", "create") && <Btn size="sm" onClick={() => { setCoForm({}); setCoEdit(null); setCoModal(true); }}><Plus size={14} /> Company</Btn>}
          {tab === "contacts" && can("contacts", "create") && <Btn size="sm" onClick={() => { setCtForm({}); setCtEdit(null); setCtModal(true); }}><Plus size={14} /> Contact</Btn>}
          {tab === "customers" && can("customers", "create") && <Btn size="sm" onClick={() => setCustModal({ open: true, editing: false })}><Plus size={14} /> Customer</Btn>}
        </div>
      </div>
      <Tabs className="mb-4" tabs={[{ key: "customers", label: "Customers", count: d.customers.length }, { key: "companies", label: "Companies", count: d.companies.length }, { key: "contacts", label: "Contacts", count: d.contacts.length }]} active={tab} onChange={(k) => setParams({ tab: k })} />
      <div className="relative mb-4 max-w-sm"><Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-8" /></div>

      {tab === "customers" && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Company</th><th className="th">Contact</th><th className="th">City</th><th className="th">Phone</th><th className="th">Manager</th><th className="th">Outstanding</th><th className="th">Status</th><th className="th w-10"></th></tr></thead>
            <tbody>{customers.map((c) => {
              const out = d.invoices.filter((i) => i.customerId === c.id && !["Cancelled", "Draft", "Paid"].includes(i.status)).reduce((a, i) => a + Math.max(0, docTotals(i.items, i.discountPct).total - paidFor(d, i.id)), 0);
              const mgr = d.users.find((u) => u.id === c.managerId);
              return (
                <tr key={c.id} className="cursor-pointer border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50" onClick={() => setDrawerId(c.id)}>
                  <td className="td font-semibold text-ink-900 dark:text-ink-50">{c.company}</td>
                  <td className="td">{c.name}</td><td className="td text-ink-500">{c.city || "—"}</td>
                  <td className="td num text-[12px]">{c.phone || "—"}</td>
                  <td className="td">{mgr ? <span className="flex items-center gap-1.5"><Avatar name={mgr.name} color={mgr.color} size={20} />{mgr.name.split(" ")[0]}</span> : "—"}</td>
                  <td className="td">{out ? <Money v={out} className="font-semibold text-red-500" /> : <span className="text-ink-300">—</span>}</td>
                  <td className="td"><Badge tone={statusTone(c.status)}>{c.status}</Badge></td>
                  <td className="td" onClick={(e) => e.stopPropagation()}><div className="flex gap-1">{can("customers", "edit") && <button className="rounded p-1 text-ink-400 hover:text-brand-600" onClick={() => setCustModal({ open: true, editing: true, id: c.id })}><Pencil size={13} /></button>}{can("customers", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => void removeCustomer(c)}><Trash2 size={13} /></button>}</div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          {customers.length === 0 && <EmptyState icon={<Users size={24} />} title="No customers" body="Convert a lead or add a customer manually." />}
        </div>
      )}

      {tab === "companies" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => (
            <div key={c.id} className="card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between">
                <div><div className="hd text-[14px]">{c.name}</div><div className="text-[11.5px] text-ink-400">{c.industry} · {c.city}</div></div>
                <div className="flex gap-1">{can("companies", "edit") && <button className="rounded p-1 text-ink-400 hover:text-brand-600" onClick={() => { setCoEdit(c); setCoForm(c); setCoModal(true); }}><Pencil size={13} /></button>}{can("companies", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => void removeCompany(c)}><Trash2 size={13} /></button>}</div>
              </div>
              <div className="num mt-2 space-y-0.5 text-[11.5px] text-ink-500">
                {c.phone && <div>{c.phone}</div>}{c.email && <div>{c.email}</div>}{c.website && <div className="text-brand-600">{c.website}</div>}
              </div>
              <div className="mt-2 text-[11px] text-ink-400">{d.contacts.filter((x) => x.companyId === c.id).length} contact(s) · {d.customers.filter((x) => x.company === c.name).length} customer account(s)</div>
            </div>
          ))}
          {companies.length === 0 && <EmptyState icon={<Building2 size={24} />} title="No companies" />}
        </div>
      )}

      {tab === "contacts" && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full">
            <thead className="border-b border-ink-200/70 bg-ink-50/70 dark:border-ink-700 dark:bg-ink-800/50"><tr><th className="th">Name</th><th className="th">Title</th><th className="th">Company</th><th className="th">Phone</th><th className="th">Email</th><th className="th">City</th><th className="th w-10"></th></tr></thead>
            <tbody>{contacts.map((c) => (
              <tr key={c.id} className="border-b border-ink-100/70 transition-colors hover:bg-brand-50/40 dark:border-ink-800 dark:hover:bg-ink-800/50">
                <td className="td font-semibold">{c.name}</td><td className="td text-ink-500">{c.title}</td>
                <td className="td">{d.companies.find((x) => x.id === c.companyId)?.name || "—"}</td>
                <td className="td num text-[12px]">{c.phone}</td><td className="td text-[12px]">{c.email}</td><td className="td text-ink-500">{c.city}</td>
                <td className="td"><div className="flex gap-1">{can("contacts", "edit") && <button className="rounded p-1 text-ink-400 hover:text-brand-600" onClick={() => { setCtEdit(c); setCtForm(c); setCtModal(true); }}><Pencil size={13} /></button>}{can("contacts", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => void removeContact(c)}><Trash2 size={13} /></button>}</div></td>
              </tr>
            ))}</tbody>
          </table></div>
          {contacts.length === 0 && <EmptyState icon={<UserCircle2 size={24} />} title="No contacts" />}
        </div>
      )}

      {custModal.open && (
        <Modal open onClose={() => setCustModal({ open: false, editing: false })} title={custModal.editing ? "Edit customer" : "New customer"} wide>
          <CustomerModal initial={custModal.editing ? { ...d.customers.find((c) => c.id === custModal.id)! } : { status: "Active" }} onDone={() => setCustModal({ open: false, editing: false })} editing={custModal.editing} />
        </Modal>
      )}
      {drawerId && <CustomerDrawer id={drawerId} onClose={() => { setDrawerId(null); setParams({ tab }); }} onEdit={() => { setCustModal({ open: true, editing: true, id: drawerId }); }} />}
      {coModal && (
        <Modal open onClose={() => setCoModal(false)} title={coEdit ? "Edit company" : "New company"}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" req className="col-span-2"><Input value={coForm.name || ""} onChange={(e) => setCoForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Industry"><Input value={coForm.industry || ""} onChange={(e) => setCoForm((f) => ({ ...f, industry: e.target.value }))} /></Field>
            <Field label="City"><Input value={coForm.city || ""} onChange={(e) => setCoForm((f) => ({ ...f, city: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={coForm.phone || ""} onChange={(e) => setCoForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="Email"><Input value={coForm.email || ""} onChange={(e) => setCoForm((f) => ({ ...f, email: e.target.value }))} /></Field>
            <Field label="Website"><Input value={coForm.website || ""} onChange={(e) => setCoForm((f) => ({ ...f, website: e.target.value }))} /></Field>
            <Field label="GSTIN"><Input value={coForm.gstin || ""} onChange={(e) => setCoForm((f) => ({ ...f, gstin: e.target.value }))} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setCoModal(false)}>Cancel</Btn><Btn loading={relBusy} onClick={() => void saveCo()}>Save</Btn></div>
        </Modal>
      )}
      {ctModal && (
        <Modal open onClose={() => setCtModal(false)} title={ctEdit ? "Edit contact" : "New contact"}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" req><Input value={ctForm.name || ""} onChange={(e) => setCtForm((f) => ({ ...f, name: e.target.value }))} /></Field>
            <Field label="Title"><Input value={ctForm.title || ""} onChange={(e) => setCtForm((f) => ({ ...f, title: e.target.value }))} /></Field>
            <Field label="Company"><Select value={ctForm.companyId || ""} onChange={(e) => setCtForm((f) => ({ ...f, companyId: e.target.value || undefined }))}><option value="">—</option>{d.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="City"><Input value={ctForm.city || ""} onChange={(e) => setCtForm((f) => ({ ...f, city: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={ctForm.phone || ""} onChange={(e) => setCtForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
            <Field label="Email"><Input value={ctForm.email || ""} onChange={(e) => setCtForm((f) => ({ ...f, email: e.target.value }))} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setCtModal(false)}>Cancel</Btn><Btn loading={relBusy} onClick={() => void saveCt()}>Save</Btn></div>
        </Modal>
      )}
    </div>
  );
}
