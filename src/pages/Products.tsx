import { useState } from "react";
import { Plus, Pencil, Package, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB, uid } from "../lib/db";
import { logAct, inr } from "../lib/services";
import type { Product } from "../lib/types";
import { Btn, Badge, Modal, Field, Input, Select, Textarea, EmptyState, Money, Toggle } from "../components/ui";

export default function Products() {
  const { user, can, toast } = useStore();
  const d = useDB();
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [f, setF] = useState<Partial<Product>>({ unit: "project", gstPct: 18, active: true, category: "Development" });
  const save = () => {
    if (!f.name?.trim() || !f.sku?.trim()) { toast("Name and SKU are required", "err"); return; }
    if (edit) { mutate((db) => { const p = db.products.find((x) => x.id === edit.id); if (p) Object.assign(p, f); }); toast("Product updated"); }
    else { mutate((db) => db.products.unshift({ id: uid(), name: f.name!, sku: f.sku!, category: f.category || "General", description: f.description || "", unit: f.unit || "unit", price: f.price || 0, gstPct: f.gstPct ?? 18, active: f.active ?? true })); logAct("product", "new", user!.id, "Product created", f.name); toast("Product added"); }
    setModal(false); setEdit(null); setF({ unit: "project", gstPct: 18, active: true, category: "Development" });
  };
  return (
    <div className="mx-auto max-w-[1100px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="hd text-[22px]">Products & Services</h1><p className="text-[12.5px] text-ink-500">Catalog used by quotations and invoices · {d.products.length} items</p></div>
        {can("products", "create") && <Btn size="sm" onClick={() => { setEdit(null); setF({ unit: "project", gstPct: 18, active: true, category: "Development" }); setModal(true); }}><Plus size={14} /> Add product</Btn>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {d.products.map((p) => (
          <div key={p.id} className={`card p-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${p.active ? "" : "opacity-55"}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="hd text-[14px]">{p.name}</div>
                <div className="num text-[10.5px] text-ink-400">{p.sku} · {p.category}</div>
              </div>
              <Badge tone={p.active ? "green" : "slate"}>{p.active ? "Active" : "Inactive"}</Badge>
            </div>
            <p className="mt-2 min-h-[34px] text-[12px] leading-snug text-ink-500">{p.description}</p>
            <div className="mt-2 flex items-end justify-between">
              <div><Money v={p.price} className="text-[17px] font-bold text-brand-700 dark:text-brand-300" /><span className="text-[10.5px] text-ink-400"> / {p.unit} · GST {p.gstPct}%</span></div>
              {can("products", "edit") && (
                <div className="flex gap-1">
                  <button className="rounded p-1 text-ink-400 hover:text-brand-600" onClick={() => { setEdit(p); setF(p); setModal(true); }}><Pencil size={13} /></button>
                  {can("products", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => { if (window.confirm(`Delete ${p.name}?`)) { mutate((db) => { db.products = db.products.filter((x) => x.id !== p.id); }); toast("Product deleted", "warn"); } }}><Trash2 size={13} /></button>}
                </div>
              )}
            </div>
            {can("products", "edit") && <div className="mt-2 border-t border-ink-100 pt-2 dark:border-ink-800"><Toggle on={p.active} onChange={(v) => mutate((db) => { const x = db.products.find((y) => y.id === p.id); if (x) x.active = v; })} label={p.active ? "Visible in document builder" : "Hidden from document builder"} /></div>}
          </div>
        ))}
      </div>
      {d.products.length === 0 && <EmptyState icon={<Package size={24} />} title="No products" />}
      {modal && (
        <Modal open onClose={() => setModal(false)} title={edit ? "Edit product" : "Add product"}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" req><Input value={f.name || ""} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="SKU" req><Input value={f.sku || ""} onChange={(e) => setF((p) => ({ ...p, sku: e.target.value }))} /></Field>
            <Field label="Category"><Select value={f.category} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))}>{["Development", "Marketing", "Support", "Consulting", "General"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Unit"><Input value={f.unit || ""} onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))} placeholder="project / month / year" /></Field>
            <Field label="Price (₹)"><Input type="number" value={f.price ?? 0} onChange={(e) => setF((p) => ({ ...p, price: Number(e.target.value) }))} /></Field>
            <Field label="GST %"><Select value={f.gstPct ?? 18} onChange={(e) => setF((p) => ({ ...p, gstPct: Number(e.target.value) }))}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</Select></Field>
            <Field label="Description" className="col-span-2"><Textarea value={f.description || ""} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} /></Field>
          </div>
          <div className="mt-3"><Toggle on={f.active ?? true} onChange={(v) => setF((p) => ({ ...p, active: v }))} label="Active" /></div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn onClick={save}>{edit ? "Save" : "Add product"}</Btn></div>
        </Modal>
      )}
      {inr(0) === "" && <span />}
    </div>
  );
}
