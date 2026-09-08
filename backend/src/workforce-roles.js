/**
 * Step 3 source of truth: exact department roles from the approved ITCYBER
 * Workforce OS & CRM Department & Role Access Matrix specification.
 *
 * This file intentionally defines role identity, department, level and primary
 * function only. The document's entity-level CRUD matrices are implemented in
 * the next permission step; we do not invent or approximate those controls here.
 */
const WORKFORCE_ROLES = Object.freeze([
  // Executive Management
  { department_key: "executive-management", department: "Executive Management", level: 3, title: "COO / Operations Head", primary_function: "Managing entire company operations and system-wide SOPs." },
  { department_key: "executive-management", department: "Executive Management", level: 4, title: "Executive Assistant", primary_function: "Coordinating executive schedules and high-level reporting." },
  { department_key: "executive-management", department: "Executive Management", level: 5, title: "Strategy Analyst", primary_function: "Business growth research and partnership tracking." },
  { department_key: "executive-management", department: "Executive Management", level: 6, title: "Management Intern", primary_function: "Market research and basic documentation support." },

  // HR & People Department
  { department_key: "hr-people", department: "HR & People Department", level: 3, title: "HR Manager", primary_function: "Policy creation, payroll coordination, and leadership hiring." },
  { department_key: "hr-people", department: "HR & People Department", level: 4, title: "Recruitment Lead", primary_function: "Managing recruiters and initial screening pipelines." },
  { department_key: "hr-people", department: "HR & People Department", level: 5, title: "HR Operations/Recruiter", primary_function: "Onboarding, attendance, and candidate sourcing." },
  { department_key: "hr-people", department: "HR & People Department", level: 6, title: "HR Intern", primary_function: "Documentation support and screening coordination." },

  // Finance & Accounts
  { department_key: "finance-accounts", department: "Finance & Accounts", level: 3, title: "Finance Manager", primary_function: "Budgeting, P&L reporting, and large expense approval." },
  { department_key: "finance-accounts", department: "Finance & Accounts", level: 4, title: "Senior Accountant", primary_function: "Tax coordination and vendor payment oversight." },
  { department_key: "finance-accounts", department: "Finance & Accounts", level: 5, title: "Accounts Executive", primary_function: "Invoicing and daily expense tracking." },
  { department_key: "finance-accounts", department: "Finance & Accounts", level: 6, title: "Accounts Intern", primary_function: "Data entry and basic bill verification." },

  // Sales & Business Development
  { department_key: "sales-business-development", department: "Sales & Business Development", level: 3, title: "Sales Manager", primary_function: "Setting targets, revenue forecasting, and deal negotiation." },
  { department_key: "sales-business-development", department: "Sales & Business Development", level: 4, title: "Sales Team Leader", primary_function: "Managing BDE pipelines and daily follow-up tracking." },
  { department_key: "sales-business-development", department: "Sales & Business Development", level: 5, title: "BDE / SDR", primary_function: "Cold outreach, calling, and requirement gathering." },
  { department_key: "sales-business-development", department: "Sales & Business Development", level: 6, title: "Sales Intern", primary_function: "Lead research and outreach assistance." },

  // Marketing & Growth
  { department_key: "marketing-growth", department: "Marketing & Growth", level: 3, title: "Marketing Manager", primary_function: "Campaign strategy and budget allocation for Ads." },
  { department_key: "marketing-growth", department: "Marketing & Growth", level: 4, title: "Content/SEO Lead", primary_function: "Social media and SEO strategy execution." },
  { department_key: "marketing-growth", department: "Marketing & Growth", level: 5, title: "Graphic/Video Editor", primary_function: "Content creation and daily social posting." },
  { department_key: "marketing-growth", department: "Marketing & Growth", level: 6, title: "Marketing Intern", primary_function: "Basic social media management and lead scraping." },

  // Project Management (PMO)
  { department_key: "project-management-pmo", department: "Project Management (PMO)", level: 3, title: "PMO Head", primary_function: "Resource allocation and risk management strategy." },
  { department_key: "project-management-pmo", department: "Project Management (PMO)", level: 4, title: "Project Manager", primary_function: "Managing timelines, budget adherence, and client comms." },
  { department_key: "project-management-pmo", department: "Project Management (PMO)", level: 5, title: "Project Coordinator", primary_function: "Daily task updates and team follow-ups." },
  { department_key: "project-management-pmo", department: "Project Management (PMO)", level: 6, title: "PM Intern", primary_function: "Documentation and project status logging." },

  // Web & Software Engineering
  { department_key: "web-software-engineering", department: "Web & Software Engineering", level: 3, title: "Engineering Head", primary_function: "System architecture and technology standards." },
  { department_key: "web-software-engineering", department: "Web & Software Engineering", level: 4, title: "Tech Lead", primary_function: "Code reviews and backend logic oversight." },
  { department_key: "web-software-engineering", department: "Web & Software Engineering", level: 5, title: "Senior Developer", primary_function: "Core feature development and Git management." },
  { department_key: "web-software-engineering", department: "Web & Software Engineering", level: 6, title: "Tech Intern", primary_function: "Bug fixing in sandbox and learning tasks." },

  // AI & Automation
  { department_key: "ai-automation", department: "AI & Automation", level: 3, title: "AI Head", primary_function: "AI product roadmap and agent logic design." },
  { department_key: "ai-automation", department: "AI & Automation", level: 4, title: "AI Team Lead", primary_function: "LLM integration and automation workflow design." },
  { department_key: "ai-automation", department: "AI & Automation", level: 5, title: "Automation Engineer", primary_function: "Deploying n8n/Ollama and API integrations." },
  { department_key: "ai-automation", department: "AI & Automation", level: 6, title: "AI Intern", primary_function: "Testing automation scripts and data labeling." },

  // UI/UX & Design
  { department_key: "ui-ux-design", department: "UI/UX & Design", level: 3, title: "UI/UX Lead", primary_function: "Design system creation and brand guidelines." },
  { department_key: "ui-ux-design", department: "UI/UX & Design", level: 4, title: "Senior Designer", primary_function: "Product design and high-fidelity prototypes." },
  { department_key: "ui-ux-design", department: "UI/UX & Design", level: 5, title: "Graphic Designer", primary_function: "Daily marketing assets and UI elements." },
  { department_key: "ui-ux-design", department: "UI/UX & Design", level: 6, title: "Design Intern", primary_function: "Basic layouting and asset sourcing." },

  // QA & Testing
  { department_key: "qa-testing", department: "QA & Testing", level: 3, title: "QA Lead", primary_function: "QA strategy, test coverage, and final UAT sign-off." },
  { department_key: "qa-testing", department: "QA & Testing", level: 4, title: "Senior QA Engineer", primary_function: "Regression testing and automation testing." },
  { department_key: "qa-testing", department: "QA & Testing", level: 5, title: "QA Engineer", primary_function: "Functional and responsive testing." },
  { department_key: "qa-testing", department: "QA & Testing", level: 6, title: "QA Intern", primary_function: "Manual testing and bug logging." },

  // DevOps & IT Infrastructure
  { department_key: "devops-it-infrastructure", department: "DevOps & IT Infrastructure", level: 3, title: "DevOps Lead", primary_function: "Cloud infrastructure architecture and CI/CD strategy." },
  { department_key: "devops-it-infrastructure", department: "DevOps & IT Infrastructure", level: 4, title: "Infrastructure Mgr", primary_function: "Server monitoring, backups, and security audits." },
  { department_key: "devops-it-infrastructure", department: "DevOps & IT Infrastructure", level: 5, title: "DevOps Engineer", primary_function: "Deployment execution and domain management." },
  { department_key: "devops-it-infrastructure", department: "DevOps & IT Infrastructure", level: 6, title: "DevOps Intern", primary_function: "Monitoring logs and server health checks." },

  // Cybersecurity
  { department_key: "cybersecurity", department: "Cybersecurity", level: 3, title: "Security Lead", primary_function: "Security policies, access management, and audits." },
  { department_key: "cybersecurity", department: "Cybersecurity", level: 4, title: "Security Analyst", primary_function: "Vulnerability scans and incident response." },
  { department_key: "cybersecurity", department: "Cybersecurity", level: 5, title: "Security Engineer", primary_function: "Implementing authentication and data protection." },
  { department_key: "cybersecurity", department: "Cybersecurity", level: 6, title: "Security Intern", primary_function: "Assisting in security documentation and scans." },

  // Customer Success
  { department_key: "customer-success", department: "Customer Success", level: 3, title: "CS Head", primary_function: "Retention strategy and renewal monitoring." },
  { department_key: "customer-success", department: "Customer Success", level: 4, title: "CS Manager", primary_function: "Handling escalations and client feedback loops." },
  { department_key: "customer-success", department: "Customer Success", level: 5, title: "CS Associate", primary_function: "Onboarding and regular client communication." },
  { department_key: "customer-success", department: "Customer Success", level: 6, title: "CS Intern", primary_function: "Support ticket logging and CSAT surveys." },

  // Admin & Procurement
  { department_key: "admin-procurement", department: "Admin & Procurement", level: 3, title: "Admin Manager", primary_function: "Facilities strategy and large asset procurement." },
  { department_key: "admin-procurement", department: "Admin & Procurement", level: 4, title: "Admin Lead", primary_function: "Vendor negotiation and inventory management." },
  { department_key: "admin-procurement", department: "Admin & Procurement", level: 5, title: "Admin Executive", primary_function: "Daily office ops and asset tracking." },
  { department_key: "admin-procurement", department: "Admin & Procurement", level: 6, title: "Admin Intern", primary_function: "Document filing and inventory counts." },
].map((role, index) => Object.freeze({ ...role, order: index + 1 })));

const WORKFORCE_ROLE_BY_TITLE = new Map(WORKFORCE_ROLES.map((x) => [x.title.toLowerCase(), x]));
const WORKFORCE_ROLES_BY_DEPARTMENT = new Map();
for (const role of WORKFORCE_ROLES) {
  const list = WORKFORCE_ROLES_BY_DEPARTMENT.get(role.department_key) || [];
  list.push(role);
  WORKFORCE_ROLES_BY_DEPARTMENT.set(role.department_key, list);
}
for (const list of WORKFORCE_ROLES_BY_DEPARTMENT.values()) Object.freeze(list);

function getWorkforceRoleByTitle(title) {
  return WORKFORCE_ROLE_BY_TITLE.get(String(title || "").trim().toLowerCase()) || null;
}

module.exports = {
  WORKFORCE_ROLES,
  WORKFORCE_ROLE_BY_TITLE,
  WORKFORCE_ROLES_BY_DEPARTMENT,
  getWorkforceRoleByTitle,
};
