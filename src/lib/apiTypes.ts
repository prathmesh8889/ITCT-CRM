/**
 * Typed contracts for the FastAPI backend (snake_case, integer IDs).
 * UI code never consumes these directly — go through src/lib/mappers.ts.
 */

export interface Paged<T> { items: T[]; total: number; page: number; page_size: number; }

export interface ApiUser {
  id: number; name: string; email: string; phone: string;
  department: string; designation: string;
  role_id: number; team_id: number | null;
  is_sales: boolean; active: boolean; color: string;
  last_login_at: string | null; created_at: string;
}
export interface MeResponse {
  user: ApiUser; role_id: number | null; role: string;
  perms: Record<string, string[]>; is_super: boolean;
}

export interface ApiLead {
  id: number; lead_code: string;
  business_name: string; company_name: string; contact_person: string;
  first_name: string; last_name: string;
  email: string; phone: string; whatsapp: string; website: string;
  industry: string; category: string; source: string;
  city: string; state: string;
  status: string; priority: string;
  score: number | null; temperature: string | null; intent: string | null;
  recommended_action: string | null; ai_reason: string;
  estimated_value: number; validation: string;
  assigned_user_id: number | null; assigned_team_id: number | null;
  next_followup_at: string | null; notes: string;
  created_at: string; updated_at: string;
}

export interface ApiCustomer {
  id: number; customer_code: string; name: string; company: string;
  email: string; phone: string; whatsapp: string;
  gst_number: string; pan_number: string; city: string; state: string;
  account_manager_id: number | null; status: string; notes: string;
  lead_id: number | null; created_at: string;
}

export interface ApiDeal {
  id: number; name: string;
  lead_id: number | null; customer_id: number | null; company_id: number | null;
  stage_id: number; value: number; probability: number;
  expected_close_date: string | null; assigned_user_id: number | null;
  product_service: string; created_at: string; closed_at: string | null;
}
export interface ApiDealStage { id: number; key: string; name: string; order: number; kind: "open" | "won" | "lost"; }

export interface ApiDocItem {
  product_id: number | null; description: string; quantity: number;
  rate: number; discount_percent: number; gst_percent: number;
}
export interface ApiQuotation {
  id: number; quotation_number: string; customer_id: number;
  date: string; valid_until: string; items: ApiDocItem[];
  subtotal: number; discount_total: number; tax_total: number; grand_total: number;
  terms: string; notes: string; status: string; created_at: string;
}
export interface ApiInvoice {
  id: number; invoice_number: string; customer_id: number;
  invoice_date: string; due_date: string; items: ApiDocItem[];
  subtotal: number; discount_total: number; tax_total: number; grand_total: number;
  paid_amount: number; balance_due: number; status: string; notes: string; created_at: string;
}
export interface ApiPayment {
  id: number; payment_number: string; invoice_id: number; customer_id: number;
  amount: number; payment_date: string; payment_method: string;
  transaction_reference: string; notes: string; created_at: string;
}

export interface ApiDashboard {
  total_leads: number; new_leads: number; hot_leads: number;
  qualified_leads: number; converted_leads: number; lost_leads: number;
  total_customers: number; pipeline_value: number; won_revenue: number;
  monthly_revenue: number; outstanding: number; expenses: number; profit_estimate: number;
  tasks_due: number; overdue_tasks: number;
  followups_today: number; overdue_followups: number; meetings_today: number;
  conversion_rate: number; win_rate: number; avg_deal_size: number;
  pipeline_by_stage: { stage: string; value: number; count: number }[];
  leads_by_month: { month: string; leads: number }[];
}
export interface ApiHotLead {
  id: number; business_name: string; city: string; industry: string;
  score: number | null; estimated_value: number; recommended_action: string | null;
}
export interface ApiAgenda {
  followups: { id: number; type: string; time: string; entity_type: string; entity_id: number | null; name: string; employee: string }[];
  meetings: { id: number; title: string; start: string; end: string; location: string }[];
}
export interface ApiActivity { id: number; user: string; action: string; detail: string; at: string; }
export interface ApiNotice { id: number; title: string; body: string; link: string; kind: string; read: boolean; at: string; }
