/**
 * Step 2 source-of-truth department catalog from the ITCYBER Workforce OS
 * Department & Role Access Matrix specification.
 *
 * Roles and CRUD permission matrices are intentionally NOT implemented here;
 * they belong to Step 3. This file only defines the approved departments and
 * their strategic context so the organization structure is stable first.
 */
const DEPARTMENT_CATALOG = Object.freeze([
  Object.freeze({
    key: "executive-management",
    order: 1,
    name: "Executive Management",
    strategic_context: "Company vision and growth strategy ko lead karna, including high-value partnerships and investment decisions.",
  }),
  Object.freeze({
    key: "hr-people",
    order: 2,
    name: "HR & People Department",
    strategic_context: "Hiring process ko structured banana aur complete employee lifecycle manage karna, taaki hiring system-driven ho aur founder-dependent na rahe.",
  }),
  Object.freeze({
    key: "finance-accounts",
    order: 3,
    name: "Finance & Accounts",
    strategic_context: "Expenses ko controlled rakhna, revenue tracking automate karna aur finance approval system ke through budget adherence ensure karna.",
  }),
  Object.freeze({
    key: "sales-business-development",
    order: 4,
    name: "Sales & Business Development",
    strategic_context: "Continuous qualified leads generate karna aur revenue engine ko system-driven banana. Lead data critical company asset hai aur leakage se protect rehna chahiye.",
  }),
  Object.freeze({
    key: "marketing-growth",
    order: 5,
    name: "Marketing & Growth",
    strategic_context: "Inbound lead flow aur brand visibility badhana, high-impact content aur ads manage karna without losing ROI sensitivity.",
  }),
  Object.freeze({
    key: "project-management-pmo",
    order: 6,
    name: "Project Management (PMO)",
    strategic_context: "Sales handover se delivery tak bridge provide karna. Projects ko SOP-compliant, on-time aur margin-aware delivery tak le jana.",
  }),
  Object.freeze({
    key: "web-software-engineering",
    order: 7,
    name: "Web & Software Engineering",
    strategic_context: "High-quality technology tools develop karna while security practices aur performance standards ko mandatory baseline rakhna.",
  }),
  Object.freeze({
    key: "ai-automation",
    order: 8,
    name: "AI & Automation",
    strategic_context: "AI-first company objective ko drive karna aur repetitive work automate karke human hours save karna.",
  }),
  Object.freeze({
    key: "ui-ux-design",
    order: 9,
    name: "UI/UX & Design",
    strategic_context: "Visual quality aur user experience maintain karna. Design systems company branding ka core hain.",
  }),
  Object.freeze({
    key: "qa-testing",
    order: 10,
    name: "QA & Testing",
    strategic_context: "Bug-free delivery ensure karna. Development complete tab tak project complete nahi mana jayega jab tak QA sign-off na ho.",
  }),
  Object.freeze({
    key: "devops-it-infrastructure",
    order: 11,
    name: "DevOps & IT Infrastructure",
    strategic_context: "System uptime aur secure deployment pipelines manage karna; infrastructure security boundaries yahin maintain hoti hain.",
  }),
  Object.freeze({
    key: "cybersecurity",
    order: 12,
    name: "Cybersecurity",
    strategic_context: "ITCYBER aur clients ke data ko security threats se protect karna.",
  }),
  Object.freeze({
    key: "customer-success",
    order: 13,
    name: "Customer Success",
    strategic_context: "Better relationship management ke through client retention aur upsell opportunities identify karna.",
  }),
  Object.freeze({
    key: "admin-procurement",
    order: 14,
    name: "Admin & Procurement",
    strategic_context: "Office assets aur vendor relationships manage karke operational efficiency maintain karna.",
  }),
]);

const DEPARTMENT_BY_KEY = new Map(DEPARTMENT_CATALOG.map((x) => [x.key, x]));
const DEPARTMENT_BY_NAME = new Map(DEPARTMENT_CATALOG.map((x) => [x.name.toLowerCase(), x]));

module.exports = {
  DEPARTMENT_CATALOG,
  DEPARTMENT_BY_KEY,
  DEPARTMENT_BY_NAME,
};
