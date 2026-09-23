import { useMemo, useState } from "react";
import { Eye, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { mutate, useDB } from "../lib/db";
import { inr } from "../lib/services";
import type { Product } from "../lib/types";
import { productApi } from "../lib/api";
import { Badge, Btn, EmptyState, Field, Input, Modal, Select, Textarea, Toggle } from "../components/ui";

const CATEGORIES = ["Web & Digital", "AI & Automation", "Business Software", "Advanced / Custom", "Add-ons", "General"];
const PACKAGES = ["Basic", "Medium", "Advanced", "Custom"];

const emptyProduct = (): Partial<Product> => ({
  unit: "project", gstPct: 18, active: true, category: "Web & Digital",
  itemType: "Service", packageName: "Basic", currency: "INR", taxMode: "Ex-tax",
  monthlyAmc: 0, isStartingPrice: false, requiresDiscovery: false,
});

const fromApi = (p: any): Product => ({
  id: String(p.id), name: p.name || "", sku: p.sku || "", category: p.category || "General",
  description: p.description || "", unit: p.unit || "project", price: Number(p.unit_price) || 0,
  gstPct: Number(p.gst_percent) || 0, active: !!p.active,
  serviceName: p.service_name || p.name || "", itemType: p.item_type || "Service",
  packageName: p.package_name || "", setupPriceLabel: p.setup_price_label || "",
  monthlyAmc: Number(p.monthly_amc) || 0, monthlyAmcLabel: p.monthly_amc_label || "",
  bestFitClients: p.best_fit_clients || "", typicalDelivery: p.typical_delivery || "",
  defaultScope: p.default_scope || "", exclusions: p.exclusions || "",
  currency: p.currency || "INR", taxMode: p.tax_mode || "Ex-tax",
  isStartingPrice: !!p.is_starting_price, requiresDiscovery: !!p.requires_discovery,
});

const setupText = (p: Product) => p.setupPriceLabel || inr(p.price);
const amcText = (p: Product) => p.monthlyAmcLabel || (p.monthlyAmc ? `${inr(p.monthlyAmc)} / month` : "—");

export default function Products() {
  const { can, toast } = useStore();
  const d = useDB();
  const [modal, setModal] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [view, setView] = useState<Product | null>(null);
  const [f, setF] = useState<Partial<Product>>(emptyProduct());
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("All");
  const [pkg, setPkg] = useState("All");
  const [itemType, setItemType] = useState("All");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return d.products.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (pkg !== "All" && p.packageName !== pkg) return false;
      if (itemType !== "All" && p.itemType !== itemType) return false;
      if (!needle) return true;
      return [p.name, p.serviceName, p.sku, p.category, p.packageName, p.defaultScope, p.bestFitClients]
        .some((v) => String(v || "").toLowerCase().includes(needle));
    });
  }, [d.products, q, category, pkg, itemType]);

  const serviceVariants = d.products.filter((p) => p.itemType === "Service").length;
  const addons = d.products.filter((p) => p.itemType === "Add-on").length;

  const save = async () => {
    if (!f.name?.trim() || !f.sku?.trim()) { toast("Name and SKU are required", "err"); return; }
    setBusy(true);
    try {
      const body = {
        name: f.name.trim(), sku: f.sku.trim(), category: f.category || "General",
        description: f.description || f.defaultScope || "", unit: f.unit || "project",
        unit_price: f.price || 0, gst_percent: f.gstPct ?? 18, active: f.active ?? true,
        service_name: f.serviceName || f.name.trim(), item_type: f.itemType || "Service",
        package_name: f.packageName || "", setup_price_label: f.setupPriceLabel || "",
        monthly_amc: f.monthlyAmc || 0, monthly_amc_label: f.monthlyAmcLabel || "",
        best_fit_clients: f.bestFitClients || "", typical_delivery: f.typicalDelivery || "",
        default_scope: f.defaultScope || "", exclusions: f.exclusions || "",
        currency: f.currency || "INR", tax_mode: f.taxMode || "Ex-tax",
        is_starting_price: f.isStartingPrice ?? false, requires_discovery: f.requiresDiscovery ?? false,
      };
      const r = edit ? await productApi.update(Number(edit.id), body) : await productApi.create(body);
      const row = fromApi(r.data);
      mutate((db) => {
        const index = db.products.findIndex((x) => x.id === row.id);
        if (index >= 0) db.products[index] = row; else db.products.unshift(row);
      });
      toast(edit ? "Product / service updated" : "Product / service added", "ok");
      setModal(false); setEdit(null); setF(emptyProduct());
    } catch (e) { toast(e instanceof Error ? e.message : "Could not save product / service", "err"); }
    finally { setBusy(false); }
  };

  const removeProduct = async (p: Product) => {
    if (!window.confirm(`Delete ${p.name}?`)) return;
    try {
      await productApi.remove(Number(p.id));
      mutate((db) => { db.products = db.products.filter((x) => x.id !== p.id); });
      if (view?.id === p.id) setView(null);
      toast("Product / service deleted", "warn");
    } catch (e) { toast(e instanceof Error ? e.message : "Could not delete product / service", "err"); }
  };

  const setActive = async (p: Product, active: boolean) => {
    try {
      await productApi.update(Number(p.id), { active });
      mutate((db) => { const x = db.products.find((y) => y.id === p.id); if (x) x.active = active; });
    } catch (e) { toast(e instanceof Error ? e.message : "Could not update product / service", "err"); }
  };

  const openNew = () => { setEdit(null); setF(emptyProduct()); setModal(true); };
  const openEdit = (p: Product) => { setEdit(p); setF({ ...p }); setModal(true); };

  return (
    <div className="mx-auto max-w-[1280px] p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="hd text-[22px]">Products & Services</h1>
          <p className="text-[12.5px] text-ink-500">
            ITCYBER catalogue · {serviceVariants} service packages · {addons} add-ons · {d.products.length} total records
          </p>
        </div>
        {can("products", "create") && <Btn size="sm" onClick={openNew}><Plus size={14} /> Add product / service</Btn>}
      </div>

      <div className="card mb-4 grid gap-2 p-3 md:grid-cols-[1fr_210px_160px_150px]">
        <div className="relative"><Search size={14} className="absolute left-2.5 top-2.5 text-ink-400" /><Input className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, SKU, scope, client type…" /></div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}><option>All</option>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</Select>
        <Select value={pkg} onChange={(e) => setPkg(e.target.value)}><option>All</option>{PACKAGES.map((x) => <option key={x}>{x}</option>)}</Select>
        <Select value={itemType} onChange={(e) => setItemType(e.target.value)}><option>All</option><option>Service</option><option>Add-on</option><option>Product</option></Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p) => (
          <div key={p.id} className={`card flex flex-col p-4 transition-all hover:-translate-y-0.5 hover:shadow-md ${p.active ? "" : "opacity-55"}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={p.itemType === "Add-on" ? "violet" : "teal"}>{p.itemType}</Badge>
                  {p.packageName && <Badge tone={p.packageName === "Custom" ? "amber" : "slate"}>{p.packageName}</Badge>}
                  {p.requiresDiscovery && <Badge tone="amber">Discovery required</Badge>}
                </div>
                <div className="hd mt-2 text-[14px] leading-snug">{p.serviceName || p.name}</div>
                <div className="num mt-0.5 text-[10.5px] text-ink-400">{p.sku} · {p.category}</div>
              </div>
              <Badge tone={p.active ? "green" : "slate"}>{p.active ? "Active" : "Inactive"}</Badge>
            </div>

            <p className="mt-2 line-clamp-3 min-h-[50px] text-[12px] leading-relaxed text-ink-500">{p.defaultScope || p.description || "—"}</p>

            <div className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-ink-50 p-2.5 dark:bg-ink-800/60">
              <div><div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">Setup</div><div className="num text-[13px] font-bold text-brand-700 dark:text-brand-300">{setupText(p)}</div></div>
              <div><div className="text-[9.5px] font-bold uppercase tracking-wider text-ink-400">Monthly AMC</div><div className="num text-[13px] font-semibold">{amcText(p)}</div></div>
            </div>
            <div className="mt-2 text-[11px] text-ink-400"><b>Delivery:</b> {p.typicalDelivery || "As agreed"} · {p.taxMode || "Ex-tax"}</div>

            <div className="mt-auto flex items-center justify-between border-t border-ink-100 pt-3 dark:border-ink-800">
              <Btn variant="ghost" size="xs" onClick={() => setView(p)}><Eye size={13} /> Details</Btn>
              {can("products", "edit") && (
                <div className="flex items-center gap-1">
                  <button className="rounded p-1 text-ink-400 hover:text-brand-600" onClick={() => openEdit(p)}><Pencil size={13} /></button>
                  {can("products", "delete") && <button className="rounded p-1 text-ink-400 hover:text-red-500" onClick={() => void removeProduct(p)}><Trash2 size={13} /></button>}
                </div>
              )}
            </div>
            {can("products", "edit") && <div className="mt-2"><Toggle on={p.active} onChange={(v) => void setActive(p, v)} label="Sellable / visible in quotations" /></div>}
          </div>
        ))}
      </div>

      {filtered.length === 0 && <EmptyState icon={<Package size={24} />} title="No matching products or services" body="Change the search or filters." />}

      {view && (
        <Modal open onClose={() => setView(null)} title={view.name} wide>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-3"><div className="lbl">CRM Code / SKU</div><div className="num mt-1 font-semibold">{view.sku}</div></div>
            <div className="card p-3"><div className="lbl">Category / Package</div><div className="mt-1 font-semibold">{view.category}{view.packageName ? ` · ${view.packageName}` : ""}</div></div>
            <div className="card p-3"><div className="lbl">Setup / Installation</div><div className="num mt-1 text-lg font-bold text-brand-700 dark:text-brand-300">{setupText(view)}</div></div>
            <div className="card p-3"><div className="lbl">Monthly Support / AMC</div><div className="num mt-1 text-lg font-bold">{amcText(view)}</div></div>
            <div className="sm:col-span-2"><div className="lbl">Default scope</div><p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">{view.defaultScope || view.description || "—"}</p></div>
            <div><div className="lbl">Best-fit clients</div><p className="mt-1 text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">{view.bestFitClients || "—"}</p></div>
            <div><div className="lbl">Typical delivery</div><p className="mt-1 text-[13px] font-semibold">{view.typicalDelivery || "—"}</p></div>
            <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[12px] leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200"><b>Commercial exclusions:</b> {view.exclusions || "—"}</div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            {can("products", "edit") && <Btn variant="outline" onClick={() => { setView(null); openEdit(view); }}><Pencil size={13} /> Edit</Btn>}
            <Btn onClick={() => setView(null)}>Close</Btn>
          </div>
        </Modal>
      )}

      {modal && (
        <Modal open onClose={() => setModal(false)} title={edit ? "Edit product / service" : "Add product / service"} wide>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Display name" req><Input value={f.name || ""} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="CRM Code / SKU" req><Input value={f.sku || ""} onChange={(e) => setF((p) => ({ ...p, sku: e.target.value }))} /></Field>
            <Field label="Service / product family"><Input value={f.serviceName || ""} onChange={(e) => setF((p) => ({ ...p, serviceName: e.target.value }))} /></Field>
            <Field label="Type"><Select value={f.itemType || "Service"} onChange={(e) => setF((p) => ({ ...p, itemType: e.target.value as Product["itemType"] }))}><option>Service</option><option>Add-on</option><option>Product</option></Select></Field>
            <Field label="Category"><Select value={f.category || "General"} onChange={(e) => setF((p) => ({ ...p, category: e.target.value }))}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Package"><Select value={f.packageName || ""} onChange={(e) => setF((p) => ({ ...p, packageName: e.target.value }))}><option value="">—</option>{PACKAGES.map((x) => <option key={x}>{x}</option>)}</Select></Field>
            <Field label="Setup price numeric (₹)"><Input type="number" min={0} value={f.price ?? 0} onChange={(e) => setF((p) => ({ ...p, price: Number(e.target.value) }))} /></Field>
            <Field label="Setup price display"><Input value={f.setupPriceLabel || ""} onChange={(e) => setF((p) => ({ ...p, setupPriceLabel: e.target.value }))} placeholder="₹24,999 / From ₹60,000" /></Field>
            <Field label="Monthly AMC numeric (₹)"><Input type="number" min={0} value={f.monthlyAmc ?? 0} onChange={(e) => setF((p) => ({ ...p, monthlyAmc: Number(e.target.value) }))} /></Field>
            <Field label="Monthly AMC display"><Input value={f.monthlyAmcLabel || ""} onChange={(e) => setF((p) => ({ ...p, monthlyAmcLabel: e.target.value }))} placeholder="₹2,999 / month" /></Field>
            <Field label="Unit"><Input value={f.unit || ""} onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))} placeholder="project / month / integration" /></Field>
            <Field label="GST %"><Select value={f.gstPct ?? 18} onChange={(e) => setF((p) => ({ ...p, gstPct: Number(e.target.value) }))}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}%</option>)}</Select></Field>
            <Field label="Typical delivery"><Input value={f.typicalDelivery || ""} onChange={(e) => setF((p) => ({ ...p, typicalDelivery: e.target.value }))} /></Field>
            <Field label="Best-fit clients"><Input value={f.bestFitClients || ""} onChange={(e) => setF((p) => ({ ...p, bestFitClients: e.target.value }))} /></Field>
            <Field label="Default scope" className="col-span-2"><Textarea rows={4} value={f.defaultScope || ""} onChange={(e) => setF((p) => ({ ...p, defaultScope: e.target.value, description: e.target.value }))} /></Field>
            <Field label="Commercial exclusions" className="col-span-2"><Textarea rows={3} value={f.exclusions || ""} onChange={(e) => setF((p) => ({ ...p, exclusions: e.target.value }))} /></Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            <Toggle on={f.active ?? true} onChange={(v) => setF((p) => ({ ...p, active: v }))} label="Active / sellable" />
            <Toggle on={f.isStartingPrice ?? false} onChange={(v) => setF((p) => ({ ...p, isStartingPrice: v }))} label="Starting / from price" />
            <Toggle on={f.requiresDiscovery ?? false} onChange={(v) => setF((p) => ({ ...p, requiresDiscovery: v }))} label="Discovery required before fixed quote" />
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="ghost" onClick={() => setModal(false)}>Cancel</Btn><Btn loading={busy} onClick={() => void save()}>{edit ? "Save changes" : "Add product / service"}</Btn></div>
        </Modal>
      )}
    </div>
  );
}
