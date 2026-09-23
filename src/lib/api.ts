/**
 * ITCT CRM — Axios HTTP client for the Node.js/Express backend.
 *
 * When the Node.js/Express + PostgreSQL backend is running (npm start in backend/),
 * point VITE_API_URL at it (http://localhost:8000/api) and these calls become
 * the data source. Endpoints mirror backend/src/routes/* exactly.
 *
 * Production uses the backend as the only data source; browser demo mode is disabled.
 */
import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";

export const API_URL = (import.meta.env.VITE_API_URL as string) || "http://localhost:8000/api";
if (import.meta.env.PROD && !API_URL.startsWith("https://") && !API_URL.startsWith("/")) {
  throw new Error("Production VITE_API_URL must use HTTPS or a same-origin relative path.");
}
/** Production-only mode. PostgreSQL/backend is the single source of truth.
 * Legacy browser-demo flags are cleared and cannot be enabled. */
export const DEMO_MODE = false;
try { sessionStorage.removeItem("itct.demo"); } catch { /* storage unavailable */ }
export function enableDemo(): void {
  try { sessionStorage.removeItem("itct.demo"); } catch { /* storage unavailable */ }
}
export function disableDemo(): void {
  try { sessionStorage.removeItem("itct.demo"); } catch { /* storage unavailable */ }
}

const TOKEN_KEY = "itct.token";
const REFRESH_KEY = "itct.refresh";

export const api = axios.create({ baseURL: API_URL, timeout: 15000 });

api.interceptors.request.use((cfg) => {
  const t = sessionStorage.getItem(TOKEN_KEY);
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// ---------- refresh-token rotation queue (no infinite loops) ----------
let refreshing: Promise<string> | null = null;
type Retried = InternalAxiosRequestConfig & { _retry?: boolean };

async function doRefresh(): Promise<string> {
  const rt = sessionStorage.getItem(REFRESH_KEY);
  if (!rt) throw new Error("no-refresh-token");
  // raw axios — must NOT go through `api` (would re-enter the interceptor)
  const r = await axios.post<{ access_token: string; refresh_token: string }>(
    `${API_URL}/auth/refresh`, { refresh_token: rt }, { timeout: 10000 });
  sessionStorage.setItem(TOKEN_KEY, r.data.access_token);
  sessionStorage.setItem(REFRESH_KEY, r.data.refresh_token);
  return r.data.access_token;
}

export const CRM_DATA_CHANGED_EVENT = "itct:crm-data-changed";

api.interceptors.response.use(
  (res) => {
    const method = String(res.config.method || "get").toLowerCase();
    const url = String(res.config.url || "");
    if (["post", "put", "patch", "delete"].includes(method) && !url.includes("/auth/")) {
      try { window.dispatchEvent(new CustomEvent(CRM_DATA_CHANGED_EVENT)); } catch { /* non-browser test runtime */ }
    }
    return res;
  },
  async (err: AxiosError<{ detail?: string }>) => {
    const status = err.response?.status;
    const msg = err.response?.data?.detail || err.message;
    const original = err.config as Retried | undefined;

    // 401 on a normal request → try ONE refresh, then retry the original call
    if (status === 401 && original && !original._retry && !original.url?.includes("/auth/")) {
      original._retry = true;
      try {
        if (!refreshing) {
          refreshing = doRefresh().finally(() => { refreshing = null; });
        }
        const token = await refreshing;
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        clearTokens();
        if (location.hash !== "#/login") location.hash = "#/login";
        throw new Error("Session expired — please sign in again.");
      }
    }
    if (status === 401) {
      clearTokens();
      if (location.hash !== "#/login") location.hash = "#/login";
      throw new Error(msg || "Session expired — please sign in again.");
    }
    if (status === 403) throw new Error(typeof msg === "string" ? msg : "You don't have permission for this action.");
    if (status === 404) throw new Error(msg === "Not Found" ? "Record not found." : msg);
    if (status === 422) throw new Error(typeof msg === "string" && msg !== "Validation Error" ? msg : "Please check the form — some fields are invalid.");
    if (status === 429) throw new Error("Too many attempts. Please wait a moment.");
    throw new Error(status ? `Server error (${status}). Try again.` : "CRM server is unavailable. Please try again.");
  },
);

export const setTokens = (access: string | null, refresh?: string | null) => {
  if (access) sessionStorage.setItem(TOKEN_KEY, access); else sessionStorage.removeItem(TOKEN_KEY);
  if (refresh !== undefined) { if (refresh) sessionStorage.setItem(REFRESH_KEY, refresh); else sessionStorage.removeItem(REFRESH_KEY); }
};
export const clearTokens = () => setTokens(null, null);
export const getToken = () => sessionStorage.getItem(TOKEN_KEY);
export const hasSession = () => !!sessionStorage.getItem(TOKEN_KEY);

export interface Paged<T> { items: T[]; total: number; page: number; page_size: number; }
export interface Query { page?: number; page_size?: number; search?: string; status?: string; owner?: string; source?: string; priority?: string; city?: string; sort_by?: string; sort_order?: "asc" | "desc"; [k: string]: unknown; }

/** True when a real backend answers /health — used to decide embedded vs server mode. */
export async function backendAvailable(): Promise<boolean> {
  try {
    const r = await axios.get(`${API_URL}/health`, { timeout: 1500 });
    return r.status === 200;
  } catch { return false; }
}

// ---------- auth ----------
export const authApi = {
  login: (email: string, password: string) => api.post<{ access_token: string; refresh_token: string; token_type: string }>("/auth/login", { email, password }),
  refresh: (refresh_token: string) => api.post<{ access_token: string }>("/auth/refresh", { refresh_token }),
  logout: () => api.post("/auth/logout"),
  me: () => api.get("/auth/me"),
  changePassword: (old_password: string, new_password: string) => api.post("/auth/change-password", { old_password, new_password }),
};

// ---------- leads ----------
export const leadApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/leads", { params: q }),
  get: (id: number) => api.get(`/leads/${id}`),
  create: (body: unknown) => api.post("/leads", body),
  update: (id: number, body: unknown) => api.patch(`/leads/${id}`, body),
  remove: (id: number) => api.delete(`/leads/${id}`),
  assign: (id: number, body: { user_id?: number; team_id?: number; strategy?: string }) => api.post(`/leads/${id}/assign`, body),
  convert: (id: number, body: { customer?: boolean; company?: boolean; contact?: boolean; deal?: boolean }) => api.post(`/leads/${id}/convert`, body),
  score: (id: number) => api.post(`/leads/${id}/score`),
  duplicates: () => api.get("/leads/duplicates"),
  importCSV: (file: File, mapping: Record<string, string>) => {
    const fd = new FormData(); fd.append("file", file); fd.append("mapping", JSON.stringify(mapping));
    return api.post("/leads/import", fd);
  },
  exportCSV: () => api.get("/leads/export", { responseType: "blob" }),
};

// ---------- customers / companies / contacts ----------
export const customerApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/customers", { params: q }),
  get: (id: number) => api.get(`/customers/${id}`),
  create: (b: unknown) => api.post("/customers", b),
  update: (id: number, b: unknown) => api.patch(`/customers/${id}`, b),
  remove: (id: number) => api.delete(`/customers/${id}`),
  notes: () => api.get("/customer-notes"),
  addNote: (id: number, body: string) => api.post(`/customers/${id}/notes`, { body }),
};
export const companyApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/companies", { params: q }),
  create: (b: unknown) => api.post("/companies", b),
  update: (id: number, b: unknown) => api.patch(`/companies/${id}`, b),
};
export const contactApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/contacts", { params: q }),
  create: (b: unknown) => api.post("/contacts", b),
  update: (id: number, b: unknown) => api.patch(`/contacts/${id}`, b),
};

// ---------- deals ----------
export const dealApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/deals", { params: q }),
  create: (b: unknown) => api.post("/deals", b),
  update: (id: number, b: unknown) => api.patch(`/deals/${id}`, b),
  moveStage: (id: number, stage_id: string) => api.patch(`/deals/${id}/stage`, { stage_id }),
  remove: (id: number) => api.delete(`/deals/${id}`),
  stages: () => api.get("/deals/stages"),
};

// ---------- workflow ----------
export const followUpApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/followups", { params: q }),
  create: (b: unknown) => api.post("/followups", b),
  update: (id: number, b: unknown) => api.patch(`/followups/${id}`, b),
};
export const taskApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/tasks", { params: q }),
  create: (b: unknown) => api.post("/tasks", b),
  update: (id: number, b: unknown) => api.patch(`/tasks/${id}`, b),
  remove: (id: number) => api.delete(`/tasks/${id}`),
};
export const meetingApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/meetings", { params: q }),
  create: (b: unknown) => api.post("/meetings", b),
  update: (id: number, b: unknown) => api.patch(`/meetings/${id}`, b),
  remove: (id: number) => api.delete(`/meetings/${id}`),
};
export const callApi = { create: (b: unknown) => api.post("/calls", b) };

// ---------- billing ----------
export const productApi = {
  list: () => api.get("/products"),
  create: (b: unknown) => api.post("/products", b),
  update: (id: number, b: unknown) => api.patch(`/products/${id}`, b),
  remove: (id: number) => api.delete(`/products/${id}`),
};
export const quotationApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/quotations", { params: q }),
  get: (id: number) => api.get(`/quotations/${id}`),
  create: (b: unknown) => api.post("/quotations", b),
  update: (id: number, b: unknown) => api.patch(`/quotations/${id}`, b),
  remove: (id: number) => api.delete(`/quotations/${id}`),
  convertToInvoice: (id: number) => api.post(`/quotations/${id}/convert-to-invoice`),
};
export const invoiceApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/invoices", { params: q }),
  get: (id: number) => api.get(`/invoices/${id}`),
  create: (b: unknown) => api.post("/invoices", b),
  update: (id: number, b: unknown) => api.patch(`/invoices/${id}`, b),
  recordPayment: (id: number, b: { amount: number; payment_date: string; payment_method: string; transaction_reference?: string; notes?: string }) =>
    api.post(`/invoices/${id}/payments`, b),
};
export const paymentApi = { list: (q?: Query) => api.get<Paged<unknown>>("/payments", { params: q }) };
export const expenseApi = {
  list: (q?: Query) => api.get<Paged<unknown>>("/expenses", { params: q }),
  create: (b: unknown) => api.post("/expenses", b),
  remove: (id: number) => api.delete(`/expenses/${id}`),
};

// ---------- admin ----------
export const userApi = {
  list: () => api.get("/users"),
  create: (b: unknown) => api.post("/users", b),
  update: (id: number, b: unknown) => api.patch(`/users/${id}`, b),
  remove: (id: number) => api.delete(`/users/${id}`),
};
export const roleApi = {
  list: () => api.get("/roles"),
  create: (b: unknown) => api.post("/roles", b),
  update: (id: number, b: unknown) => api.patch(`/roles/${id}`, b),
  setPermissions: (id: number, perms: Record<string, string[]>) => api.put(`/roles/${id}/permissions`, perms),
  permissions: () => api.get("/permissions"),
};
export const teamApi = {
  list: () => api.get("/teams"),
  create: (b: unknown) => api.post("/teams", b),
  update: (id: number, b: unknown) => api.patch(`/teams/${id}`, b),
};
export const automationApi = {
  listRules: () => api.get("/automation/rules"),
  createRule: (b: unknown) => api.post("/automation/rules", b),
  updateRule: (id: number, b: unknown) => api.patch(`/automation/rules/${id}`, b),
  removeRule: (id: number) => api.delete(`/automation/rules/${id}`),
  executions: () => api.get("/automation/executions"),
};
export const auditApi = { list: (q?: Query) => api.get<Paged<unknown>>("/audit-logs", { params: q }) };
export const settingsApi = {
  get: () => api.get("/settings"),
  update: (b: unknown) => api.put("/settings", b),
};
export const notificationApi = {
  list: () => api.get("/notifications"),
  unreadCount: () => api.get<{ count: number }>("/notifications/unread"),
  markRead: (id: number) => api.patch(`/notifications/${id}/read`),
  readAll: () => api.post("/notifications/read-all"),
};

// ---------- analytics ----------
export const dashboardApi = {
  get: (range?: string) => api.get("/dashboard", { params: range ? { range } : undefined }),
  hotLeads: () => api.get("/dashboard/hot-leads"),
  agenda: () => api.get("/dashboard/agenda"),
  activity: () => api.get("/dashboard/activity"),
};
export const reportApi = {
  leads: (q?: Query) => api.get("/reports/leads", { params: q }),
  sales: (q?: Query) => api.get("/reports/sales", { params: q }),
  payments: (q?: Query) => api.get("/reports/payments", { params: q }),
  performance: (q?: Query) => api.get("/reports/performance", { params: q }),
};
export const searchApi = { get: (q: string) => api.get("/search", { params: { q } }) };
export const aiApi = {
  test: () => api.post("/ai/test"),
  leadSummary: (lead_id: number) => api.post("/ai/lead-summary", { lead_id }),
  nextAction: (lead_id: number) => api.post("/ai/next-action", { lead_id }),
};
export const uploadApi = {
  upload: (file: File, entity_type: string, entity_id: number) => {
    const fd = new FormData(); fd.append("file", file); fd.append("entity_type", entity_type); fd.append("entity_id", String(entity_id));
    return api.post("/attachments", fd);
  },
  list: (entity_type: string, entity_id: number) => api.get("/attachments", { params: { entity_type, entity_id } }),
};
