/**
 * Central snake_case (API) ↔ camelCase (UI) mapping layer.
 * Integer IDs from PostgreSQL become string IDs in the UI model — conversions
 * happen ONLY here, never scattered across components.
 */
import type {
  ApiCustomer, ApiDashboard, ApiDeal, ApiDealStage, ApiDocItem, ApiHotLead,
  ApiInvoice, ApiLead, ApiPayment, ApiQuotation, ApiUser,
} from "./apiTypes";
import type { Customer, Deal, DealStage, DocItem, Invoice, Lead, Payment, Quotation, User } from "./types";

const s = (n: number | null | undefined): string | null => (n == null ? null : String(n));

// ---------------- users ----------------
export function fromApiUser(u: ApiUser): User {
  return {
    id: String(u.id), name: u.name, email: u.email, phone: u.phone,
    passHash: "", roleId: String(u.role_id), teamId: s(u.team_id) ?? undefined,
    active: u.active, color: u.color, isSales: u.is_sales,
    createdAt: u.created_at, lastLogin: u.last_login_at ?? undefined,
  };
}

// ---------------- leads ----------------
export function fromApiLead(l: ApiLead): Lead {
  return {
    id: String(l.id), businessName: l.business_name, contactPerson: l.contact_person,
    firstName: l.first_name, lastName: l.last_name,
    phone: l.phone, altPhone: "", whatsapp: l.whatsapp, email: l.email, website: l.website,
    category: l.category, industry: l.industry, company: l.company_name,
    address: "", city: l.city, state: l.state, country: "India", postal: "",
    source: l.source, sourceUrl: "", mapsUrl: "", socialUrls: "",
    rating: null, reviewCount: null,
    status: l.status, priority: LeadPriority(l.priority),
    score: l.score, temperature: l.temperature as Lead["temperature"], intent: l.intent as Lead["intent"],
    recommendedAction: l.recommended_action as Lead["recommendedAction"], aiReason: l.ai_reason,
    scoredBy: l.score == null ? null : (l.ai_reason.includes("Rule-scored") ? "rules" : "ai"),
    estimatedValue: l.estimated_value, assigneeId: s(l.assigned_user_id),
    tags: [], notes: l.notes, nextFollowUp: l.next_followup_at,
    validation: l.validation as Lead["validation"],
    createdAt: l.created_at, updatedAt: l.updated_at,
  };
}
function LeadPriority(p: string): Lead["priority"] {
  return (["Low", "Medium", "High", "Urgent"].includes(p) ? p : "Medium") as Lead["priority"];
}

/** UI form → POST /leads body */
export function toApiLeadCreate(l: Partial<Lead>): Record<string, unknown> {
  return {
    business_name: l.businessName, contact_person: l.contactPerson,
    first_name: l.firstName, last_name: l.lastName,
    email: l.email, phone: l.phone, alternate_phone: l.altPhone, whatsapp: l.whatsapp,
    website: l.website, industry: l.industry, category: l.category,
    source: l.source, address: l.address, city: l.city, state: l.state,
    postal_code: l.postal, status: l.status, priority: l.priority,
    estimated_value: l.estimatedValue,
    assigned_user_id: l.assigneeId ? Number(l.assigneeId) : null,
    next_followup_at: l.nextFollowUp, notes: l.notes,
  };
}
/** UI partial edit → PATCH /leads/{id} body (undefined keys dropped) */
export function toApiLeadUpdate(l: Partial<Lead>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: [keyof Lead, string][] = [
    ["businessName", "business_name"], ["contactPerson", "contact_person"], ["email", "email"],
    ["phone", "phone"], ["whatsapp", "whatsapp"], ["website", "website"], ["industry", "industry"],
    ["category", "category"], ["source", "source"], ["city", "city"], ["state", "state"],
    ["status", "status"], ["priority", "priority"], ["estimatedValue", "estimated_value"],
    ["nextFollowUp", "next_followup_at"], ["notes", "notes"],
  ];
  for (const [k, api] of map) if (l[k] !== undefined) out[api] = l[k];
  if (l.assigneeId !== undefined) out.assigned_user_id = l.assigneeId ? Number(l.assigneeId) : null;
  return out;
}

// ---------------- customers ----------------
export function fromApiCustomer(c: ApiCustomer): Customer {
  return {
    id: String(c.id), name: c.name, company: c.company, phone: c.phone, email: c.email,
    whatsapp: c.whatsapp, gstin: c.gst_number, pan: c.pan_number,
    billingAddress: "", shippingAddress: "", city: c.city, state: c.state, country: "India",
    managerId: s(c.account_manager_id), status: c.status as Customer["status"],
    notes: c.notes, leadId: c.lead_id ? String(c.lead_id) : undefined, createdAt: c.created_at,
  };
}
export function toApiCustomer(c: Partial<Customer>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: [keyof Customer, string][] = [
    ["name", "name"], ["company", "company"], ["phone", "phone"], ["email", "email"],
    ["whatsapp", "whatsapp"], ["gstin", "gst_number"], ["pan", "pan_number"],
    ["city", "city"], ["state", "state"], ["status", "status"], ["notes", "notes"],
    ["billingAddress", "billing_address"], ["shippingAddress", "shipping_address"],
  ];
  for (const [k, api] of map) if (c[k] !== undefined) out[api] = c[k];
  if (c.managerId !== undefined) out.account_manager_id = c.managerId ? Number(c.managerId) : null;
  return out;
}

// ---------------- deals ----------------
export function fromApiDeal(d: ApiDeal): Deal {
  return {
    id: String(d.id), title: d.name, leadId: d.lead_id ? String(d.lead_id) : undefined,
    customerId: d.customer_id ? String(d.customer_id) : undefined,
    companyId: d.company_id ? String(d.company_id) : undefined,
    stageId: String(d.stage_id), value: d.value, expectedClose: d.expected_close_date || "",
    ownerId: s(d.assigned_user_id), priority: "Medium", notes: d.product_service,
    createdAt: d.created_at, closedAt: d.closed_at ?? undefined,
  };
}
export function toApiDeal(d: Partial<Deal>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.title !== undefined) out.name = d.title;
  if (d.value !== undefined) out.value = d.value;
  if (d.customerId !== undefined) out.customer_id = d.customerId ? Number(d.customerId) : null;
  if (d.leadId !== undefined) out.lead_id = d.leadId ? Number(d.leadId) : null;
  if (d.stageId !== undefined) out.stage_id = Number(d.stageId);
  if (d.ownerId !== undefined) out.assigned_user_id = d.ownerId ? Number(d.ownerId) : null;
  if (d.expectedClose !== undefined) out.expected_close_date = d.expectedClose || null;
  return out;
}
export function fromApiStage(st: ApiDealStage): DealStage {
  return { id: String(st.id), name: st.name, order: st.order, kind: st.kind };
}

// ---------------- documents ----------------
export function fromApiItem(i: ApiDocItem): DocItem {
  return { id: String(i.product_id ?? Math.random()), name: i.description, productId: s(i.product_id) ?? undefined,
           qty: i.quantity, rate: i.rate, discountPct: i.discount_percent, gstPct: i.gst_percent };
}
export function toApiItems(items: DocItem[]): ApiDocItem[] {
  return items.map((i) => ({ product_id: i.productId ? Number(i.productId) : null, description: i.name,
                             quantity: i.qty, rate: i.rate, discount_percent: i.discountPct, gst_percent: i.gstPct }));
}
export function fromApiQuotation(q: ApiQuotation): Quotation {
  return {
    id: String(q.id), number: q.quotation_number, customerId: String(q.customer_id),
    date: q.date, validUntil: q.valid_until, items: q.items.map(fromApiItem),
    discountPct: 0, status: q.status as Quotation["status"], terms: q.terms, notes: q.notes,
    createdBy: "", createdAt: q.created_at,
  };
}
export function fromApiInvoice(i: ApiInvoice): Invoice {
  return {
    id: String(i.id), number: i.invoice_number, customerId: String(i.customer_id),
    date: i.invoice_date, dueDate: i.due_date, items: i.items.map(fromApiItem),
    discountPct: 0, status: i.status as Invoice["status"], notes: i.notes,
    createdBy: "", createdAt: i.created_at,
  };
}
export function fromApiPayment(p: ApiPayment): Payment {
  return {
    id: String(p.id), invoiceId: String(p.invoice_id), customerId: String(p.customer_id),
    amount: p.amount, date: p.payment_date, mode: p.payment_method as Payment["mode"],
    txnId: p.transaction_reference, notes: p.notes, recordedBy: "", createdAt: p.created_at,
  };
}

// ---------------- dashboard ----------------
export interface UiDashboard {
  totalLeads: number; newLeads: number; hot: number; qualified: number; converted: number;
  customers: number; pipelineValue: number; revenue: number; outstanding: number;
  fuToday: number; fuOverdue: number; tasksDue: number; overdueTasks: number; meetingsToday: number;
  conversionRate: number; winRate: number;
  pipelineByStage: { stage: string; value: number; count: number }[];
  leadsByMonth: { month: string; leads: number }[];
}
export function fromApiDashboard(d: ApiDashboard): UiDashboard {
  return {
    totalLeads: d.total_leads, newLeads: d.new_leads, hot: d.hot_leads, qualified: d.qualified_leads,
    converted: d.converted_leads, customers: d.total_customers, pipelineValue: d.pipeline_value,
    revenue: d.monthly_revenue, outstanding: d.outstanding, fuToday: d.followups_today,
    fuOverdue: d.overdue_followups, tasksDue: d.tasks_due, overdueTasks: d.overdue_tasks,
    meetingsToday: d.meetings_today, conversionRate: d.conversion_rate, winRate: d.win_rate,
    pipelineByStage: d.pipeline_by_stage, leadsByMonth: d.leads_by_month,
  };
}
export function fromApiHotLead(h: ApiHotLead): { id: string; businessName: string; city: string; industry: string; score: number | null; estimatedValue: number; recommendedAction: string | null } {
  return { id: String(h.id), businessName: h.business_name, city: h.city, industry: h.industry,
           score: h.score, estimatedValue: h.estimated_value, recommendedAction: h.recommended_action };
}
