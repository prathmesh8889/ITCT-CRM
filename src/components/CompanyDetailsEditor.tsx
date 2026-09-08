import { useState } from "react";
import { Building2, Pencil } from "lucide-react";
import { useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { mutate } from "../lib/db";
import { useStore } from "../store";
import { Btn, Field, Input, Modal, Select, Textarea } from "./ui";

type CompanyForm = {
  name: string; legalName: string; ownerName: string; tagline: string;
  email: string; phone: string; website: string; address: string; city: string; state: string; postalCode: string;
  gstin: string; pan: string; cin: string; currency: string; timezone: string; logoMark: string;
  bankName: string; accountName: string; accountNumber: string; ifsc: string;
};
const empty: CompanyForm = {
  name: "", legalName: "", ownerName: "", tagline: "", email: "", phone: "", website: "", address: "", city: "", state: "", postalCode: "",
  gstin: "", pan: "", cin: "", currency: "INR", timezone: "Asia/Kolkata", logoMark: "I", bankName: "", accountName: "", accountNumber: "", ifsc: "",
};

export default function CompanyDetailsEditor() {
  const loc = useLocation();
  const { roleName, can, toast } = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CompanyForm>(empty);
  const [busy, setBusy] = useState(false);
  const owner = ["Super Admin", "Admin", "Company Owner"].includes(roleName) || can("settings", "edit");
  if (loc.pathname !== "/settings" || !owner) return null;

  const show = async () => {
    setBusy(true);
    try {
      const r = await api.get<Record<string, unknown>>("/settings");
      const c = (r.data.company || {}) as Record<string, unknown>;
      const val = (camel: string, snake?: string) => String(c[camel] ?? (snake ? c[snake] : "") ?? "");
      setForm({
        name: val("name"), legalName: val("legalName", "legal_name"), ownerName: val("ownerName", "owner_name"), tagline: val("tagline"),
        email: val("email"), phone: val("phone"), website: val("website"), address: val("address"), city: val("city"), state: val("state"), postalCode: val("postalCode", "postal_code"),
        gstin: val("gstin"), pan: val("pan"), cin: val("cin"), currency: val("currency") || "INR", timezone: val("timezone") || "Asia/Kolkata", logoMark: val("logoMark", "logo_mark") || "I",
        bankName: val("bankName", "bank_name"), accountName: val("accountName", "account_name"), accountNumber: val("accountNumber", "account_number"), ifsc: val("ifsc"),
      });
      setOpen(true);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not load company details", "err"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!form.name.trim()) { toast("Company name is required", "err"); return; }
    setBusy(true);
    try {
      await api.put("/settings/company", { company: form });
      mutate((db) => Object.assign(db.settings.company, {
        name: form.name, tagline: form.tagline, email: form.email, phone: form.phone, website: form.website,
        address: form.address, gstin: form.gstin, pan: form.pan, currency: form.currency, timezone: form.timezone, logoMark: form.logoMark,
      }));
      toast("Company details saved", "ok", "Owner/company information is now updated in CRM settings.");
      setOpen(false);
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save company details", "err"); }
    finally { setBusy(false); }
  };

  return <>
    <button onClick={() => void show()} className="fixed right-5 top-[68px] z-30 flex items-center gap-2 rounded-lg border border-brand-300 bg-surface px-3 py-2 text-[12px] font-semibold text-brand-700 shadow-md hover:bg-brand-50 dark:border-brand-800 dark:bg-ink-900 dark:text-brand-300" title="Edit real company details">
      <Pencil size={14} /> Edit company details
    </button>
    {open && <Modal open wide onClose={() => !busy && setOpen(false)} title="Edit Company Details" footer={<><Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}><Building2 size={14} /> Save Company Details</Btn></>}>
      <div className="mb-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-[11.5px] text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-200">Company Owner can maintain the real legal, contact, tax and banking details here. These values are persisted to PostgreSQL.</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Display company name" req><Input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></Field>
        <Field label="Legal company name"><Input value={form.legalName} onChange={(e) => setForm((p) => ({ ...p, legalName: e.target.value }))} /></Field>
        <Field label="Company owner / director"><Input value={form.ownerName} onChange={(e) => setForm((p) => ({ ...p, ownerName: e.target.value }))} /></Field>
        <Field label="Tagline"><Input value={form.tagline} onChange={(e) => setForm((p) => ({ ...p, tagline: e.target.value }))} /></Field>
        <Field label="Official email"><Input type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></Field>
        <Field label="Official phone"><Input value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></Field>
        <Field label="Website"><Input value={form.website} onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))} /></Field>
        <Field label="Logo letter"><Input maxLength={1} value={form.logoMark} onChange={(e) => setForm((p) => ({ ...p, logoMark: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Registered address" className="sm:col-span-2"><Textarea value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} /></Field>
        <Field label="City"><Input value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} /></Field>
        <Field label="State"><Input value={form.state} onChange={(e) => setForm((p) => ({ ...p, state: e.target.value }))} /></Field>
        <Field label="Postal / PIN code"><Input value={form.postalCode} onChange={(e) => setForm((p) => ({ ...p, postalCode: e.target.value }))} /></Field>
        <Field label="CIN"><Input value={form.cin} onChange={(e) => setForm((p) => ({ ...p, cin: e.target.value }))} /></Field>
        <Field label="GSTIN"><Input value={form.gstin} onChange={(e) => setForm((p) => ({ ...p, gstin: e.target.value }))} /></Field>
        <Field label="PAN"><Input value={form.pan} onChange={(e) => setForm((p) => ({ ...p, pan: e.target.value }))} /></Field>
        <Field label="Currency"><Select value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}><option value="INR">INR</option></Select></Field>
        <Field label="Timezone"><Input value={form.timezone} onChange={(e) => setForm((p) => ({ ...p, timezone: e.target.value }))} /></Field>
        <Field label="Bank name"><Input value={form.bankName} onChange={(e) => setForm((p) => ({ ...p, bankName: e.target.value }))} /></Field>
        <Field label="Account name"><Input value={form.accountName} onChange={(e) => setForm((p) => ({ ...p, accountName: e.target.value }))} /></Field>
        <Field label="Account number"><Input value={form.accountNumber} onChange={(e) => setForm((p) => ({ ...p, accountNumber: e.target.value }))} /></Field>
        <Field label="IFSC"><Input value={form.ifsc} onChange={(e) => setForm((p) => ({ ...p, ifsc: e.target.value.toUpperCase() }))} /></Field>
      </div>
    </Modal>}
  </>;
}
