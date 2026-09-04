/**
 * Backend → UI store hydration.
 *
 * Fully wired (read + write through the API): auth, dashboard, leads, pipeline,
 * notifications, global search. For every other module the store is hydrated
 * from PostgreSQL on login so the whole UI shows REAL server data; writes in
 * those modules are being migrated module-by-module to the API.
 */
import { mutate } from "./db";
import {
  customerApi, companyApi, contactApi, dealApi, followUpApi, taskApi, meetingApi,
  productApi, quotationApi, invoiceApi, paymentApi, expenseApi, userApi, roleApi, teamApi,
  automationApi, auditApi, settingsApi, leadApi,
} from "./api";
import { fromApiUser, fromApiLead, fromApiCustomer, fromApiDeal, fromApiStage,
         fromApiQuotation, fromApiInvoice, fromApiPayment } from "./mappers";
import type { DB } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
const S = (v: any): string | null => (v === null || v === undefined ? null : String(v));
const dstr = (v: any): string => (v ? String(v).slice(0, 10) : "");

export async function hydrateFromBackend(
  perms: Record<string, string[]> = {},
  isSuper = false,
): Promise<void> {
  const canView = (module: string) => isSuper || !!perms[module]?.includes("view");
  const empty = () => Promise.resolve({ data: [] } as any);
  const emptySettings = () => Promise.resolve({ data: {} } as any);

  const [leads, customers, companies, contacts, deals, stages, followups, tasks, meetings,
         products, quotations, invoices, payments, expenses, users, roles, teams,
         rules, executions, audit, settings] = await Promise.all([
    canView("leads") ? leadApi.list({ page: 1, page_size: 200 }) : empty(),
    canView("customers") ? customerApi.list({ page: 1, page_size: 200 }) : empty(),
    canView("companies") ? companyApi.list({ page: 1, page_size: 200 }) : empty(),
    canView("contacts") ? contactApi.list({ page: 1, page_size: 200 }) : empty(),
    canView("deals") ? dealApi.list({ page: 1, page_size: 500 }) : empty(),
    canView("deals") ? dealApi.stages() : empty(),
    canView("followups") ? followUpApi.list() : empty(),
    canView("tasks") ? taskApi.list() : empty(),
    canView("meetings") ? meetingApi.list() : empty(),
    canView("products") ? productApi.list() : empty(),
    canView("quotations") ? quotationApi.list() : empty(),
    canView("invoices") ? invoiceApi.list() : empty(),
    canView("payments") ? paymentApi.list() : empty(),
    canView("expenses") ? expenseApi.list() : empty(),
    canView("employees") ? userApi.list() : empty(),
    canView("employees") ? roleApi.list() : empty(),
    canView("employees") ? teamApi.list() : empty(),
    canView("automation") ? automationApi.listRules() : empty(),
    canView("automation") ? automationApi.executions() : empty(),
    canView("audit") ? auditApi.list({ page: 1, page_size: 100 }) : empty(),
    canView("settings") ? settingsApi.get() : emptySettings(),
  ]);

  const paged = (r: any) => (Array.isArray(r?.data) ? r.data : r?.data?.items || []);
  const co: any = settings.data?.company || {};
  const ai: any = settings.data?.ai || {};
  const sc: any = settings.data?.scoring || {};
  const asg: any = settings.data?.assignment || {};

  mutate((db: DB) => {
    db.users = paged(users).map((u: any) => fromApiUser(u));
    db.roles = paged(roles).map((r: any) => ({ id: S(r.id)!, name: r.name, description: r.description || "",
      system: !!r.system, perms: r.perms || {} }));
    db.teams = paged(teams).map((t: any) => ({ id: S(t.id)!, name: t.name, focus: t.focus || "",
      memberIds: (t.member_ids || []).map(String) }));
    db.leads = paged(leads).map((l: any) => fromApiLead(l));
    db.customers = paged(customers).map((c: any) => fromApiCustomer(c));
    db.companies = paged(companies).map((c: any) => ({ id: S(c.id)!, name: c.name, industry: c.industry || "",
      website: c.website || "", phone: c.phone || "", email: c.email || "", city: c.city || "", state: c.state || "",
      address: c.address || "", gstin: c.gst || "", notes: c.notes || "", createdAt: c.created_at }));
    db.contacts = paged(contacts).map((c: any) => ({ id: S(c.id)!, name: `${c.first_name} ${c.last_name || ""}`.trim(),
      title: c.designation || "", companyId: S(c.company_id) || undefined, phone: c.phone || "", email: c.email || "",
      whatsapp: c.whatsapp || "", city: c.city || "", notes: c.notes || "", createdAt: c.created_at }));
    db.dealStages = paged(stages).map((s: any) => fromApiStage(s));
    db.deals = paged(deals).map((d: any) => fromApiDeal(d));
    db.followups = paged(followups).map((f: any) => ({ id: S(f.id)!, entityType: f.entity_type || "lead",
      entityId: S(f.lead_id ?? f.customer_id)!, employeeId: S(f.employee_id)!, type: f.type, date: dstr(f.date),
      time: f.time || "10:00", reminder: !!f.reminder, status: f.status, notes: f.notes || "",
      outcome: f.outcome || "", createdAt: f.created_at }));
    db.tasks = paged(tasks).map((t: any) => ({ id: S(t.id)!, title: t.title, description: t.description || "",
      entityType: t.lead_id ? "lead" as const : t.customer_id ? "customer" as const : undefined,
      entityId: S(t.lead_id ?? t.customer_id) || undefined, assigneeId: S(t.assigned_to_id)!,
      priority: t.priority, status: t.status, dueDate: dstr(t.due_date), createdBy: S(t.created_by_id)!,
      createdAt: t.created_at }));
    db.meetings = paged(meetings).map((m: any) => ({ id: S(m.id)!, title: m.title,
      entityType: m.lead_id ? "lead" as const : "customer" as const, entityId: S(m.lead_id ?? m.customer_id)!,
      employeeIds: (m.participants || []).map(String), date: dstr(m.date), start: m.start_time || "10:00",
      end: m.end_time || "11:00", location: m.location || "", link: m.meeting_link || "", agenda: m.agenda || "",
      notes: m.notes || "", outcome: m.outcome || "", createdAt: m.created_at }));
    db.products = paged(products).map((p: any) => ({ id: S(p.id)!, name: p.name, sku: p.sku,
      category: p.category || "General", description: p.description || "", unit: p.unit || "unit",
      price: Number(p.unit_price) || 0, gstPct: Number(p.gst_percent) || 18, active: !!p.active }));
    db.quotations = paged(quotations).map((q: any) => fromApiQuotation(q));
    db.invoices = paged(invoices).map((i: any) => fromApiInvoice(i));
    db.payments = paged(payments).map((p: any) => fromApiPayment(p));
    db.expenses = paged(expenses).map((e: any) => ({ id: S(e.id)!, category: e.category || "General",
      vendor: e.description || "", amount: Number(e.amount) || 0, date: dstr(e.date), notes: e.notes || "",
      recordedBy: S(e.employee_id) || "", createdAt: e.created_at }));
    db.rules = paged(rules).map((r: any) => ({ id: S(r.id)!, name: r.name, trigger: r.trigger,
      condField: r.cond_field || "", condOp: r.cond_op || "eq", condValue: r.cond_value || "",
      actions: r.actions || [], enabled: !!r.enabled }));
    db.ruleRuns = paged(executions).map((x: any) => ({ id: S(x.id)!, ruleId: S(x.rule_id) || "",
      ruleName: x.rule_name || "", summary: x.summary || "", at: x.created_at }));
    db.auditLogs = paged(audit).map((a: any) => ({ id: S(a.id)!, userId: S(a.user_id) || "",
      userName: a.user_name || "System", action: a.action, target: a.target || "", detail: a.detail || "",
      at: a.created_at }));
    db.templates = (settings.data?.templates || []).map((t: any) => ({ id: S(t.id)!, channel: t.channel,
      name: t.name, subject: t.subject || "", body: t.body || "" }));
    db.leadStatuses = ["New", "Contacted", "Interested", "Follow-up", "Qualified", "Proposal", "Negotiation", "Won", "Lost"];
    db.leadSources = ["Google Maps", "Website Form", "Referral", "Justdial", "LinkedIn", "Cold Outreach",
      "CSV Import", "Discovery", "IndiaMART", "Walk-in"];
    db.settings = {
      company: { name: co.name || "IT CYBER TECHNOLOGIES PVT LTD", tagline: co.tagline || "",
        email: co.email || "", phone: co.phone || "", website: co.website || "", address: co.address || "",
        gstin: co.gstin || "", pan: co.pan || "", currency: co.currency || "INR",
        timezone: co.timezone || "Asia/Kolkata", logoMark: co.logo_mark || "I" },
      ai: { url: ai.url || "http://localhost:11434", model: ai.model || "qwen3",
        temperature: Number(ai.temperature ?? 0.4), timeoutSec: Number(ai.timeout_sec ?? 30) },
      scoring: { phone: Number(sc.phone ?? 10), email: Number(sc.email ?? 10), website: Number(sc.website ?? 10),
        location: Number(sc.location ?? 10), industry: Number(sc.industry ?? 15), rating: Number(sc.rating ?? 5),
        engagement: Number(sc.engagement ?? 20), targetLocations: sc.target_locations || [],
        targetIndustries: sc.target_industries || [] },
      assignment: { strategy: asg.strategy || "round_robin", rrPointer: Number(asg.rr_pointer ?? 0),
        highValueThreshold: Number(asg.high_value_threshold ?? 100000), highValueUserId: S(asg.high_value_user_id) || "",
        categoryMap: Object.fromEntries(Object.entries(asg.category_map || {}).map(([k, v]) => [k, String(v)])),
        locationMap: Object.fromEntries(Object.entries(asg.location_map || {}).map(([k, v]) => [k, String(v)])) },
    };
  });
}
