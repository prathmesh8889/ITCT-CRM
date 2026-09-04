// ---------- ITCT CRM (IT Cyber Technologies Pvt Ltd) domain model ----------
export type ID = string;

export type ModuleKey =
  | "dashboard" | "leads" | "discovery" | "customers" | "companies" | "contacts"
  | "deals" | "followups" | "tasks" | "meetings" | "calendar" | "quotations"
  | "invoices" | "payments" | "expenses" | "products" | "employees" | "reports"
  | "automation" | "ai" | "settings" | "audit";

export type Perm = "view" | "create" | "edit" | "delete" | "assign" | "export" | "approve";

export interface Role {
  id: ID; name: string; description: string; system: boolean;
  perms: Partial<Record<ModuleKey, Perm[]>>;
}
export interface Team { id: ID; name: string; focus: string; memberIds: ID[]; }
export interface User {
  id: ID; name: string; email: string; phone: string; passHash: string;
  roleId: ID; teamId?: ID; active: boolean; color: string; isSales: boolean;
  createdAt: string; lastLogin?: string;
}

export type Priority = "Low" | "Medium" | "High" | "Urgent";
export type Temperature = "Cold" | "Warm" | "Hot";
export type Intent = "Low" | "Medium" | "High";
export type RecAction = "Call" | "WhatsApp" | "Email" | "Demo" | "Follow-up" | "No Action";
export type ValidStatus = "Valid" | "Partially Valid" | "Invalid" | "Needs Review";

export interface Lead {
  id: ID; businessName: string; contactPerson: string; firstName: string; lastName: string;
  phone: string; altPhone: string; whatsapp: string; email: string; website: string;
  category: string; industry: string; company: string;
  address: string; city: string; state: string; country: string; postal: string;
  source: string; sourceUrl: string; mapsUrl: string; socialUrls: string;
  rating: number | null; reviewCount: number | null;
  status: string; priority: Priority;
  score: number | null; temperature: Temperature | null; intent: Intent | null;
  recommendedAction: RecAction | null; aiReason: string; scoredBy: "ai" | "rules" | null;
  estimatedValue: number; assigneeId: ID | null; tags: string[]; notes: string;
  nextFollowUp: string | null; validation: ValidStatus;
  createdAt: string; updatedAt: string; convertedCustomerId?: ID; jobId?: ID;
}

export type JobStatus = "Queued" | "Running" | "Paused" | "Completed" | "Partially Completed" | "Failed" | "Cancelled";
export interface DiscoveryJob {
  id: ID; createdBy: ID; category: string; location: string; target: number;
  source: "maps" | "directory" | "website" | "csv"; keywords: string;
  status: JobStatus; discovered: number; valid: number; duplicates: number;
  invalid: number; failedRecords: number; startedAt: string | null; completedAt: string | null;
  error: string; attempts: number; retryLog: string[];
}

export interface Company { id: ID; name: string; industry: string; website: string; phone: string; email: string; city: string; state: string; address: string; gstin: string; notes: string; createdAt: string; }
export interface Contact { id: ID; name: string; title: string; companyId?: ID; phone: string; email: string; whatsapp: string; city: string; notes: string; createdAt: string; }
export interface Customer {
  id: ID; name: string; company: string; phone: string; email: string; whatsapp: string;
  gstin: string; pan: string; billingAddress: string; shippingAddress: string;
  city: string; state: string; country: string; managerId: ID | null;
  status: "Active" | "Inactive" | "On Hold"; notes: string; leadId?: ID; createdAt: string;
}

export interface DealStage { id: ID; name: string; order: number; kind: "open" | "won" | "lost"; }
export interface Deal {
  id: ID; title: string; leadId?: ID; customerId?: ID; companyId?: ID; stageId: ID;
  value: number; expectedClose: string; ownerId: ID | null; priority: Priority;
  notes: string; createdAt: string; closedAt?: string;
}

export type FUType = "Call" | "WhatsApp" | "Email" | "Meeting" | "Demo" | "Proposal" | "Payment" | "Other";
export type FUStatus = "Scheduled" | "Completed" | "Missed" | "Cancelled" | "Rescheduled";
export interface FollowUp {
  id: ID; entityType: "lead" | "customer"; entityId: ID; employeeId: ID;
  type: FUType; date: string; time: string; reminder: boolean; status: FUStatus;
  notes: string; outcome: string; createdAt: string; completedAt?: string;
}

export type CallOutcome = "Connected" | "No Answer" | "Busy" | "Interested" | "Not Interested" | "Callback" | "Wrong Number";
export interface CallLog {
  id: ID; entityType: "lead" | "customer"; entityId: ID; employeeId: ID;
  direction: "Outgoing" | "Incoming"; outcome: CallOutcome; notes: string; durationMin: number; createdAt: string;
}

export interface Meeting {
  id: ID; title: string; entityType: "lead" | "customer"; entityId: ID; employeeIds: ID[];
  date: string; start: string; end: string; location: string; link: string;
  agenda: string; notes: string; outcome: string; createdAt: string;
}

export interface Task {
  id: ID; title: string; description: string; entityType?: "lead" | "customer"; entityId?: ID;
  assigneeId: ID; priority: Priority; status: "Pending" | "In Progress" | "Completed" | "Cancelled";
  dueDate: string; createdBy: ID; createdAt: string;
}

export interface Note { id: ID; entityType: string; entityId: ID; body: string; authorId: ID; createdAt: string; }

export interface Product {
  id: ID; name: string; sku: string; category: string; description: string;
  unit: string; price: number; gstPct: number; active: boolean;
}

export interface DocItem { id: ID; name: string; productId?: ID; qty: number; rate: number; discountPct: number; gstPct: number; }
export type QuoteStatus = "Draft" | "Sent" | "Accepted" | "Rejected" | "Expired";
export interface Quotation {
  id: ID; number: string; customerId: ID; date: string; validUntil: string;
  items: DocItem[]; discountPct: number; status: QuoteStatus; terms: string; notes: string;
  createdBy: ID; createdAt: string;
}
export type InvoiceStatus = "Draft" | "Sent" | "Partially Paid" | "Paid" | "Overdue" | "Cancelled";
export interface Invoice {
  id: ID; number: string; customerId: ID; date: string; dueDate: string;
  items: DocItem[]; discountPct: number; status: InvoiceStatus; notes: string;
  quotationId?: ID; createdBy: ID; createdAt: string;
}

export type PayMode = "Cash" | "UPI" | "Bank Transfer" | "Card" | "Cheque" | "Other";
export interface Payment {
  id: ID; invoiceId: ID; customerId: ID; amount: number; date: string; mode: PayMode;
  txnId: string; notes: string; recordedBy: ID; createdAt: string;
}
export interface Expense { id: ID; category: string; vendor: string; amount: number; date: string; notes: string; recordedBy: ID; createdAt: string; }

export interface Activity { id: ID; entityType: string; entityId: ID; userId: ID; action: string; detail: string; at: string; }
export interface Notice {
  id: ID; userId: ID | "managers"; title: string; body: string; read: boolean; at: string;
  link: string; kind: "lead" | "followup" | "meeting" | "task" | "invoice" | "quote" | "system" | "ai";
}
export interface AuditLog { id: ID; userId: ID; userName: string; action: string; target: string; detail: string; at: string; }

export type TriggerKey =
  | "lead.created" | "lead.assigned" | "lead.scored" | "lead.status"
  | "quote.sent" | "invoice.overdue" | "followup.missed";
export type RuleActionType =
  | "assign_team" | "assign_user" | "assign_strategy" | "followup" | "notify"
  | "set_priority" | "set_status";
export interface RuleAction { type: RuleActionType; value: string; hours?: number; fuType?: FUType; }
export interface AutomationRule {
  id: ID; name: string; trigger: TriggerKey; condField: string;
  condOp: "eq" | "neq" | "gte" | "lte" | "contains"; condValue: string;
  actions: RuleAction[]; enabled: boolean;
}
export interface AutomationRun { id: ID; ruleId: ID; ruleName: string; summary: string; at: string; }

export interface Template { id: ID; channel: "whatsapp" | "email"; name: string; subject: string; body: string; }

export interface AILog { id: ID; kind: string; model: string; prompt: string; output: string; ms: number; at: string; }

export interface CompanySettings {
  name: string; tagline: string; email: string; phone: string; website: string;
  address: string; gstin: string; pan: string; currency: string; timezone: string; logoMark: string;
}
export interface AISettings { url: string; model: string; temperature: number; timeoutSec: number; }
export interface ScoringRules {
  phone: number; email: number; website: number; location: number; industry: number;
  rating: number; engagement: number; targetLocations: string[]; targetIndustries: string[];
}
export type Strategy = "manual" | "round_robin" | "least_leads" | "least_workload" | "location" | "category" | "priority" | "team";
export interface AssignmentSettings {
  strategy: Strategy; rrPointer: number; highValueThreshold: number; highValueUserId: ID | "";
  categoryMap: Record<string, ID>; locationMap: Record<string, ID>;
}

export interface Settings {
  company: CompanySettings; ai: AISettings; scoring: ScoringRules; assignment: AssignmentSettings;
}

export interface DB {
  v: number;
  users: User[]; roles: Role[]; teams: Team[];
  leads: Lead[]; leadSources: string[]; leadStatuses: string[];
  discoveryJobs: DiscoveryJob[];
  customers: Customer[]; companies: Company[]; contacts: Contact[];
  deals: Deal[]; dealStages: DealStage[];
  followups: FollowUp[]; calls: CallLog[]; meetings: Meeting[]; tasks: Task[]; notes: Note[];
  products: Product[]; quotations: Quotation[]; invoices: Invoice[]; payments: Payment[]; expenses: Expense[];
  activities: Activity[]; notices: Notice[]; auditLogs: AuditLog[];
  rules: AutomationRule[]; ruleRuns: AutomationRun[];
  templates: Template[]; aiLogs: AILog[];
  settings: Settings;
}
