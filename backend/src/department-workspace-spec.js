/**
 * Step 5 department-domain source of truth from the uploaded ITCYBER Workforce
 * OS & CRM Department & Role Access Matrix specification.
 *
 * The four core entities per department are copied from the PDF. `hiring-pipeline`
 * is an explicit product addition requested by the user so HR can manage who is
 * being hired; it is intentionally labelled as an extension rather than a PDF row.
 */
const { DEPARTMENT_CATALOG, DEPARTMENT_BY_KEY } = require("./departments-catalog");
const { WORKFORCE_ROLES_BY_DEPARTMENT } = require("./workforce-roles");

const entity = (key, label, l3, l4, l5, l6, extra = {}) => Object.freeze({
  key, label, access: Object.freeze({ 3: l3, 4: l4, 5: l5, 6: l6 }), ...extra,
});

const DOMAIN_ENTITIES = Object.freeze({
  "executive-management": Object.freeze([
    entity("strategic-plans", "Strategic Plans", "Read/Write/Approve", "Read/Edit", "Read", "Read Only"),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read", "Read Only", { shared: true }),
    entity("final-approvals", "Final Approvals", "Approve", "Read", "None", "None"),
    entity("financial-pnl", "Financial P&L", "Read/Write", "Read", "None", "None", { financial: true }),
  ]),
  "hr-people": Object.freeze([
    entity("payroll-records", "Payroll Records", "Read/Write/Approve", "Read", "None", "None", { financial: true }),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("employee-docs", "Employee Docs", "Read/Write/Approve", "Read/Edit", "Read/Write", "Read Only"),
    entity("performance-reviews", "Performance Reviews", "Read/Write/Approve", "Read/Edit", "Read", "None"),
    entity("hiring-pipeline", "Hiring Pipeline", "Read/Write/Approve", "Read/Write", "Read/Write", "Read/Write", { extension: "user-request", pii: true }),
  ]),
  "finance-accounts": Object.freeze([
    entity("pnl-statements", "P&L Statements", "Read/Write/Approve", "Read", "None", "None", { financial: true }),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("client-invoices", "Client Invoices", "Read/Write/Approve", "Read/Edit", "Read/Write", "Read Only", { financial: true }),
    entity("vendor-payments", "Vendor Payments", "Approve", "Read/Edit", "Read/Write", "None", { financial: true }),
  ]),
  "sales-business-development": Object.freeze([
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("revenue-targets", "Revenue Targets", "Read/Write/Approve", "Read", "Read", "None", { financial: true }),
    entity("crm-lead-data", "CRM Lead Data", "Read/Write", "Read/Edit", "Read/Write", "Read (Masked)", { pii: true }),
    entity("proposals-contracts", "Proposals/Contracts", "Read/Write/Approve", "Read/Edit", "Read/Write", "None", { financial: true }),
  ]),
  "marketing-growth": Object.freeze([
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("marketing-budget", "Marketing Budget", "Read/Write/Approve", "Read", "None", "None", { financial: true }),
    entity("ad-campaign-data", "Ad Campaign Data", "Read/Write", "Read/Edit", "Read", "None", { financial: true }),
    entity("social-media-assets", "Social Media Assets", "Read/Write", "Read/Write", "Read/Write", "Read/Write"),
  ]),
  "project-management-pmo": Object.freeze([
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("project-budget", "Project Budget", "Read/Write/Approve", "Read/Edit", "Read", "None", { financial: true }),
    entity("milestone-status", "Milestone Status", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only"),
    entity("client-contracts", "Client Contracts", "Read/Write", "Read", "None", "None", { financial: true }),
  ]),
  "web-software-engineering": Object.freeze([
    entity("production-server", "Production Server", "Read/Write/Approve", "Execute (CI/CD)", "None", "None", { production: true }),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("code-repositories", "Code Repositories", "Read/Write", "Read/Write", "Read/Write", "Read (Branch Only)", { ip: true }),
    entity("system-architecture", "System Architecture", "Read/Write/Approve", "Read/Write", "Read", "Read Only", { ip: true }),
  ]),
  "ai-automation": Object.freeze([
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("api-keys", "API Keys", "Read/Write/Approve", "Read/Edit", "Read", "None", { credentials: true }),
    entity("automation-logic", "Automation Logic", "Read/Write", "Read/Write", "Read/Write", "Read Only", { production: true }),
    entity("internal-ai-tools", "Internal AI Tools", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only"),
  ]),
  "ui-ux-design": Object.freeze([
    entity("design-systems", "Design Systems", "Read/Write/Approve", "Read/Edit", "Read", "Read Only", { ip: true }),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("client-prototypes", "Client Prototypes", "Read/Write", "Read/Write", "Read/Write", "Read Only"),
    entity("brand-guidelines", "Brand Guidelines", "Read/Write/Approve", "Read", "Read", "Read"),
  ]),
  "qa-testing": Object.freeze([
    entity("uat-approval", "UAT Approval", "Approve", "Read/Edit", "Read", "None"),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("bug-reports", "Bug Reports", "Read/Write", "Read/Write", "Read/Write", "Read/Write"),
    entity("security-checks", "Security Checks", "Read/Write/Approve", "Read/Write", "None", "None", { production: true }),
  ]),
  "devops-it-infrastructure": Object.freeze([
    entity("root-server-access", "Root Server Access", "Read/Write/Approve", "Read/Edit", "None", "None", { credentials: true, production: true }),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("backup-config", "Backup Config", "Read/Write/Approve", "Read/Edit", "Read/Write", "None", { production: true }),
    entity("cicd-pipelines", "CI/CD Pipelines", "Read/Write", "Read/Write", "Read/Write", "Read Only", { production: true }),
  ]),
  cybersecurity: Object.freeze([
    entity("access-logs", "Access Logs", "Read/Write", "Read/Write", "Read", "Read Only (Anonymized)", { pii: true }),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("encryption-keys", "Encryption Keys", "Read/Write/Approve", "None", "None", "None", { credentials: true }),
    entity("security-reports", "Security Reports", "Read/Write", "Read/Write", "Read/Write", "Read Only"),
  ]),
  "customer-success": Object.freeze([
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("renewal-contracts", "Renewal Contracts", "Read/Write/Approve", "Read/Edit", "Read", "None", { financial: true }),
    entity("client-feedback", "Client Feedback", "Read/Write", "Read/Write", "Read/Write", "Read/Write", { pii: true }),
    entity("upsell-targets", "Upsell Targets", "Read/Write/Approve", "Read", "Read", "None", { financial: true }),
  ]),
  "admin-procurement": Object.freeze([
    entity("asset-registry", "Asset Registry", "Read/Write/Approve", "Read/Edit", "Read/Write", "Read Only"),
    entity("sops-documentation", "SOPs/Documentation", "Read/Write/Approve", "Read/Write", "Read/Write", "Read Only", { shared: true }),
    entity("vendor-contracts", "Vendor Contracts", "Read/Write/Approve", "Read/Edit", "Read", "None", { financial: true }),
    entity("office-budgets", "Office Budgets", "Read/Write/Approve", "Read", "None", "None", { financial: true }),
  ]),
});

function parseAccess(text) {
  const raw = String(text || "None").trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === "none") return { label: raw || "None", actions: [], restrictions: [] };
  const actions = new Set();
  if (lower.includes("read") || lower.includes("approve") || lower.includes("execute")) actions.add("read");
  if (lower.includes("write")) { actions.add("create"); actions.add("edit"); }
  if (lower.includes("edit")) actions.add("edit");
  if (lower.includes("approve")) actions.add("approve");
  if (lower.includes("execute")) actions.add("execute");
  const restrictions = [];
  if (lower.includes("masked")) restrictions.push("masked");
  if (lower.includes("branch only")) restrictions.push("branch-only");
  if (lower.includes("anonymized")) restrictions.push("anonymized");
  if (lower.includes("read only")) restrictions.push("read-only");
  return { label: raw, actions: [...actions], restrictions };
}

function departmentSpec(key) {
  const department = DEPARTMENT_BY_KEY.get(key);
  if (!department) return null;
  const roles = WORKFORCE_ROLES_BY_DEPARTMENT.get(key) || [];
  return { ...department, roles, entities: DOMAIN_ENTITIES[key] || [] };
}

function entitySpec(departmentKey, entityKey) {
  return (DOMAIN_ENTITIES[departmentKey] || []).find((x) => x.key === entityKey) || null;
}

function accessFor(departmentKey, entityKey, level, isGlobalAdmin = false) {
  const target = entitySpec(departmentKey, entityKey);
  if (!target) return { label: "None", actions: [], restrictions: [] };
  if (isGlobalAdmin) return { label: "Global Control", actions: ["read", "create", "edit", "approve", "execute"], restrictions: [] };
  return parseAccess(target.access[Number(level)] || "None");
}

function validateCatalog() {
  return DEPARTMENT_CATALOG.every((d) => Array.isArray(DOMAIN_ENTITIES[d.key]) && DOMAIN_ENTITIES[d.key].length >= 4);
}

module.exports = { DOMAIN_ENTITIES, parseAccess, departmentSpec, entitySpec, accessFor, validateCatalog };
