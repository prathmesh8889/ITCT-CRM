/**
 * Billing — products, quotations, invoices, payments, expenses, file uploads.
 * All money math is recomputed on the backend; frontend figures are preview-only.
 */
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { db } = require("../db");
const { config, HttpError, money, computeTotals, nextCode } = require("../core");
const { requirePerm, ensureQuotation, ensureInvoice } = require("../security");
const { runTriggers } = require("../engines");

const router = express.Router();
const ALLOWED_EXT = [".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg"];
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { fs.mkdirSync(config.uploadDir, { recursive: true }); cb(null, config.uploadDir); },
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    cb(null, ALLOWED_EXT.includes(ext));
  },
});

const activity = (userId, action, module, recordId = null, meta = null) =>
  db.query("INSERT INTO activities (actor_id, action, module, record_id, meta) VALUES ($1,$2,$3,$4,$5)",
    [userId, action, module, recordId, meta]);
const audit = (user, action, target, detail = "") =>
  db.query("INSERT INTO audit_logs (user_id, user_name, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
    [user.id, user.name, action, target, detail]);

const cleanItems = (items) => (items || []).map((i) => ({
  product_id: i.product_id ?? null, description: String(i.description || ""),
  quantity: Math.max(0, Number(i.quantity) || 0), rate: Math.max(0, Number(i.rate) || 0),
  discount_percent: Math.min(100, Math.max(0, Number(i.discount_percent) || 0)),
  gst_percent: Math.min(28, Math.max(0, Number(i.gst_percent) || 0)),
}));

async function recalcInvoice(invId) {
  const paid = (await db.one("SELECT COALESCE(SUM(amount),0)::float AS p FROM payments WHERE invoice_id = $1", [invId])).p;
  const inv = await db.one("SELECT * FROM invoices WHERE id = $1", [invId]);
  const balance = money(Number(inv.grand_total) - paid);
  let status = inv.status;
  if (status !== "Cancelled") {
    if (balance <= 0) status = "Paid";
    else if (paid > 0) status = "Partially Paid";
    else if (inv.due_date && new Date(inv.due_date) < new Date(new Date().toDateString())) status = "Overdue";
    else if (status !== "Draft") status = "Sent";
  }
  await db.query("UPDATE invoices SET paid_amount = $1, balance_due = $2, status = $3 WHERE id = $4",
    [money(paid), balance, status, invId]);
  return db.one("SELECT * FROM invoices WHERE id = $1", [invId]);
}

const quoteOut = (q) => ({ ...q, subtotal: num(q.subtotal), discount_total: num(q.discount_total),
  tax_total: num(q.tax_total), grand_total: num(q.grand_total), date: dstr(q.date), valid_until: dstr(q.valid_until) });
const invOut = (i) => ({ ...i, subtotal: num(i.subtotal), discount_total: num(i.discount_total),
  tax_total: num(i.tax_total), grand_total: num(i.grand_total), paid_amount: num(i.paid_amount),
  balance_due: num(i.balance_due), invoice_date: dstr(i.invoice_date), due_date: dstr(i.due_date) });
const num = (v) => (v === null || v === undefined ? v : Number(v));
const dstr = (v) => (v ? String(v).slice(0, 10) : null);

// ================= PRODUCTS =================
router.get("/products", requirePerm("products", "view"), async (_req, res, next) => {
  try {
    const rows = await db.all("SELECT * FROM products ORDER BY name");
    res.json(rows.map((p) => ({ ...p, unit_price: num(p.unit_price), gst_percent: num(p.gst_percent) })));
  } catch (e) { next(e); }
});

router.post("/products", requirePerm("products", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name?.trim() || !b.sku?.trim()) throw new HttpError(422, "name and sku are required");
    if (Number(b.unit_price) < 0) throw new HttpError(422, "unit_price cannot be negative");
    const r = await db.query(
      `INSERT INTO products (name, sku, category, description, unit, unit_price, gst_percent, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.name, b.sku, b.category || "General", b.description || "", b.unit || "unit",
       money(b.unit_price || 0), b.gst_percent ?? 18, b.active ?? true]);
    res.status(201).json(r.rows[0]);
  } catch (e) { next(e); }
});

router.patch("/products/:id", requirePerm("products", "edit"), async (req, res, next) => {
  try {
    const p = await db.one("SELECT * FROM products WHERE id = $1", [Number(req.params.id)]);
    if (!p) throw new HttpError(404, "Product not found");
    const allowed = ["name", "sku", "category", "description", "unit", "unit_price", "gst_percent", "active"];
    const patch = Object.entries(req.body || {}).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    if (patch.length) {
      const sets = patch.map(([k], i) => `${k} = $${i + 1}`).join(", ");
      await db.query(`UPDATE products SET ${sets} WHERE id = $${patch.length + 1}`, [...patch.map(([, v]) => v), p.id]);
    }
    res.json(await db.one("SELECT * FROM products WHERE id = $1", [p.id]));
  } catch (e) { next(e); }
});

// ================= QUOTATIONS =================
router.get("/quotations", requirePerm("quotations", "view"), async (req, res, next) => {
  try {
    const wide = ["Super Admin", "Admin", "Sales Manager"].includes(req.role.name);
    const rows = wide
      ? await db.all("SELECT * FROM quotations ORDER BY created_at DESC")
      : await db.all("SELECT * FROM quotations WHERE created_by = $1 ORDER BY created_at DESC", [req.user.id]);
    const items = rows.map(quoteOut);
    res.json({ items, total: items.length, page: 1, page_size: items.length });
  } catch (e) { next(e); }
});

router.get("/quotations/:id", requirePerm("quotations", "view"), async (req, res, next) => {
  try { res.json(quoteOut(await ensureQuotation(req, Number(req.params.id)))); } catch (e) { next(e); }
});

router.post("/quotations", requirePerm("quotations", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.customer_id) throw new HttpError(422, "customer_id is required");
    const items = cleanItems(b.items);
    if (!items.length) throw new HttpError(422, "At least one line item is required");
    const totals = computeTotals(items);
    const code = await nextCode(db, "quotations", "quotation_number", "QT");
    const r = await db.query(
      `INSERT INTO quotations (quotation_number, customer_id, company_id, date, valid_until, items,
        subtotal, discount_total, tax_total, grand_total, terms, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [code, b.customer_id, b.company_id ?? null, b.date, b.valid_until, JSON.stringify(items),
       totals.subtotal, totals.discount_total, totals.tax_total, totals.grand_total,
       b.terms || "", b.notes || "", b.status || "Draft", req.user.id]);
    await activity(req.user.id, "Quotation Created", "quotations", r.rows[0].id, { number: code, total: totals.grand_total });
    if ((b.status || "Draft") === "Sent")
      await runTriggers("quote.sent", { extra: { title: `Quotation ${code} sent`, link: "/quotations", kind: "quote" } });
    res.status(201).json(quoteOut(r.rows[0]));
  } catch (e) { next(e); }
});

router.patch("/quotations/:id", requirePerm("quotations", "edit"), async (req, res, next) => {
  try {
    const q = await ensureQuotation(req, Number(req.params.id));
    const b = req.body || {};
    if (b.customer_id) await db.query("UPDATE quotations SET customer_id = $1 WHERE id = $2", [b.customer_id, q.id]);
    if (b.date) await db.query("UPDATE quotations SET date = $1 WHERE id = $2", [b.date, q.id]);
    if (b.valid_until) await db.query("UPDATE quotations SET valid_until = $1 WHERE id = $2", [b.valid_until, q.id]);
    if (b.terms !== undefined) await db.query("UPDATE quotations SET terms = $1 WHERE id = $2", [b.terms, q.id]);
    if (b.notes !== undefined) await db.query("UPDATE quotations SET notes = $1 WHERE id = $2", [b.notes, q.id]);
    if (b.status) await db.query("UPDATE quotations SET status = $1 WHERE id = $2", [b.status, q.id]);
    if (b.items) {
      const items = cleanItems(b.items);
      const totals = computeTotals(items);
      await db.query(`UPDATE quotations SET items = $1, subtotal = $2, discount_total = $3, tax_total = $4, grand_total = $5 WHERE id = $6`,
        [JSON.stringify(items), totals.subtotal, totals.discount_total, totals.tax_total, totals.grand_total, q.id]);
    }
    await audit(req.user, "Quotation Modified", q.quotation_number);
    if (b.status === "Sent")
      await runTriggers("quote.sent", { extra: { title: `Quotation ${q.quotation_number} sent`, link: "/quotations", kind: "quote" } });
    res.json(quoteOut(await db.one("SELECT * FROM quotations WHERE id = $1", [q.id])));
  } catch (e) { next(e); }
});

router.post("/quotations/:id/convert-to-invoice", requirePerm("invoices", "create"), async (req, res, next) => {
  try {
    const q = await ensureQuotation(req, Number(req.params.id));
    const items = cleanItems(q.items);
    const totals = computeTotals(items);
    const code = await nextCode(db, "invoices", "invoice_number", "INV");
    const today = new Date();
    const due = new Date(Date.now() + 15 * 86400_000).toISOString().slice(0, 10);
    const r = await db.query(
      `INSERT INTO invoices (invoice_number, customer_id, invoice_date, due_date, items, subtotal, discount_total,
        tax_total, grand_total, paid_amount, balance_due, notes, status, quotation_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,'Draft',$12,$13) RETURNING *`,
      [code, q.customer_id, today.toISOString().slice(0, 10), due, JSON.stringify(items),
       totals.subtotal, totals.discount_total, totals.tax_total, totals.grand_total, totals.grand_total,
       `From quotation ${q.quotation_number}`, q.id, req.user.id]);
    await db.query("UPDATE quotations SET status = 'Accepted' WHERE id = $1", [q.id]);
    await activity(req.user.id, "Invoice Created", "invoices", r.rows[0].id, { number: code, from: q.quotation_number });
    res.json(invOut(r.rows[0]));
  } catch (e) { next(e); }
});

// ================= INVOICES & PAYMENTS =================
router.get("/invoices", requirePerm("invoices", "view"), async (req, res, next) => {
  try {
    const wide = ["Super Admin", "Admin", "Sales Manager", "Accountant"].includes(req.role.name);
    const rows = wide
      ? await db.all("SELECT * FROM invoices ORDER BY created_at DESC")
      : await db.all("SELECT * FROM invoices WHERE created_by = $1 ORDER BY created_at DESC", [req.user.id]);
    const items = rows.map(invOut);
    res.json({ items, total: items.length, page: 1, page_size: items.length });
  } catch (e) { next(e); }
});

router.get("/invoices/:id", requirePerm("invoices", "view"), async (req, res, next) => {
  try { res.json(invOut(await ensureInvoice(req, Number(req.params.id)))); } catch (e) { next(e); }
});

router.post("/invoices", requirePerm("invoices", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.customer_id) throw new HttpError(422, "customer_id is required");
    const items = cleanItems(b.items);
    if (!items.length) throw new HttpError(422, "At least one line item is required");
    if (b.due_date && b.invoice_date && b.due_date < b.invoice_date) throw new HttpError(422, "due_date cannot be before invoice_date");
    const totals = computeTotals(items);
    const code = await nextCode(db, "invoices", "invoice_number", "INV");
    const r = await db.query(
      `INSERT INTO invoices (invoice_number, customer_id, invoice_date, due_date, items, subtotal, discount_total,
        tax_total, grand_total, paid_amount, balance_due, notes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13) RETURNING *`,
      [code, b.customer_id, b.invoice_date, b.due_date, JSON.stringify(items), totals.subtotal,
       totals.discount_total, totals.tax_total, totals.grand_total, totals.grand_total,
       b.notes || "", b.status || "Draft", req.user.id]);
    await activity(req.user.id, "Invoice Created", "invoices", r.rows[0].id, { number: code, total: totals.grand_total });
    res.status(201).json(invOut(r.rows[0]));
  } catch (e) { next(e); }
});

router.patch("/invoices/:id", requirePerm("invoices", "edit"), async (req, res, next) => {
  try {
    const inv = await ensureInvoice(req, Number(req.params.id));
    const b = req.body || {};
    if (b.customer_id) await db.query("UPDATE invoices SET customer_id = $1 WHERE id = $2", [b.customer_id, inv.id]);
    if (b.invoice_date) await db.query("UPDATE invoices SET invoice_date = $1 WHERE id = $2", [b.invoice_date, inv.id]);
    if (b.due_date) await db.query("UPDATE invoices SET due_date = $1 WHERE id = $2", [b.due_date, inv.id]);
    if (b.notes !== undefined) await db.query("UPDATE invoices SET notes = $1 WHERE id = $2", [b.notes, inv.id]);
    if (b.status && ["Draft", "Sent", "Cancelled"].includes(b.status))
      await db.query("UPDATE invoices SET status = $1 WHERE id = $2", [b.status, inv.id]);
    if (b.items) {
      const items = cleanItems(b.items);
      const totals = computeTotals(items);
      await db.query(`UPDATE invoices SET items = $1, subtotal = $2, discount_total = $3, tax_total = $4, grand_total = $5 WHERE id = $6`,
        [JSON.stringify(items), totals.subtotal, totals.discount_total, totals.tax_total, totals.grand_total, inv.id]);
    }
    const fresh = await recalcInvoice(inv.id); // paid / balance / status recomputed server-side
    await audit(req.user, "Invoice Changed", inv.invoice_number, `Total ${fresh.grand_total}`);
    res.json(invOut(fresh));
  } catch (e) { next(e); }
});

router.post("/invoices/:id/payments", requirePerm("payments", "create"), async (req, res, next) => {
  try {
    const inv = await ensureInvoice(req, Number(req.params.id));
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!amount || amount <= 0) throw new HttpError(422, "Payment amount must be positive");
    if (inv.status === "Cancelled") throw new HttpError(422, "Cannot record payment on a cancelled invoice");
    if (amount > Number(inv.balance_due) + 0.01)
      throw new HttpError(422, `Amount exceeds balance due (${inv.balance_due})`);
    const code = await nextCode(db, "payments", "payment_number", "PAY");
    const r = await db.query(
      `INSERT INTO payments (payment_number, invoice_id, customer_id, amount, payment_date, payment_method,
        transaction_reference, notes, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [code, inv.id, inv.customer_id, money(amount), b.payment_date || new Date().toISOString().slice(0, 10),
       b.payment_method || "UPI", b.transaction_reference || "", b.notes || "", req.user.id]);
    const fresh = await recalcInvoice(inv.id);
    await activity(req.user.id, "Payment Recorded", "payments", r.rows[0].id, { invoice: inv.invoice_number, amount });
    await audit(req.user, "Payment Recorded", inv.invoice_number, `${money(amount)} via ${b.payment_method || "UPI"}`);
    await db.query("INSERT INTO notifications (user_id, title, body, link, kind) VALUES (NULL,$1,$2,'/invoices','invoice')",
      [`Payment received — ${inv.invoice_number}`, `₹${money(amount).toLocaleString("en-IN")} · new balance ₹${Number(fresh.balance_due).toLocaleString("en-IN")}`]);
    res.status(201).json({ payment: { ...r.rows[0], amount: num(r.rows[0].amount) }, invoice: invOut(fresh) });
  } catch (e) { next(e); }
});

router.get("/payments", requirePerm("payments", "view"), async (_req, res, next) => {
  try {
    const rows = await db.all("SELECT * FROM payments ORDER BY payment_date DESC");
    const items = rows.map((p) => ({ ...p, amount: num(p.amount), payment_date: dstr(p.payment_date) }));
    res.json({ items, total: items.length, page: 1, page_size: items.length });
  } catch (e) { next(e); }
});

// ================= EXPENSES =================
router.get("/expenses", requirePerm("expenses", "view"), async (_req, res, next) => {
  try {
    const rows = await db.all("SELECT * FROM expenses ORDER BY date DESC");
    const items = rows.map((e) => ({ ...e, amount: num(e.amount), date: dstr(e.date) }));
    res.json({ items, total: items.length, page: 1, page_size: items.length });
  } catch (e) { next(e); }
});

router.post("/expenses", requirePerm("expenses", "create"), async (req, res, next) => {
  try {
    const b = req.body || {};
    const amount = Number(b.amount);
    if (!amount || amount <= 0) throw new HttpError(422, "Expense amount must be positive");
    const r = await db.query(
      `INSERT INTO expenses (category, description, amount, date, employee_id, payment_method, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [b.category || "General", b.description || "", money(amount), b.date || new Date().toISOString().slice(0, 10),
       req.user.id, b.payment_method || "UPI", b.notes || ""]);
    res.status(201).json({ id: r.rows[0].id });
  } catch (e) { next(e); }
});

// ================= ATTACHMENTS =================
router.post("/attachments", requirePerm("leads", "view"), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(422, `Unsupported file type. Allowed: ${ALLOWED_EXT.join(", ")}`);
    const r = await db.query(
      `INSERT INTO attachments (entity_type, entity_id, filename, stored_name, size, content_type, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.body.entity_type || "lead", Number(req.body.entity_id) || 0, req.file.originalname,
       req.file.filename, req.file.size, req.file.mimetype || "", req.user.id]);
    res.status(201).json({ id: r.rows[0].id, filename: req.file.originalname, size: req.file.size });
  } catch (e) { next(e); }
});

router.get("/attachments", requirePerm("leads", "view"), async (req, res, next) => {
  try {
    const rows = await db.all("SELECT * FROM attachments WHERE entity_type = $1 AND entity_id = $2",
      [String(req.query.entity_type || ""), Number(req.query.entity_id) || 0]);
    res.json(rows.map((a) => ({ id: a.id, filename: a.filename, size: a.size, content_type: a.content_type, created_at: a.created_at })));
  } catch (e) { next(e); }
});

module.exports = router;
