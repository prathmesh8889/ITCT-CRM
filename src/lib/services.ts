import { getDB, mutate, uid } from "./db";
import type {
  DB, Lead, User, Priority, Temperature, Intent, RecAction, ValidStatus,
  DiscoveryJob, FollowUp, FUType, DocItem, Quotation, Invoice, TriggerKey, RuleAction,
} from "./types";

// ================= formatting =================
export function inr(n: number): string {
  const neg = n < 0;
  const v = Math.abs(n);
  const opts: Intl.NumberFormatOptions = Number.isInteger(Math.round(v * 100) / 100)
    ? { maximumFractionDigits: 0 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return (neg ? "−₹" : "₹") + new Intl.NumberFormat("en-IN", opts).format(v);
}
export const fmtD = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
export const fmtDT = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const addDaysISO = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const addHoursDate = (h: number) => { const d = new Date(Date.now() + h * 3600e3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const addHoursTime = (h: number) => { const d = new Date(Date.now() + h * 3600e3); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ================= normalization / validation =================
export const normPhone = (p: string) => p.replace(/\D/g, "").slice(-10);
export const normEmail = (e: string) => e.trim().toLowerCase();
export const normDomain = (w: string) => w.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
export const normCompany = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const isUrl = (w: string) => /^([\w-]+\.)+[a-z]{2,}([/?#].*)?$/i.test(w.replace(/^https?:\/\//, "").replace(/^www\./, ""));

export interface ValidationResult { status: ValidStatus; issues: string[]; }
export function validateLead(l: Partial<Lead>): ValidationResult {
  const issues: string[] = [];
  if (!l.businessName || l.businessName.trim().length < 2) issues.push("Business name is required");
  if (l.email && !isEmail(l.email)) issues.push("Invalid email format");
  if (l.phone && normPhone(l.phone).length < 10) issues.push("Invalid phone format");
  if (l.website && !isUrl(l.website)) issues.push("Invalid website URL");
  if (/[<>{}]/.test(l.businessName || "")) issues.push("Unsupported characters in name");
  const hasPhone = !!l.phone && normPhone(l.phone).length >= 10;
  const hasEmail = !!l.email && isEmail(l.email);
  let status: ValidStatus = "Valid";
  if (issues.length > 0) status = l.businessName && (hasPhone || hasEmail) ? "Partially Valid" : "Invalid";
  else if (!hasPhone && !hasEmail) status = "Needs Review";
  else if (!hasPhone || !hasEmail) status = "Partially Valid";
  return { status, issues };
}

export function findDuplicates(d: DB, cand: Partial<Lead>, excludeId?: string): Lead[] {
  const p = normPhone(cand.phone || ""); const e = normEmail(cand.email || "");
  const w = normDomain(cand.website || ""); const c = normCompany(cand.company || cand.businessName || "");
  return d.leads.filter((l) => {
    if (l.id === excludeId) return false;
    if (p && p.length >= 10 && normPhone(l.phone) === p) return true;
    if (e && normEmail(l.email) === e) return true;
    if (w && l.website && normDomain(l.website) === w) return true;
    if (c && normCompany(l.company || l.businessName) === c && (!cand.city || l.city.toLowerCase() === cand.city.toLowerCase())) return true;
    return false;
  });
}

// ================= internal loggers (operate on draft DB) =================
function _act(d: DB, entityType: string, entityId: string, userId: string, action: string, detail = "") {
  d.activities.unshift({ id: uid(), entityType, entityId, userId, action, detail, at: new Date().toISOString() });
  if (d.activities.length > 600) d.activities.length = 600;
}
export function logAct(entityType: string, entityId: string, userId: string, action: string, detail = "") {
  mutate((d) => _act(d, entityType, entityId, userId, action, detail));
}
export function logAudit(userId: string, action: string, target: string, detail: string) {
  mutate((d) => {
    const u = d.users.find((x) => x.id === userId);
    d.auditLogs.unshift({ id: uid(), userId, userName: u?.name || "System", action, target, detail, at: new Date().toISOString() });
    if (d.auditLogs.length > 400) d.auditLogs.length = 400;
  });
}
function _notice(d: DB, userId: string | "managers", title: string, body: string, link: string, kind: DB["notices"][number]["kind"]) {
  d.notices.unshift({ id: uid(), userId, title, body, read: false, at: new Date().toISOString(), link, kind });
  if (d.notices.length > 200) d.notices.length = 200;
}
export function notify(userId: string | "managers", title: string, body: string, link: string, kind: DB["notices"][number]["kind"]) {
  mutate((d) => _notice(d, userId, title, body, link, kind));
}

// ================= deterministic lead qualification =================
export interface Qualification {
  score: number; temperature: Temperature; intent: Intent; action: RecAction; reason: string;
}
export function ruleQualify(d: DB, lead: Partial<Lead>): Qualification {
  const s = d.settings.scoring;
  let score = 0; const bits: string[] = [];
  const hasPhone = !!lead.phone && normPhone(lead.phone).length >= 10;
  const hasEmail = !!lead.email && isEmail(lead.email);
  const hasWeb = !!lead.website && isUrl(lead.website);
  if (hasPhone) { score += s.phone; bits.push(`phone +${s.phone}`); }
  if (hasEmail) { score += s.email; bits.push(`email +${s.email}`); }
  if (hasWeb) { score += s.website; bits.push(`active website +${s.website}`); }
  if (lead.city && s.targetLocations.some((t) => lead.city!.toLowerCase().includes(t.toLowerCase()))) { score += s.location; bits.push(`target location +${s.location}`); }
  if (lead.industry && s.targetIndustries.some((t) => lead.industry!.toLowerCase().includes(t.toLowerCase()))) { score += s.industry; bits.push(`target industry +${s.industry}`); }
  if (lead.rating != null && lead.rating >= 4.2) { score += s.rating; bits.push(`public rating ${lead.rating}★ +${s.rating}`); }
  if (lead.id) {
    const weekAgo = Date.now() - 7 * 86400e3;
    const engaged = d.calls.some((c) => c.entityId === lead.id && new Date(c.createdAt).getTime() > weekAgo) ||
      d.followups.some((f) => f.entityId === lead.id && f.status === "Completed" && new Date(f.createdAt).getTime() > weekAgo);
    if (engaged) { score += s.engagement; bits.push(`recent engagement +${s.engagement}`); }
  }
  score = Math.min(100, Math.max(5, score + Math.floor((lead.estimatedValue || 0) / 40000) * 2));
  const temperature: Temperature = score >= 75 ? "Hot" : score >= 45 ? "Warm" : "Cold";
  const intent: Intent = score >= 75 ? "High" : score >= 45 ? "Medium" : "Low";
  const action: RecAction = score >= 80 ? "Call" : score >= 65 ? "Demo" : score >= 45 ? "WhatsApp" : score >= 25 ? "Email" : "No Action";
  const reason = bits.length
    ? `${lead.businessName || "Lead"} matches on: ${bits.join(", ")}. ${temperature === "Hot" ? "Multiple public contact channels and strong profile fit." : temperature === "Warm" ? "Decent profile — nurture with a light touch." : "Thin public profile — verify details before outreach."}`
    : "Minimal public information available. Verify contact details manually.";
  return { score, temperature, intent, action, reason };
}

// ================= assignment engine =================
const openLeadCount = (d: DB, u: string) => d.leads.filter((l) => l.assigneeId === u && !["Converted", "Lost"].includes(l.status)).length;
const workload = (d: DB, u: string) =>
  d.followups.filter((f) => f.employeeId === u && f.status === "Scheduled").length +
  d.tasks.filter((t) => t.assigneeId === u && t.status !== "Completed" && t.status !== "Cancelled").length;

export function pickAssignee(d: DB, lead: Partial<Lead>, strategy = d.settings.assignment.strategy): { userId: string | null; method: string } {
  const a = d.settings.assignment;
  const salesUsers = d.users.filter((u) => u.isSales && u.active);
  if (salesUsers.length === 0) return { userId: null, method: "no sales staff" };
  switch (strategy) {
    case "manual": return { userId: null, method: "manual" };
    case "round_robin": {
      const idx = a.rrPointer % salesUsers.length;
      const u = salesUsers[idx];
      a.rrPointer = idx + 1; // persisted in DB
      return { userId: u.id, method: `round robin → ${u.name}` };
    }
    case "least_leads": {
      const u = [...salesUsers].sort((x, y) => openLeadCount(d, x.id) - openLeadCount(d, y.id))[0];
      return { userId: u.id, method: `least leads → ${u.name}` };
    }
    case "least_workload": {
      const u = [...salesUsers].sort((x, y) => workload(d, x.id) - workload(d, y.id))[0];
      return { userId: u.id, method: `least workload → ${u.name}` };
    }
    case "location": {
      const id = lead.city ? a.locationMap[lead.city] : undefined;
      const u = id ? d.users.find((x) => x.id === id && x.active) : undefined;
      return u ? { userId: u.id, method: `location rule → ${u.name}` } : { userId: salesUsers[a.rrPointer % salesUsers.length].id, method: "location fallback (round robin)" };
    }
    case "category": {
      const id = lead.category ? a.categoryMap[lead.category] : undefined;
      const u = id ? d.users.find((x) => x.id === id && x.active) : undefined;
      return u ? { userId: u.id, method: `category rule → ${u.name}` } : { userId: salesUsers[a.rrPointer % salesUsers.length].id, method: "category fallback (round robin)" };
    }
    case "priority": {
      const hot = lead.priority === "High" || lead.priority === "Urgent" || (lead.estimatedValue || 0) >= a.highValueThreshold;
      const u = hot && a.highValueUserId ? d.users.find((x) => x.id === a.highValueUserId && x.active) : undefined;
      return u ? { userId: u.id, method: `priority rule → ${u.name}` } : { userId: [...salesUsers].sort((x, y) => openLeadCount(d, x.id) - openLeadCount(d, y.id))[0].id, method: "priority fallback (least leads)" };
    }
    case "team": {
      const team = d.teams.find((t) =>
        t.focus.toLowerCase().includes((lead.industry || "").toLowerCase()) ||
        t.focus.toLowerCase().includes((lead.city || "").toLowerCase())) || d.teams[0];
      const members = d.users.filter((u) => team?.memberIds.includes(u.id) && u.active);
      const pool = members.length ? members : salesUsers;
      const u = [...pool].sort((x, y) => openLeadCount(d, x.id) - openLeadCount(d, y.id))[0];
      return { userId: u.id, method: `team ${team?.name || ""} → ${u.name}` };
    }
    default: return { userId: null, method: "manual" };
  }
}

// ================= automation engine =================
function condOk(rule: { condField: string; condOp: string; condValue: string }, ctx: Record<string, unknown>): boolean {
  if (!rule.condField) return true;
  const raw = ctx[rule.condField];
  const v = typeof raw === "number" ? raw : String(raw ?? "");
  switch (rule.condOp) {
    case "eq": return String(v).toLowerCase() === rule.condValue.toLowerCase();
    case "neq": return String(v).toLowerCase() !== rule.condValue.toLowerCase();
    case "gte": return Number(v) >= Number(rule.condValue);
    case "lte": return Number(v) <= Number(rule.condValue);
    case "contains": return String(v).toLowerCase().includes(rule.condValue.toLowerCase());
    default: return true;
  }
}
function runAction(d: DB, act: RuleAction, lead: Lead | null, ruleName: string): string {
  switch (act.type) {
    case "assign_team": {
      const team = d.teams.find((t) => t.id === act.value);
      if (!team || !lead) return "team not found";
      const members = d.users.filter((u) => team.memberIds.includes(u.id) && u.active);
      if (!members.length) return "team has no active members";
      const u = [...members].sort((x, y) => openLeadCount(d, x.id) - openLeadCount(d, y.id))[0];
      lead.assigneeId = u.id;
      _act(d, "lead", lead.id, u.id, "Lead assigned", `Automation “${ruleName}” → ${u.name} (${team.name})`);
      _notice(d, u.id, "Lead auto-assigned", `${lead.businessName} routed to you by ${team.name}.`, "/leads", "lead");
      return `assigned to ${u.name} (${team.name})`;
    }
    case "assign_user": {
      const u = d.users.find((x) => x.id === act.value);
      if (!u || !lead) return "user not found";
      lead.assigneeId = u.id;
      _act(d, "lead", lead.id, u.id, "Lead assigned", `Automation “${ruleName}” → ${u.name}`);
      return `assigned to ${u.name}`;
    }
    case "assign_strategy": return `strategy noted: ${act.value}`;
    case "followup": {
      if (!lead) return "no lead in context";
      const hrs = act.hours || Number(act.value) || 24;
      const emp = lead.assigneeId || d.users.find((u) => u.isSales)?.id || d.users[0].id;
      d.followups.unshift({
        id: uid(), entityType: "lead", entityId: lead.id, employeeId: emp, type: act.fuType || "Call",
        date: addHoursDate(hrs), time: addHoursTime(hrs), reminder: true, status: "Scheduled",
        notes: `Auto-created by rule “${ruleName}”`, outcome: "", createdAt: new Date().toISOString(),
      });
      lead.nextFollowUp = addHoursDate(hrs);
      _act(d, "lead", lead.id, emp, "Follow-up created", `${act.fuType || "Call"} in ${hrs}h (automation)`);
      return `${act.fuType || "Call"} follow-up in ${hrs}h`;
    }
    case "notify": {
      _notice(d, act.value === "managers" ? "managers" : act.value, `Automation: ${ruleName}`,
        lead ? `${lead.businessName} — rule fired.` : "Rule fired.", "/leads", "system");
      return `notified ${act.value === "managers" ? "managers" : d.users.find((u) => u.id === act.value)?.name || act.value}`;
    }
    case "set_priority": { if (lead) { lead.priority = act.value as Priority; return `priority → ${act.value}`; } return "no lead"; }
    case "set_status": { if (lead) { lead.status = act.value; return `status → ${act.value}`; } return "no lead"; }
    default: return "unknown action";
  }
}
export function runTriggers(trigger: TriggerKey, ctx: Record<string, unknown>, leadId?: string) {
  mutate((d) => {
    const lead = leadId ? d.leads.find((l) => l.id === leadId) || null : null;
    for (const rule of d.rules.filter((r) => r.enabled && r.trigger === trigger)) {
      if (!condOk(rule, ctx)) continue;
      const parts = rule.actions.map((a) => runAction(d, a, lead, rule.name));
      d.ruleRuns.unshift({ id: uid(), ruleId: rule.id, ruleName: rule.name, summary: `${trigger}: ${parts.join(" · ")}`, at: new Date().toISOString() });
      if (d.ruleRuns.length > 200) d.ruleRuns.length = 200;
    }
  });
}

// ================= lead lifecycle =================
export interface CreateLeadResult { lead?: Lead; duplicateOf?: Lead; validation: ValidationResult; }
export function createLead(input: Partial<Lead>, byUserId: string, opts?: { force?: boolean; source?: string; jobId?: string; silent?: boolean }): CreateLeadResult {
  const validation = validateLead(input);
  let out: CreateLeadResult = { validation };
  mutate((d) => {
    const dups = findDuplicates(d, input);
    if (dups.length && !opts?.force) { out = { validation, duplicateOf: dups[0] }; return; }
    const q = ruleQualify(d, input);
    const lead: Lead = {
      id: uid(), businessName: input.businessName || "Unnamed business", contactPerson: input.contactPerson || [input.firstName, input.lastName].filter(Boolean).join(" ") || "—",
      firstName: input.firstName || "", lastName: input.lastName || "",
      phone: input.phone || "", altPhone: input.altPhone || "", whatsapp: input.whatsapp || input.phone || "",
      email: input.email || "", website: input.website || "",
      category: input.category || "General", industry: input.industry || "", company: input.company || input.businessName || "",
      address: input.address || "", city: input.city || "", state: input.state || "", country: input.country || "India", postal: input.postal || "",
      source: opts?.source || input.source || "Manual Entry", sourceUrl: input.sourceUrl || "", mapsUrl: input.mapsUrl || "", socialUrls: input.socialUrls || "",
      rating: input.rating ?? null, reviewCount: input.reviewCount ?? null,
      status: d.leadStatuses[0], priority: input.priority || "Medium",
      score: q.score, temperature: q.temperature, intent: q.intent, recommendedAction: q.action, aiReason: q.reason, scoredBy: "rules",
      estimatedValue: input.estimatedValue || 25000, assigneeId: input.assigneeId || null, tags: input.tags || [], notes: input.notes || "",
      nextFollowUp: null, validation: validation.status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), jobId: opts?.jobId,
    };
    if (!lead.assigneeId) {
      const asg = pickAssignee(d, lead);
      lead.assigneeId = asg.userId;
      if (asg.userId) _act(d, "lead", lead.id, byUserId, "Lead assigned", asg.method);
    }
    d.leads.unshift(lead);
    _act(d, "lead", lead.id, byUserId, opts?.jobId ? "Lead imported from discovery" : "Lead created", `Source: ${lead.source}`);
    if (lead.assigneeId && !opts?.silent) _notice(d, lead.assigneeId, "New lead assigned", `${lead.businessName} (${lead.city || lead.category}) scored ${lead.score}.`, "/leads", "lead");
    if ((lead.score || 0) >= 80) _notice(d, "managers", "Hot lead found", `${lead.businessName} scored ${lead.score} — act fast.`, "/leads", "ai");
    out = { lead, validation };
    void d;
  });
  if (out.lead) {
    runTriggers("lead.created", { category: out.lead.category, city: out.lead.city, score: out.lead.score, industry: out.lead.industry }, out.lead.id);
    if (out.lead.assigneeId) runTriggers("lead.assigned", { score: out.lead.score }, out.lead.id);
    runTriggers("lead.scored", { score: out.lead.score || 0 }, out.lead.id);
  }
  return out;
}

export function updateLead(id: string, patch: Partial<Lead>, byUserId: string, note?: string) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === id); if (!l) return;
    Object.assign(l, patch, { updatedAt: new Date().toISOString() });
    _act(d, "lead", id, byUserId, note || "Lead updated", "");
  });
}

export function assignLeadTo(leadId: string, userId: string | null, byUserId: string) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === leadId); if (!l) return;
    l.assigneeId = userId; l.updatedAt = new Date().toISOString();
    const u = userId ? d.users.find((x) => x.id === userId) : null;
    _act(d, "lead", leadId, byUserId, "Lead assigned", u ? `Assigned to ${u.name}` : "Unassigned");
    if (userId) _notice(d, userId, "New lead assigned", `${l.businessName} was assigned to you.`, "/leads", "lead");
  });
  if (userId) runTriggers("lead.assigned", { score: getDB().leads.find((l) => l.id === leadId)?.score || 0 }, leadId);
}

export function convertLead(leadId: string, opts: { customer: boolean; company: boolean; contact: boolean; deal: boolean; dealValue: number; dealTitle: string; managerId: string | null }, byUserId: string) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === leadId); if (!l) return;
    let customerId: string | undefined;
    if (opts.company) {
      const existing = d.companies.find((c) => normCompany(c.name) === normCompany(l.company || l.businessName));
      if (!existing) d.companies.unshift({ id: uid(), name: l.company || l.businessName, industry: l.industry || l.category, website: l.website, phone: l.phone, email: l.email, city: l.city, state: l.state, address: l.address, gstin: "", notes: `Converted from lead`, createdAt: new Date().toISOString() });
    }
    if (opts.customer) {
      const c = { id: uid(), name: l.contactPerson !== "—" ? l.contactPerson : l.businessName, company: l.company || l.businessName, phone: l.phone, email: l.email, whatsapp: l.whatsapp, gstin: "", pan: "", billingAddress: l.address, shippingAddress: l.address, city: l.city, state: l.state, country: l.country, managerId: opts.managerId || l.assigneeId, status: "Active" as const, notes: `Converted from lead ${l.businessName}`, leadId: l.id, createdAt: new Date().toISOString() };
      d.customers.unshift(c); customerId = c.id;
    }
    if (opts.contact) {
      d.contacts.unshift({ id: uid(), name: l.contactPerson !== "—" ? l.contactPerson : l.firstName + " " + l.lastName, title: "Owner", companyId: undefined, phone: l.phone, email: l.email, whatsapp: l.whatsapp, city: l.city, notes: "Converted from lead", createdAt: new Date().toISOString() });
    }
    if (opts.deal) {
      const stage = d.dealStages.find((s) => s.order === 1)!;
      d.deals.unshift({ id: uid(), title: opts.dealTitle || `${l.businessName} — opportunity`, leadId: l.id, customerId, stageId: stage.id, value: opts.dealValue || l.estimatedValue, expectedClose: addDaysISO(21), ownerId: l.assigneeId, priority: l.priority, notes: "", createdAt: new Date().toISOString() });
      _act(d, "deal", d.deals[0].id, byUserId, "Deal created", `From lead ${l.businessName} · ${inr(opts.dealValue || l.estimatedValue)}`);
    }
    l.status = "Converted"; l.convertedCustomerId = customerId; l.updatedAt = new Date().toISOString();
    _act(d, "lead", l.id, byUserId, "Customer converted", `Created: ${[opts.customer && "Customer", opts.company && "Company", opts.contact && "Contact", opts.deal && "Deal"].filter(Boolean).join(", ")}`);
    _notice(d, "managers", "Lead converted", `${l.businessName} converted by ${d.users.find((u) => u.id === byUserId)?.name}.`, "/customers", "lead");
  });
}

// ================= finance math =================
export interface DocTotals { subtotal: number; itemDiscount: number; discount: number; taxable: number; tax: number; total: number; }
export function docTotals(items: DocItem[], discountPct: number): DocTotals {
  const subtotal = items.reduce((s, i) => s + i.qty * i.rate, 0);
  const itemDiscount = items.reduce((s, i) => s + (i.qty * i.rate * (i.discountPct || 0)) / 100, 0);
  const afterItems = subtotal - itemDiscount;
  const discount = (afterItems * (discountPct || 0)) / 100;
  const taxable = afterItems - discount;
  const tax = items.reduce((s, i) => {
    const share = afterItems > 0 ? ((i.qty * i.rate * (1 - (i.discountPct || 0) / 100)) / afterItems) * taxable : 0;
    return s + (share * (i.gstPct || 0)) / 100;
  }, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { subtotal: r2(subtotal), itemDiscount: r2(itemDiscount), discount: r2(discount), taxable: r2(taxable), tax: r2(tax), total: r2(taxable + tax) };
}
export function paidFor(d: DB, invoiceId: string): number {
  return d.payments.filter((p) => p.invoiceId === invoiceId).reduce((s, p) => s + p.amount, 0);
}
export function sweepInvoices(d: DB) {
  const today = todayISO();
  for (const inv of d.invoices) {
    if (inv.status === "Cancelled" || inv.status === "Paid") continue;
    const total = docTotals(inv.items, inv.discountPct).total;
    const paid = paidFor(d, inv.id);
    let next: Invoice["status"] = inv.status;
    if (paid >= total && total > 0) next = "Paid";
    else if (inv.dueDate < today && total - paid > 0) next = "Overdue";
    else if (paid > 0) next = "Partially Paid";
    else if (inv.status === "Overdue") next = "Sent";
    if (next !== inv.status) {
      const was = inv.status; inv.status = next;
      _act(d, "invoice", inv.id, "system", "Invoice status updated", `${was} → ${next}`);
      if (next === "Overdue") {
        const cust = d.customers.find((c) => c.id === inv.customerId);
        _notice(d, "managers", `Invoice ${inv.number} overdue`, `${cust?.company || ""} — balance ${inr(total - paid)}.`, "/invoices", "invoice");
      }
    }
  }
}
export function sweepFollowups(d: DB) {
  const today = todayISO();
  for (const f of d.followups) {
    if (f.status === "Scheduled" && f.date < today) {
      f.status = "Missed";
      _act(d, "followup", f.id, f.employeeId, "Follow-up missed", `Was scheduled for ${f.date}`);
      _notice(d, f.employeeId, "Follow-up missed", `${f.type} follow-up from ${f.date} needs rescheduling.`, "/followups", "followup");
    }
  }
}
export function runSweeps() {
  mutate((d) => { sweepInvoices(d); sweepFollowups(d); });
}

// ================= quotation / invoice numbering =================
export function nextDocNumber(d: DB, kind: "QT" | "INV"): string {
  const year = new Date().getFullYear();
  const list = kind === "QT" ? d.quotations : d.invoices;
  let max = 0;
  for (const q of list) {
    const m = q.number.match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${kind}-${year}-${String(max + 1).padStart(3, "0")}`;
}

// ================= CSV =================
export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
export function downloadFile(name: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["\ufeff" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 800);
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportResult { total: number; imported: number; duplicates: number; failed: number; failedRows: { row: Record<string, string>; error: string }[]; }
export function importLeads(rows: Record<string, string>[], byUserId: string): ImportResult {
  const res: ImportResult = { total: rows.length, imported: 0, duplicates: 0, failed: 0, failedRows: [] };
  for (const raw of rows) {
    const r: Record<string, string> = {};
    Object.entries(raw).forEach(([k, v]) => { r[k.trim()] = (v || "").trim(); });
    if (!r.businessName && !r.company) { res.failed++; res.failedRows.push({ row: raw, error: "Missing business name" }); continue; }
    const input: Partial<Lead> = {
      businessName: r.businessName || r.company, company: r.company || r.businessName, contactPerson: r.contactPerson || r.contact || "",
      firstName: r.firstName || "", lastName: r.lastName || "", phone: r.phone || "", altPhone: r.altPhone || "",
      whatsapp: r.whatsapp || r.phone || "", email: r.email || "", website: r.website || "",
      category: r.category || "General", industry: r.industry || "", address: r.address || "", city: r.city || "",
      state: r.state || "", country: r.country || "India", postal: r.postal || "", source: r.source || "CSV Import",
      estimatedValue: Number(r.estimatedValue) || 25000,
    };
    const v = validateLead(input);
    if (v.status === "Invalid") { res.failed++; res.failedRows.push({ row: raw, error: v.issues.join("; ") }); continue; }
    const d = getDB();
    if (findDuplicates(d, input).length) { res.duplicates++; continue; }
    const out = createLead(input, byUserId, { source: "CSV Import", force: true, silent: true });
    if (out.lead) res.imported++; else { res.failed++; res.failedRows.push({ row: raw, error: "Insert failed" }); }
  }
  mutate((d) => _act(d, "system", "import", byUserId, "Leads imported", `${res.imported} imported · ${res.duplicates} duplicates · ${res.failed} failed`));
  return res;
}

// ================= discovery engine =================
const runners = new Map<string, ReturnType<typeof setInterval>>();
const DISC_PREFIX = ["Urban", "Skyline", "Truworth", "Craftly", "PixelKart", "GreenLeaf", "Sparkline", "Meridian", "HappiHub", "BoldNest", "FineEdge", "SwiftCart", "TrueNorth", "Lumina", "CopperPot", "Vistara", "NinePine", "AmberLane", "Corely", "Zesta"];
const DISC_SUFX = ["Studio", "Works", "Hub", "Collective", "Labs", "Point", "House", "Kart", "Desk", "Forge"];
function discName(cat: string, i: number): string {
  return `${DISC_PREFIX[(i * 7) % DISC_PREFIX.length]} ${DISC_SUFX[(i * 3) % DISC_SUFX.length]} ${cat.split(" ")[0] === "Digital" ? "" : ""}`.trim();
}
function tickJob(jobId: string) {
  mutate((d) => {
    const job = d.discoveryJobs.find((j) => j.id === jobId);
    if (!job || job.status !== "Running") { stopRunner(jobId); return; }
    // rate-limit simulation (HTTP 429 respect)
    if (Math.random() < 0.06 && job.attempts < 3) {
      job.attempts++;
      job.retryLog.push(`Attempt ${job.attempts + 1}: HTTP 429 — backing off, rate limit respected`);
      return;
    }
    if (job.source === "website") {
      job.attempts++;
      job.retryLog.push(`Attempt ${job.attempts}: site blocked automated access (robots/terms) — bounded retry ${job.attempts}/3`);
      if (job.attempts >= 3) {
        job.status = "Failed";
        job.error = "Automated collection not permitted by target site policy. Use CSV import or an official API integration instead.";
        job.completedAt = new Date().toISOString();
        stopRunner(jobId);
      }
      return;
    }
    const batch = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < batch && job.discovered < job.target; i++) {
      job.discovered++;
      const n = discName(job.category, job.discovered);
      const cand: Partial<Lead> = {
        businessName: n, company: n, contactPerson: "", phone: Math.random() > 0.08 ? `+91 9${Math.floor(100000000 + Math.random() * 899999999)}` : "",
        email: Math.random() > 0.15 ? `info@${n.toLowerCase().replace(/[^a-z0-9]+/g, "")}.in` : "",
        website: Math.random() > 0.25 ? `www.${n.toLowerCase().replace(/[^a-z0-9]+/g, "")}.in` : "",
        category: job.category, industry: job.category.split(" ")[0], city: job.location.split(",")[0].trim(),
        state: job.location.split(",")[1]?.trim() || "", source: "Discovery",
        rating: Math.random() > 0.5 ? Math.round((3.4 + Math.random() * 1.5) * 10) / 10 : null,
        reviewCount: Math.random() > 0.5 ? 5 + Math.floor(Math.random() * 200) : null,
        mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(n + " " + job.location)}`,
        sourceUrl: job.source === "maps" ? "https://maps.google.com" : "https://www.justdial.com",
        estimatedValue: [25000, 60000, 120000][Math.floor(Math.random() * 3)],
      };
      const invalid = !cand.phone && !cand.email;
      if (invalid || (cand.website && !isUrl(cand.website))) { job.invalid++; continue; }
      if (findDuplicates(d, cand).length) { job.duplicates++; continue; }
      job.valid++;
      const q = ruleQualify(d, cand);
      const v = validateLead(cand);
      const lead: Lead = {
        id: uid(), businessName: cand.businessName!, contactPerson: "—", firstName: "", lastName: "",
        phone: cand.phone || "", altPhone: "", whatsapp: cand.phone || "", email: cand.email || "", website: cand.website || "",
        category: cand.category!, industry: cand.industry || "", company: cand.company!, address: "",
        city: cand.city || "", state: cand.state || "", country: "India", postal: "",
        source: "Discovery", sourceUrl: cand.sourceUrl || "", mapsUrl: cand.mapsUrl || "", socialUrls: "",
        rating: cand.rating ?? null, reviewCount: cand.reviewCount ?? null,
        status: d.leadStatuses[0], priority: q.score >= 80 ? "High" : "Medium",
        score: q.score, temperature: q.temperature, intent: q.intent, recommendedAction: q.action, aiReason: q.reason, scoredBy: "rules",
        estimatedValue: cand.estimatedValue || 25000, assigneeId: null, tags: ["discovery"], notes: `Keywords: ${job.keywords || "—"}`,
        nextFollowUp: null, validation: v.status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), jobId: job.id,
      };
      const asg = pickAssignee(d, lead);
      lead.assigneeId = asg.userId;
      d.leads.unshift(lead);
      _act(d, "lead", lead.id, job.createdBy, "Lead imported from discovery", `Job: ${job.category} @ ${job.location} · score ${q.score}`);
      if (lead.assigneeId) _notice(d, lead.assigneeId, "New discovered lead", `${lead.businessName} (${lead.city}) auto-assigned to you.`, "/leads", "lead");
      // inline automation for speed
      for (const rule of d.rules.filter((r) => r.enabled && (r.trigger === "lead.created" || r.trigger === "lead.assigned" || r.trigger === "lead.scored"))) {
        if (condOk(rule, { category: lead.category, city: lead.city, score: lead.score || 0, industry: lead.industry })) {
          const parts = rule.actions.map((a) => runAction(d, a, lead, rule.name));
          d.ruleRuns.unshift({ id: uid(), ruleId: rule.id, ruleName: rule.name, summary: `discovery: ${parts.join(" · ")}`, at: new Date().toISOString() });
        }
      }
    }
    if (job.discovered >= job.target) {
      job.status = "Completed"; job.completedAt = new Date().toISOString();
      job.error = job.valid === 0 ? "No valid leads extracted." : "";
      stopRunner(jobId);
      _notice(d, job.createdBy, "Discovery job completed", `${job.category} @ ${job.location}: ${job.valid} valid of ${job.discovered}.`, "/discovery", "system");
    } else if (Math.random() < 0.012) {
      // source exhausted early → partially completed (never falsely "completed")
      job.status = job.valid > 0 ? "Partially Completed" : "Failed";
      job.completedAt = new Date().toISOString();
      job.error = `Source exhausted at ${job.discovered}/${job.target} (rate limits respected).`;
      stopRunner(jobId);
    }
  });
}
function stopRunner(jobId: string) { const t = runners.get(jobId); if (t) { clearInterval(t); runners.delete(jobId); } }
export function startJobRunner(jobId: string) {
  stopRunner(jobId);
  mutate((d) => {
    const j = d.discoveryJobs.find((x) => x.id === jobId);
    if (j && (j.status === "Queued" || j.status === "Paused")) {
      j.status = "Running";
      if (!j.startedAt) j.startedAt = new Date().toISOString();
    }
  });
  runners.set(jobId, setInterval(() => tickJob(jobId), 420));
}
export function pauseJob(jobId: string) {
  stopRunner(jobId);
  mutate((d) => { const j = d.discoveryJobs.find((x) => x.id === jobId); if (j && j.status === "Running") j.status = "Paused"; });
}
export function cancelJob(jobId: string) {
  stopRunner(jobId);
  mutate((d) => {
    const j = d.discoveryJobs.find((x) => x.id === jobId);
    if (j && ["Running", "Paused", "Queued"].includes(j.status)) { j.status = "Cancelled"; j.completedAt = new Date().toISOString(); }
  });
}
export function createDiscoveryJob(input: { category: string; location: string; target: number; source: DiscoveryJob["source"]; keywords: string }, byUserId: string): string {
  const id = uid();
  mutate((d) => {
    d.discoveryJobs.unshift({
      id, createdBy: byUserId, category: input.category, location: input.location,
      target: Math.max(1, Math.min(500, input.target)), source: input.source, keywords: input.keywords,
      status: "Queued", discovered: 0, valid: 0, duplicates: 0, invalid: 0, failedRecords: 0,
      startedAt: null, completedAt: null, error: "", attempts: 0, retryLog: [],
    });
    _act(d, "discovery", id, byUserId, "Discovery job created", `${input.category} @ ${input.location} · target ${input.target}`);
  });
  return id;
}
export function resumeStaleJobs() {
  const d = getDB();
  d.discoveryJobs.filter((j) => j.status === "Running" || j.status === "Queued").forEach((j) => startJobRunner(j.id));
}

// ================= AI (Ollama + offline fallback) =================
export async function ollamaPing(url: string, timeoutMs = 4000): Promise<{ ok: boolean; models: string[]; error?: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(`${url.replace(/\/$/, "")}/api/tags`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, models: [], error: `HTTP ${res.status}` };
    const data = (await res.json()) as { models?: { name: string }[] };
    return { ok: true, models: (data.models || []).map((m) => m.name) };
  } catch (e) {
    return { ok: false, models: [], error: e instanceof Error ? e.message : "Ollama unreachable" };
  }
}
async function ollamaGenerate(url: string, model: string, prompt: string, temperature: number, timeoutSec: number): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutSec * 1000);
  const res = await fetch(`${url.replace(/\/$/, "")}/api/generate`, {
    method: "POST", signal: ctl.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false, options: { temperature } }),
  });
  clearTimeout(t);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return data.response || "";
}
function logAI(kind: string, model: string, prompt: string, output: string, ms: number) {
  mutate((d) => { d.aiLogs.unshift({ id: uid(), kind, model, prompt: prompt.slice(0, 500), output: output.slice(0, 900), ms, at: new Date().toISOString() }); if (d.aiLogs.length > 100) d.aiLogs.length = 100; });
}

export async function aiQualify(lead: Partial<Lead>): Promise<{ usedAI: boolean; q: Qualification }> {
  const d = getDB();
  const s = d.settings.ai;
  const start = Date.now();
  try {
    const prompt = `You are a B2B sales analyst. Analyze this Indian business lead and respond with ONLY a JSON object {"score":0-100,"temperature":"Cold|Warm|Hot","intent":"Low|Medium|High","action":"Call|WhatsApp|Email|Demo|Follow-up|No Action","reason":"one sentence"}.
Business: ${lead.businessName}, Industry: ${lead.industry || lead.category}, City: ${lead.city}, Website: ${lead.website || "none"}, Phone: ${lead.phone ? "yes" : "no"}, Email: ${lead.email ? "yes" : "no"}, Rating: ${lead.rating ?? "n/a"}, Reviews: ${lead.reviewCount ?? "n/a"}, Source: ${lead.source}.`;
    const raw = await ollamaGenerate(s.url, s.model, prompt, s.temperature, Math.min(s.timeoutSec, 20));
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Unparseable AI output");
    const j = JSON.parse(m[0]) as { score: number; temperature: Temperature; intent: Intent; action: RecAction; reason: string };
    const q: Qualification = { score: Math.max(0, Math.min(100, Math.round(j.score))), temperature: j.temperature, intent: j.intent, action: j.action, reason: j.reason };
    logAI("qualify", s.model, prompt, raw, Date.now() - start);
    return { usedAI: true, q };
  } catch {
    const q = ruleQualify(d, lead);
    logAI("qualify-fallback", "rules-engine", lead.businessName || "", q.reason, Date.now() - start);
    return { usedAI: false, q };
  }
}

export function applyQualification(leadId: string, q: Qualification, byUserId: string, usedAI: boolean) {
  mutate((d) => {
    const l = d.leads.find((x) => x.id === leadId); if (!l) return;
    l.score = q.score; l.temperature = q.temperature; l.intent = q.intent;
    l.recommendedAction = q.action; l.aiReason = q.reason; l.scoredBy = usedAI ? "ai" : "rules";
    l.updatedAt = new Date().toISOString();
    _act(d, "lead", leadId, byUserId, usedAI ? "AI scored lead" : "Lead re-scored", `Score ${q.score} · ${q.temperature}`);
  });
  runTriggers("lead.scored", { score: q.score }, leadId);
}

// Heuristic assistant — works fully offline, uses real DB data.
export async function assistantReply(input: string): Promise<{ reply: string; usedAI: boolean }> {
  const d = getDB();
  const s = d.settings.ai;
  const lower = input.toLowerCase();
  const findLead = () => d.leads.find((l) => lower.includes(l.businessName.toLowerCase())) ||
    d.leads.find((l) => l.businessName.toLowerCase().split(" ").some((w) => w.length > 3 && lower.includes(w)));

  const build = (): string => {
    if (/pipeline risk|risk/.test(lower)) {
      const open = d.deals.filter((x) => d.dealStages.find((st) => st.id === x.stageId)?.kind === "open");
      const stale = open.filter((x) => (Date.now() - new Date(x.createdAt).getTime()) / 86400e3 > 21);
      return `Pipeline check: ${open.length} open deals worth ${inr(open.reduce((a, b) => a + b.value, 0))}. ${stale.length} deal(s) older than 3 weeks without close — review: ${stale.slice(0, 3).map((x) => x.title).join("; ") || "none"}. Overdue follow-ups: ${d.followups.filter((f) => f.status === "Missed").length}.`;
    }
    if (/performance|leaderboard/.test(lower)) {
      const rows = d.users.filter((u) => u.isSales).map((u) => perfOf(d, u)).sort((a, b) => b.converted - a.converted);
      return rows.map((r, i) => `${i + 1}. ${r.name}: ${r.assigned} leads, ${r.converted} converted (${r.rate}%), ${inr(r.revenue)} won, ${r.fuOverdue} overdue follow-ups`).join("\n");
    }
    if (/draft.*whatsapp|whatsapp.*draft|whatsapp message/.test(lower)) {
      const l = findLead(); const tpl = d.templates.find((t) => t.channel === "whatsapp" && t.name === "Introduction")!;
      const body = renderTemplate(tpl.body, { customer_name: l?.contactPerson !== "—" ? (l?.contactPerson || "there") : "there", employee_name: "our team", company_name: d.settings.company.name });
      return `Draft (edit before sending):\n\n${body}${l ? `\n\nOpen WhatsApp: https://wa.me/${normPhone(l.phone)}?text=${encodeURIComponent(body)}` : ""}`;
    }
    if (/draft.*email|email draft/.test(lower)) {
      const l = findLead(); const tpl = d.templates.find((t) => t.channel === "email" && t.name === "Introduction")!;
      const body = renderTemplate(tpl.body, { customer_name: l?.contactPerson || "there", employee_name: "Team", company_name: d.settings.company.name });
      return `Subject: ${tpl.subject}\n\n${body}`;
    }
    const l = findLead();
    if (l && /next.*(action|step)|recommend/.test(lower)) {
      const lastFu = d.followups.find((f) => f.entityId === l.id);
      const sug = l.temperature === "Hot" ? "Call today and propose a demo — hot leads cool in ~48h." : l.temperature === "Warm" ? "Send a WhatsApp intro with a relevant case study, follow up in 2 days." : "Verify contact details first; profile is thin.";
      return `${l.businessName} (score ${l.score ?? "—"}, ${l.temperature}). ${sug} ${lastFu ? `Last follow-up: ${lastFu.status} on ${lastFu.date}.` : "No follow-ups yet — create the first touch now."}`;
    }
    if (l && /summar/.test(lower)) {
      const acts = d.activities.filter((a) => a.entityId === l.id).length;
      return `${l.businessName} is a ${l.city}-based ${l.industry || l.category} business from ${l.source}. ${l.phone ? "Phone" : ""}${l.email ? ", email" : ""}${l.website ? " and website" : ""} available.${l.rating ? ` Public rating ${l.rating}★ (${l.reviewCount} reviews).` : ""} Lead score ${l.score ?? "—"}/100 (${l.temperature}). ${acts} timeline activities. Recommended: ${l.recommendedAction}.`;
    }
    const due = d.followups.filter((f) => f.status === "Scheduled" && f.date === todayISO()).length;
    return `I can: summarize a lead ("summarize <business name>"), recommend next action, draft WhatsApp/email messages, explain pipeline risks, or compare salesperson performance. Today you have ${due} follow-up(s) due and ${d.followups.filter((f) => f.status === "Missed").length} missed.`;
  };

  const start = Date.now();
  try {
    const ping = await ollamaPing(s.url, 1500);
    if (ping.ok) {
      const raw = await ollamaGenerate(s.url, s.model,
        `You are the sales AI assistant inside ITCT CRM (IT Cyber Technologies Pvt Ltd). Answer briefly and practically.\nQuestion: ${input}`, s.temperature, Math.min(s.timeoutSec, 15));
      logAI("assistant", s.model, input, raw, Date.now() - start);
      return { reply: raw.trim() || build(), usedAI: true };
    }
  } catch { /* offline */ }
  const reply = build();
  logAI("assistant-offline", "heuristic", input, reply, Date.now() - start);
  return { reply, usedAI: false };
}

export function perfOf(d: DB, u: User) {
  const leads = d.leads.filter((l) => l.assigneeId === u.id);
  const deals = d.deals.filter((x) => x.ownerId === u.id);
  const won = deals.filter((x) => d.dealStages.find((s) => s.id === x.stageId)?.kind === "won");
  const lost = deals.filter((x) => d.dealStages.find((s) => s.id === x.stageId)?.kind === "lost");
  const wonCustomerIds = won.map((x) => x.customerId);
  const revenue = d.payments.filter((p) => wonCustomerIds.includes(p.customerId)).reduce((a, b) => a + b.amount, 0);
  const converted = leads.filter((l) => l.status === "Converted").length;
  return {
    id: u.id, name: u.name, color: u.color, assigned: leads.length,
    contacted: leads.filter((l) => l.status !== "New").length,
    qualified: leads.filter((l) => ["Qualified", "Proposal", "Negotiation", "Converted"].includes(l.status)).length,
    converted, lost: leads.filter((l) => l.status === "Lost").length,
    dealsWon: won.length, dealsLost: lost.length, revenue,
    fuCompleted: d.followups.filter((f) => f.employeeId === u.id && f.status === "Completed").length,
    fuOverdue: d.followups.filter((f) => f.employeeId === u.id && f.status === "Missed").length,
    tasksCompleted: d.tasks.filter((t) => t.assigneeId === u.id && t.status === "Completed").length,
    rate: leads.length ? Math.round((converted / leads.length) * 100) : 0,
  };
}

// ================= templates & outreach =================
export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);
}
export const waLink = (phone: string, text: string) => `https://wa.me/${normPhone(phone)}?text=${encodeURIComponent(text)}`;
export const telLink = (phone: string) => `tel:${normPhone(phone)}`;

// ================= global search =================
export interface SearchHit { kind: string; title: string; sub: string; link: string; }
export function globalSearch(q: string): SearchHit[] {
  const d = getDB();
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const hits: SearchHit[] = [];
  const has = (...vals: (string | undefined | null)[]) => vals.some((v) => v && v.toLowerCase().includes(s));
  d.leads.filter((l) => has(l.businessName, l.contactPerson, l.phone, l.email, l.city)).slice(0, 6)
    .forEach((l) => hits.push({ kind: "Lead", title: l.businessName, sub: `${l.city} · ${l.status} · score ${l.score ?? "—"}`, link: `/leads?open=${l.id}` }));
  d.customers.filter((c) => has(c.name, c.company, c.phone, c.email)).slice(0, 5)
    .forEach((c) => hits.push({ kind: "Customer", title: c.company, sub: c.name, link: `/customers?open=${c.id}` }));
  d.companies.filter((c) => has(c.name, c.city)).slice(0, 4)
    .forEach((c) => hits.push({ kind: "Company", title: c.name, sub: c.city, link: `/customers?tab=companies&open=${c.id}` }));
  d.contacts.filter((c) => has(c.name, c.email, c.phone)).slice(0, 4)
    .forEach((c) => hits.push({ kind: "Contact", title: c.name, sub: c.title, link: `/customers?tab=contacts&open=${c.id}` }));
  d.deals.filter((x) => has(x.title)).slice(0, 4)
    .forEach((x) => hits.push({ kind: "Deal", title: x.title, sub: inr(x.value), link: "/pipeline" }));
  d.invoices.filter((x) => has(x.number)).slice(0, 3)
    .forEach((x) => hits.push({ kind: "Invoice", title: x.number, sub: `${x.status} · due ${fmtD(x.dueDate)}`, link: `/invoices?open=${x.id}` }));
  d.quotations.filter((x) => has(x.number)).slice(0, 3)
    .forEach((x) => hits.push({ kind: "Quotation", title: x.number, sub: x.status, link: `/quotations?open=${x.id}` }));
  return hits;
}

// ================= metrics =================
export function dashMetrics(d: DB) {
  const today = todayISO();
  const open = d.deals.filter((x) => d.dealStages.find((s) => s.id === x.stageId)?.kind === "open");
  const won = d.deals.filter((x) => d.dealStages.find((s) => s.id === x.stageId)?.kind === "won");
  const lost = d.deals.filter((x) => d.dealStages.find((s) => s.id === x.stageId)?.kind === "lost");
  const revenue = d.payments.reduce((a, b) => a + b.amount, 0);
  const invoiced = d.invoices.filter((i) => i.status !== "Cancelled" && i.status !== "Draft").reduce((a, i) => a + docTotals(i.items, i.discountPct).total, 0);
  const outstanding = d.invoices.filter((i) => !["Cancelled", "Draft", "Paid"].includes(i.status)).reduce((a, i) => a + Math.max(0, docTotals(i.items, i.discountPct).total - paidFor(d, i.id)), 0);
  const expenses = d.expenses.reduce((a, b) => a + b.amount, 0);
  return {
    totalLeads: d.leads.length,
    newToday: d.leads.filter((l) => l.createdAt.slice(0, 10) === today).length,
    newLeads: d.leads.filter((l) => l.status === "New").length,
    hot: d.leads.filter((l) => l.temperature === "Hot" && !["Converted", "Lost"].includes(l.status)).length,
    qualified: d.leads.filter((l) => ["Qualified", "Proposal", "Negotiation"].includes(l.status)).length,
    converted: d.leads.filter((l) => l.status === "Converted").length,
    customers: d.customers.length,
    pipelineValue: open.reduce((a, b) => a + b.value, 0),
    openDeals: open.length, wonDeals: won.length, lostDeals: lost.length,
    revenue, invoiced, outstanding, expenses, profit: revenue - expenses,
    fuToday: d.followups.filter((f) => f.status === "Scheduled" && f.date === today).length,
    fuOverdue: d.followups.filter((f) => f.status === "Missed").length,
    meetingsToday: d.meetings.filter((m) => m.date === today).length,
    openTasks: d.tasks.filter((t) => t.status === "Pending" || t.status === "In Progress").length,
    conversionRate: d.leads.length ? Math.round((d.leads.filter((l) => l.status === "Converted").length / d.leads.length) * 100) : 0,
    winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : 0,
    avgDeal: won.length ? Math.round(won.reduce((a, b) => a + b.value, 0) / won.length) : 0,
  };
}
export function leadGrowth(d: DB): { week: string; leads: number; converted: number }[] {
  const out: { week: string; leads: number; converted: number }[] = [];
  for (let w = 7; w >= 0; w--) {
    const start = Date.now() - (w + 1) * 7 * 86400e3, end = Date.now() - w * 7 * 86400e3;
    const inWin = d.leads.filter((l) => { const t = new Date(l.createdAt).getTime(); return t > start && t <= end; });
    const dt = new Date(end);
    out.push({ week: dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), leads: inWin.length, converted: inWin.filter((l) => l.status === "Converted").length });
  }
  return out;
}
export function monthlyRevenue(d: DB): { month: string; revenue: number; invoiced: number }[] {
  const out: { month: string; revenue: number; invoiced: number }[] = [];
  for (let m = 5; m >= 0; m--) {
    const dt = new Date(); dt.setDate(1); dt.setMonth(dt.getMonth() - m);
    const key = dt.toISOString().slice(0, 7);
    out.push({
      month: dt.toLocaleDateString("en-IN", { month: "short" }),
      revenue: d.payments.filter((p) => p.date.slice(0, 7) === key).reduce((a, b) => a + b.amount, 0),
      invoiced: d.invoices.filter((i) => i.date.slice(0, 7) === key && i.status !== "Cancelled" && i.status !== "Draft").reduce((a, i) => a + docTotals(i.items, i.discountPct).total, 0),
    });
  }
  return out;
}
export type { FollowUp, FUType, Quotation };
