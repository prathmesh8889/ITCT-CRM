/**
 * Step 4 permission adapter for existing CRM pages.
 *
 * The uploaded Workforce OS PDF remains the source of truth. Its domain entities
 * (Design Systems, Bug Reports, API Keys, Asset Registry, etc.) are not all real
 * pages in this CRM yet. We map only a semantically matching existing module and
 * keep everything else deny-by-default rather than granting unrelated access.
 */
const add = (perms, module, actions) => {
  const out = new Set(perms[module] || []);
  for (const action of actions || []) out.add(action);
  perms[module] = [...out];
};

function addCommon(perms, level) {
  add(perms, "dashboard", ["view"]);
  add(perms, "notifications", ["view"]);
  if (level === 3) {
    add(perms, "tasks", ["view", "create", "edit", "delete", "assign"]);
    add(perms, "meetings", ["view", "create", "edit", "delete"]);
    add(perms, "calendar", ["view", "create", "edit", "delete"]);
    add(perms, "employees", ["view", "create", "edit"]); // own department only
    add(perms, "teams", ["view", "create", "edit"]); // own department only
  } else if (level === 4) {
    add(perms, "tasks", ["view", "create", "edit", "assign"]);
    add(perms, "meetings", ["view", "create", "edit"]);
    add(perms, "calendar", ["view", "create", "edit"]);
    add(perms, "employees", ["view"]); // own team only
    add(perms, "teams", ["view"]); // own team only
  } else if (level === 5) {
    add(perms, "tasks", ["view", "create", "edit"]);
    add(perms, "meetings", ["view", "create"]);
    add(perms, "calendar", ["view"]);
  } else if (level === 6) {
    add(perms, "tasks", ["view", "edit"]);
    add(perms, "calendar", ["view"]);
  }
}

function addSales(perms, level) {
  if (level === 3) {
    add(perms, "leads", ["view", "create", "edit", "assign"]);
    add(perms, "discovery", ["view", "create", "edit", "delete"]);
    add(perms, "customers", ["view", "create", "edit"]);
    add(perms, "companies", ["view", "create", "edit"]);
    add(perms, "contacts", ["view", "create", "edit"]);
    add(perms, "deals", ["view", "create", "edit", "assign"]);
    add(perms, "followups", ["view", "create", "edit"]);
    add(perms, "quotations", ["view", "create", "edit", "approve"]);
  } else if (level === 4) {
    add(perms, "leads", ["view", "edit", "assign"]);
    add(perms, "discovery", ["view", "create", "edit"]);
    add(perms, "customers", ["view", "edit"]);
    add(perms, "companies", ["view", "edit"]);
    add(perms, "contacts", ["view", "edit"]);
    add(perms, "deals", ["view", "edit"]);
    add(perms, "followups", ["view", "create", "edit"]);
    add(perms, "quotations", ["view", "edit"]);
  } else if (level === 5) {
    add(perms, "leads", ["view", "create", "edit"]);
    add(perms, "discovery", ["view", "create"]);
    add(perms, "customers", ["view", "create"]);
    add(perms, "companies", ["view"]);
    add(perms, "contacts", ["view", "create"]);
    add(perms, "deals", ["view", "create", "edit"]);
    add(perms, "followups", ["view", "create", "edit"]);
    add(perms, "quotations", ["view", "create", "edit"]);
  } else if (level === 6) {
    add(perms, "leads", ["view"]); // JSON PII is masked centrally
    add(perms, "discovery", ["view", "create"]);
  }
}

function addFinance(perms, level) {
  if (level === 3) {
    for (const m of ["quotations", "invoices", "payments", "expenses", "products"])
      add(perms, m, ["view", "create", "edit", "approve", "export"]);
  } else if (level === 4) {
    for (const m of ["quotations", "invoices", "payments", "expenses", "products"])
      add(perms, m, ["view", "create", "edit"]);
  } else if (level === 5) {
    add(perms, "quotations", ["view"]);
    for (const m of ["invoices", "payments", "expenses", "products"])
      add(perms, m, ["view", "create", "edit"]);
  }
  // L6 is intentionally denied the combined live billing pages: the PDF blocks
  // bank/cash data while allowing only entry-level processing.
}

function addMarketing(perms, level) {
  if (level === 3) {
    add(perms, "discovery", ["view", "create", "edit", "delete"]);
    add(perms, "leads", ["view", "create", "edit"]);
  } else if (level === 4) {
    add(perms, "discovery", ["view", "create", "edit"]);
    add(perms, "leads", ["view", "create", "edit"]);
  } else if (level === 5) {
    add(perms, "discovery", ["view", "create"]);
    add(perms, "leads", ["view", "create"]);
  } else if (level === 6) {
    add(perms, "discovery", ["view", "create"]);
    add(perms, "leads", ["view"]);
  }
}

function addCustomerSuccess(perms, level) {
  if (level === 3) {
    add(perms, "customers", ["view", "create", "edit"]);
    add(perms, "companies", ["view", "create", "edit"]);
    add(perms, "contacts", ["view", "create", "edit"]);
    add(perms, "followups", ["view", "create", "edit"]);
    add(perms, "deals", ["view", "create", "edit"]);
  } else if (level === 4) {
    add(perms, "customers", ["view", "edit"]);
    add(perms, "companies", ["view"]);
    add(perms, "contacts", ["view", "edit"]);
    add(perms, "followups", ["view", "create", "edit"]);
    add(perms, "deals", ["view"]);
  } else if (level === 5) {
    add(perms, "customers", ["view", "edit"]);
    add(perms, "contacts", ["view"]);
    add(perms, "followups", ["view", "create", "edit"]);
    add(perms, "deals", ["view"]);
  } else if (level === 6) {
    add(perms, "customers", ["view"]); // sanitized response
  }
}

function addDepartmentSpecific(perms, departmentKey, level) {
  switch (departmentKey) {
    case "hr-people":
      if (level === 3) add(perms, "employees", ["view", "create", "edit", "delete"]);
      else if (level === 4) add(perms, "employees", ["view", "edit"]);
      break;
    case "finance-accounts": addFinance(perms, level); break;
    case "sales-business-development": addSales(perms, level); break;
    case "marketing-growth": addMarketing(perms, level); break;
    case "project-management-pmo":
      if (level <= 5) {
        add(perms, "customers", ["view"]);
        add(perms, "companies", ["view"]);
        add(perms, "contacts", ["view"]);
      }
      break;
    case "ai-automation":
      if (level === 3) add(perms, "automation", ["view", "create", "edit", "delete"]);
      else if (level === 4 || level === 5) add(perms, "automation", ["view", "create", "edit"]);
      break;
    case "customer-success": addCustomerSuccess(perms, level); break;
    default:
      // Executive, Engineering, UI/UX, QA, DevOps, Cybersecurity and Admin /
      // Procurement have PDF entities that are not equivalent to an existing CRM
      // business page. Their common workflow + scoped directory remains available;
      // domain pages will be added separately rather than faking permissions.
      break;
  }
}

function workforcePermissions(role) {
  const level = Number(role?.level || role?.access_level);
  const departmentKey = String(role?.department_key || "").trim();
  const perms = {};
  if (![3, 4, 5, 6].includes(level) || !departmentKey) return perms;
  addCommon(perms, level);
  addDepartmentSpecific(perms, departmentKey, level);
  return perms;
}

module.exports = { workforcePermissions };
