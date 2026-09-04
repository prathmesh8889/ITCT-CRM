import type {
  DB, Lead, User, Customer, Deal, FollowUp, Task, Meeting, CallLog, Quotation,
  Invoice, Payment, Expense, DocItem, Priority, FUType, CallOutcome, Notice, Activity,
} from "./types";
import { uid, hashPass } from "./db";

// deterministic RNG so demo data is stable
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260903);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const ri = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;

const isoDay = (offset: number) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const isoAt = (offsetDays: number, h = 10, m = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays); d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const CITIES: [string, string][] = [
  ["Pune", "Maharashtra"], ["Mumbai", "Maharashtra"], ["Nagpur", "Maharashtra"],
  ["Bengaluru", "Karnataka"], ["Hyderabad", "Telangana"], ["Chennai", "Tamil Nadu"],
  ["Delhi", "Delhi"], ["Gurugram", "Haryana"], ["Ahmedabad", "Gujarat"],
  ["Surat", "Gujarat"], ["Jaipur", "Rajasthan"], ["Indore", "Madhya Pradesh"],
  ["Kochi", "Kerala"], ["Lucknow", "Uttar Pradesh"],
];
const CATS: Record<string, { suf: string[]; ind: string }> = {
  "Digital Marketing Agency": { suf: ["Media", "Digital", "Growth Labs", "Adworks", "Marketing"], ind: "Digital Marketing" },
  "Software Company": { suf: ["Technologies", "Softwares", "Infosystems", "Techlabs", "Solutions"], ind: "Software" },
  "Manufacturing": { suf: ["Engineering", "Industries", "Works", "Fabricators", "Toolings"], ind: "Manufacturing" },
  "Interior Design": { suf: ["Interiors", "Spaces", "Design Studio", "Decor Co", "Estudio"], ind: "Interior Design" },
  "Restaurant & Café": { suf: ["Kitchen", "Cafe", "Bistro", "Tandoor", "Dining"], ind: "Hospitality" },
  "Healthcare Clinic": { suf: ["Clinic", "Care Centre", "Health", "Diagnostics", "Wellness"], ind: "Healthcare" },
  "Fitness & Gym": { suf: ["Fitness", "Gym", "Athletics", "Iron Club", "Wellness Club"], ind: "Fitness" },
  "Education Institute": { suf: ["Academy", "Classes", "Institute", "Learning Hub", "Tutorials"], ind: "Education" },
  "Real Estate": { suf: ["Realty", "Properties", "Homes", "Estates", "Developers"], ind: "Real Estate" },
  "E-commerce Store": { suf: ["Mart", "Cart", "Traders", "Ecom", "Retail"], ind: "E-commerce" },
  "CA & Accounting Firm": { suf: ["& Associates", "Tax Consultants", "& Co", "Advisors", "Associates"], ind: "Financial Services" },
  "Logistics & Transport": { suf: ["Logistics", "Cargo", "Transport", "Express", "Carriers"], ind: "Logistics" },
};
const PREFIX = ["Saffron", "Nexbit", "BlueFern", "Trident", "Aum", "Vertex", "SilverOak", "Prism", "Orchid", "Zenith", "Crest", "Maple", "Harbor", "Indigo", "Lotus", "Summit", "Cedar", "Velocity", "Astra", "Nova", "Pinnacle", "Radiant", "Everest", "Catalyst", "Falcon", "Mosaic", "Beacon", "Quantum", "Terra", "Kaveri"];
const FIRST = ["Rahul", "Priya", "Amit", "Sneha", "Vikram", "Ananya", "Karan", "Divya", "Nikhil", "Pooja", "Sandeep", "Ritika", "Manish", "Swati", "Alok", "Neha", "Rohit", "Ishita", "Gaurav", "Meera"];
const LAST = ["Deshmukh", "Sharma", "Patel", "Kulkarni", "Singh", "Iyer", "Mehta", "Reddy", "Joshi", "Verma", "Kapoor", "Nair", "Bose", "Chopra", "Rao", "Menon", "Gupta", "Shah", "Pillai", "Agarwal"];
const SOURCES = ["Google Maps", "Website Form", "Referral", "Justdial", "LinkedIn", "Cold Outreach", "CSV Import", "Discovery", "IndiaMART", "Walk-in"];

function phone(): string { return `+91 ${pick(["98", "97", "96", "99", "95"])}${ri(10000000, 99999999)}`; }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, ""); }

function makeLead(i: number, status: string, assignee: string | null, ageDays: number): Lead {
  const cat = pick(Object.keys(CATS));
  const name = `${pick(PREFIX)} ${pick(CATS[cat].suf)}`;
  const [city, st] = pick(CITIES);
  const fn = pick(FIRST), ln = pick(LAST);
  const hasPhone = rnd() > 0.06, hasEmail = rnd() > 0.12, hasWeb = rnd() > 0.18;
  const p = hasPhone ? phone() : "";
  const domain = `${slug(name)}.in`;
  const created = isoAt(-ageDays, ri(9, 18), ri(0, 59));
  const rating = rnd() > 0.5 ? Math.round((3.2 + rnd() * 1.7) * 10) / 10 : null;
  const score = Math.min(97, Math.max(18,
    (hasPhone ? 10 : 0) + (hasEmail ? 10 : 0) + (hasWeb ? 10 : 0) +
    (["Pune", "Mumbai", "Bengaluru", "Hyderabad"].includes(city) ? 10 : 0) +
    (["Software", "Digital Marketing", "E-commerce", "Manufacturing", "Real Estate"].includes(CATS[cat].ind) ? 15 : 0) +
    (rating && rating >= 4.2 ? 5 : 0) + ri(0, 30)));
  return {
    id: uid(), businessName: name, contactPerson: `${fn} ${ln}`, firstName: fn, lastName: ln,
    phone: p, altPhone: rnd() > 0.8 ? phone() : "", whatsapp: p, email: hasEmail ? `${slug(fn)}.${slug(ln)}@${domain}` : "",
    website: hasWeb ? `www.${domain}` : "", category: cat, industry: CATS[cat].ind, company: name,
    address: `${ri(2, 400)}, ${pick(["MG Road", "FC Road", "Ring Road", "Park Street", "Station Road", "Hill Road"])}`,
    city, state: st, country: "India", postal: String(ri(110001, 682001)),
    source: pick(SOURCES), sourceUrl: "", mapsUrl: hasWeb ? `https://maps.google.com/?q=${encodeURIComponent(name + " " + city)}` : "",
    socialUrls: "", rating, reviewCount: rating ? ri(8, 420) : null,
    status, priority: pick(["Low", "Medium", "Medium", "High", "Urgent"] as Priority[]),
    score, temperature: score >= 75 ? "Hot" : score >= 45 ? "Warm" : "Cold",
    intent: score >= 75 ? "High" : score >= 45 ? "Medium" : "Low",
    recommendedAction: score >= 75 ? pick(["Call", "Demo"] as const) : score >= 45 ? pick(["WhatsApp", "Email"] as const) : "Follow-up",
    aiReason: `Rule-scored: ${hasPhone ? "phone ✓ " : ""}${hasEmail ? "email ✓ " : ""}${hasWeb ? "website ✓ " : ""}${rating ? `rating ${rating}★ ` : ""}in ${CATS[cat].ind}.`,
    scoredBy: "rules", estimatedValue: pick([25000, 25000, 60000, 150000, 200000, 300000]),
    assigneeId: assignee, tags: rnd() > 0.7 ? [pick(["smb", "enterprise", "renewal", "inbound", "outbound"])] : [],
    notes: "", nextFollowUp: status === "New" || status === "Contacted" ? isoDay(ri(-2, 5)) : null,
    validation: hasPhone || hasEmail ? (hasPhone && hasEmail ? "Valid" : "Partially Valid") : "Needs Review",
    createdAt: created, updatedAt: created,
  };
}

export function buildSeed(): DB {
  const now = new Date().toISOString();

  // ---------- roles ----------
  const all = ["view", "create", "edit", "delete", "assign", "export", "approve"] as const;
  const roles: DB["roles"] = [
    { id: "r_super", name: "Super Admin", description: "Full control of every module", system: true, perms: Object.fromEntries((["dashboard","leads","discovery","customers","companies","contacts","deals","followups","tasks","meetings","calendar","quotations","invoices","payments","expenses","products","employees","reports","automation","ai","settings","audit"] as const).map((m) => [m, [...all]])) },
    { id: "r_admin", name: "Admin", description: "Manages CRM configuration and data", system: true, perms: Object.fromEntries((["dashboard","leads","discovery","customers","companies","contacts","deals","followups","tasks","meetings","calendar","quotations","invoices","payments","expenses","products","employees","reports","automation","ai","settings","audit"] as const).map((m) => [m, [...all]])) },
    { id: "r_mgr", name: "Sales Manager", description: "Team oversight, assignment and reporting", system: true, perms: { dashboard: ["view"], leads: ["view", "create", "edit", "assign", "export"], discovery: ["view", "create", "edit", "delete"], customers: ["view", "create", "edit", "export"], companies: ["view", "create", "edit"], contacts: ["view", "create", "edit"], deals: ["view", "create", "edit", "assign", "export"], followups: ["view", "create", "edit"], tasks: ["view", "create", "edit", "assign"], meetings: ["view", "create", "edit"], calendar: ["view"], quotations: ["view", "create", "edit", "approve", "export"], invoices: ["view", "create", "edit", "export"], payments: ["view", "create"], expenses: ["view"], products: ["view"], employees: ["view"], reports: ["view", "export"], automation: ["view", "create", "edit"], ai: ["view", "create"], settings: ["view"], audit: ["view"] } },
    { id: "r_sales", name: "Sales Executive", description: "Works assigned leads and deals", system: true, perms: { dashboard: ["view"], leads: ["view", "create", "edit"], customers: ["view", "create"], companies: ["view"], contacts: ["view", "create"], deals: ["view", "create", "edit"], followups: ["view", "create", "edit"], tasks: ["view", "create", "edit"], meetings: ["view", "create"], calendar: ["view"], quotations: ["view", "create", "edit"], invoices: ["view"], payments: ["view"], reports: ["view"], ai: ["view", "create"] } },
    { id: "r_acct", name: "Accountant", description: "Billing, payments and books", system: true, perms: { dashboard: ["view"], quotations: ["view", "create", "edit", "export"], invoices: ["view", "create", "edit", "export"], payments: ["view", "create", "edit", "export"], expenses: ["view", "create", "edit", "export"], customers: ["view"], products: ["view", "create", "edit"], reports: ["view", "export"] } },
    { id: "r_mkt", name: "Marketing", description: "Lead discovery and campaigns", system: true, perms: { dashboard: ["view"], leads: ["view", "create", "edit", "export"], discovery: ["view", "create", "edit", "delete"], customers: ["view"], reports: ["view"] } },
    { id: "r_support", name: "Support", description: "Read-only customer context", system: true, perms: { dashboard: ["view"], customers: ["view"], tasks: ["view", "create", "edit"] } },
  ];

  // ---------- teams & users ----------
  const teams: DB["teams"] = [
    { id: "t_pune", name: "Pune Sales Team", focus: "Software & IT services — Pune region", memberIds: [] },
    { id: "t_west", name: "West Sales Team", focus: "Marketing & e-commerce — Mumbai/Gujarat", memberIds: [] },
    { id: "t_ent", name: "Enterprise Team", focus: "High-value custom software deals", memberIds: [] },
  ];
  const pw = hashPass("Admin@123");
  const pwSales = hashPass("Sales@123");
  const mkUser = (id: string, name: string, email: string, roleId: string, teamId: string | undefined, isSales: boolean, color: string, pass: string): User =>
    ({ id, name, email, phone: phone(), passHash: pass, roleId, teamId, active: true, color, isSales, createdAt: isoAt(-120), lastLogin: isoAt(-1, 9) });
  const users: User[] = [
    mkUser("u_admin", "Kautuk Ade", "admin@crm.local", "r_super", undefined, false, "#0F766E", pw),
    mkUser("u_adm2", "Kavya Nair", "kavya@itctcrm.in", "r_admin", undefined, false, "#7C3AED", pw),
    mkUser("u_mgr", "Rohit Bansal", "rohit@itctcrm.in", "r_mgr", undefined, false, "#B45309", pw),
    mkUser("u_s1", "Rahul Deshmukh", "rahul@itctcrm.in", "r_sales", "t_pune", true, "#2563EB", pwSales),
    mkUser("u_s2", "Priya Sharma", "priya@itctcrm.in", "r_sales", "t_west", true, "#DB2777", pwSales),
    mkUser("u_s3", "Amit Patel", "amit@itctcrm.in", "r_sales", "t_west", true, "#059669", pwSales),
    mkUser("u_s4", "Sneha Kulkarni", "sneha@itctcrm.in", "r_sales", "t_pune", true, "#D97706", pwSales),
    mkUser("u_s5", "Vikram Singh", "vikram@itctcrm.in", "r_sales", "t_ent", true, "#4F46E5", pwSales),
    mkUser("u_acct", "Neha Joshi", "neha@itctcrm.in", "r_acct", undefined, false, "#0891B2", pwSales),
    mkUser("u_mkt", "Farhan Khan", "farhan@itctcrm.in", "r_mkt", undefined, false, "#65A30D", pwSales),
  ];
  teams[0].memberIds = ["u_s1", "u_s4"];
  teams[1].memberIds = ["u_s2", "u_s3"];
  teams[2].memberIds = ["u_s5"];
  const sales = ["u_s1", "u_s2", "u_s3", "u_s4", "u_s5"];

  // ---------- leads (50) ----------
  const statusPlan: [string, number][] = [["New", 12], ["Contacted", 9], ["Interested", 7], ["Qualified", 6], ["Proposal", 4], ["Negotiation", 3], ["Converted", 6], ["Lost", 3]];
  const leads: Lead[] = [];
  for (const [status, count] of statusPlan) {
    for (let k = 0; k < count; k++) {
      const closed = status === "Converted" || status === "Lost";
      leads.push(makeLead(leads.length, status, closed && rnd() > 0.3 ? null : sales[leads.length % 5], ri(closed ? 30 : 0, 89)));
    }
  }
  leads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ---------- companies / customers / contacts ----------
  const companyDefs = [
    ["Sharma Textiles", "Surat", "Manufacturing"], ["Patel Ceramics", "Morbi", "Manufacturing"],
    ["Deshpande Engineering", "Pune", "Manufacturing"], ["Krishna Interiors", "Mumbai", "Interior Design"],
    ["Veda Wellness Clinics", "Bengaluru", "Healthcare"], ["Sunrise EduTech", "Hyderabad", "Education"],
    ["Malwa Agro Foods", "Indore", "Manufacturing"], ["BlueLotus Realty", "Nagpur", "Real Estate"],
    ["Zenith Fitness Club", "Pune", "Fitness"], ["Coastal Marine Logistics", "Kochi", "Logistics"],
  ] as const;
  const companies: DB["companies"] = companyDefs.map(([name, city, ind]) => ({
    id: uid(), name, industry: ind, website: `www.${slug(name)}.in`, phone: phone(),
    email: `hello@${slug(name)}.in`, city, state: "India", address: `${ri(5, 200)}, Industrial Area, ${city}`,
    gstin: `27${ri(1000000000, 9999999999)}A1Z${ri(1, 9)}`, notes: "", createdAt: isoAt(-ri(60, 200)),
  }));
  const customers: Customer[] = Array.from({ length: 20 }, (_, i) => {
    const co = companies[i % companies.length];
    const fn = pick(FIRST), ln = pick(LAST);
    return {
      id: uid(), name: `${fn} ${ln}`, company: co.name, phone: phone(), email: `${slug(fn)}@${slug(co.name)}.in`,
      whatsapp: phone(), gstin: co.gstin, pan: `A${pick(LAST).slice(0, 3).toUpperCase()}${ri(1000, 9999)}${pick(["B", "C", "D", "F", "G"])}`,
      billingAddress: co.address, shippingAddress: co.address, city: co.city, state: "India", country: "India",
      managerId: sales[i % 5], status: i % 7 === 6 ? "On Hold" : "Active", notes: "", createdAt: isoAt(-ri(10, 160)),
    };
  });
  const contacts: DB["contacts"] = Array.from({ length: 20 }, (_, i) => ({
    id: uid(), name: `${pick(FIRST)} ${pick(LAST)}`, title: pick(["Owner", "Director", "Purchase Manager", "Marketing Head", "CEO", "Operations Head"]),
    companyId: companies[i % companies.length].id, phone: phone(), email: `${slug(pick(FIRST))}@${slug(companies[i % companies.length].name)}.in`,
    whatsapp: phone(), city: companies[i % companies.length].city, notes: "", createdAt: isoAt(-ri(5, 90)),
  }));

  // ---------- stages & deals ----------
  const dealStages: DB["dealStages"] = [
    { id: "s_new", name: "New", order: 1, kind: "open" }, { id: "s_contact", name: "Contacted", order: 2, kind: "open" },
    { id: "s_interest", name: "Interested", order: 3, kind: "open" }, { id: "s_qual", name: "Qualified", order: 4, kind: "open" },
    { id: "s_prop", name: "Proposal", order: 5, kind: "open" }, { id: "s_nego", name: "Negotiation", order: 6, kind: "open" },
    { id: "s_won", name: "Won", order: 7, kind: "won" }, { id: "s_lost", name: "Lost", order: 8, kind: "lost" },
  ];
  const stagePlan = ["s_new", "s_new", "s_new", "s_contact", "s_contact", "s_contact", "s_interest", "s_interest", "s_qual", "s_qual", "s_qual", "s_prop", "s_prop", "s_nego", "s_nego", "s_won", "s_won", "s_won", "s_won", "s_lost"];
  const dealTitles = ["Website revamp", "CRM implementation", "SEO annual plan", "App development", "Digital marketing retainer", "E-commerce store", "Maintenance contract", "Custom billing software", "Landing pages", "Brand + website bundle"];
  const deals: Deal[] = stagePlan.map((stageId, i) => {
    const won = stageId === "s_won", lost = stageId === "s_lost";
    const closedDaysAgo = won ? ri(5, 70) : lost ? ri(5, 50) : 0;
    return {
      id: uid(), title: `${pick(dealTitles)} — ${customers[i % customers.length].company}`,
      customerId: customers[i % customers.length].id, stageId,
      value: pick([25000, 60000, 120000, 150000, 200000, 300000, 400000]),
      expectedClose: isoDay(won || lost ? -closedDaysAgo : ri(3, 45)),
      ownerId: sales[i % 5], priority: pick(["Medium", "High", "High", "Urgent"] as Priority[]),
      notes: "", createdAt: isoAt(-ri(10, 80)), closedAt: won || lost ? isoAt(-closedDaysAgo) : undefined,
    };
  });

  // ---------- followups / tasks / meetings / calls ----------
  const fuTypes: FUType[] = ["Call", "WhatsApp", "Email", "Meeting", "Demo", "Proposal"];
  const openLeads = leads.filter((l) => l.assigneeId && !["Converted", "Lost"].includes(l.status));
  const followups: FollowUp[] = [];
  const fuPlan: [number, "Scheduled" | "Completed" | "Missed"][] = [
    [0, "Scheduled"], [0, "Scheduled"], [0, "Scheduled"], [0, "Completed"],
    [-1, "Missed"], [-2, "Missed"], [-3, "Missed"], [1, "Scheduled"], [1, "Scheduled"],
    [2, "Scheduled"], [3, "Scheduled"], [4, "Scheduled"], [6, "Scheduled"],
    [-4, "Completed"], [-6, "Completed"], [-8, "Completed"], [8, "Scheduled"], [10, "Scheduled"],
  ];
  fuPlan.forEach(([off, status], i) => {
    const lead = openLeads[i % openLeads.length];
    followups.push({
      id: uid(), entityType: "lead", entityId: lead.id, employeeId: lead.assigneeId || "u_s1",
      type: fuTypes[i % fuTypes.length], date: isoDay(off), time: `${String(ri(10, 17)).padStart(2, "0")}:${pick(["00", "15", "30", "45"])}`,
      reminder: true, status, notes: status === "Completed" ? "Spoke to owner, shared brochure." : status === "Missed" ? "Could not connect." : "",
      outcome: status === "Completed" ? pick(["Interested", "Callback requested", "Sent pricing"]) : "",
      createdAt: isoAt(off - 2), completedAt: status === "Completed" ? isoAt(off, 12) : undefined,
    });
  });
  const tasks: Task[] = Array.from({ length: 12 }, (_, i) => ({
    id: uid(), title: pick(["Send proposal deck", "Update lead sheet", "Prepare demo environment", "Collect GST details", "Draft quotation", "Verify payment receipt", "Site visit briefing", "Renewal discussion prep", "Competitor pricing check", "WhatsApp broadcast list"]),
    description: "", entityType: i % 3 === 0 ? "lead" : undefined, entityId: i % 3 === 0 ? openLeads[i % openLeads.length].id : undefined,
    assigneeId: sales[i % 5], priority: pick(["Low", "Medium", "High", "Urgent"] as Priority[]),
    status: i < 3 ? "Completed" : i === 3 ? "Cancelled" : i < 7 ? "In Progress" : "Pending",
    dueDate: isoDay(ri(-3, 9)), createdBy: "u_mgr", createdAt: isoAt(-ri(1, 20)),
  }));
  const meetings: Meeting[] = Array.from({ length: 6 }, (_, i) => ({
    id: uid(), title: pick(["Product demo — CRM", "Requirement workshop", "Negotiation call", "Onboarding kickoff", "Quarterly review", "Proposal walkthrough"]),
    entityType: "customer", entityId: customers[(i * 3) % customers.length].id,
    employeeIds: [sales[i % 5], "u_mgr"], date: isoDay(i < 2 ? 0 : i * 2 - 1),
    start: `${String(ri(10, 15)).padStart(2, "0")}:00`, end: `${String(ri(16, 18)).padStart(2, "0")}:00`,
    location: i % 2 ? "Google Meet" : "Client office", link: i % 2 ? "https://meet.google.com/sutra-demo" : "",
    agenda: "Understand requirements, present pricing, agree next steps.", notes: "", outcome: i === 0 ? "" : "Positive — follow-up sent.",
    createdAt: isoAt(-ri(1, 10)),
  }));
  const outcomes: CallOutcome[] = ["Connected", "No Answer", "Interested", "Busy", "Callback", "Not Interested", "Connected", "Interested"];
  const calls: CallLog[] = Array.from({ length: 10 }, (_, i) => ({
    id: uid(), entityType: "lead", entityId: openLeads[i % openLeads.length].id, employeeId: sales[i % 5],
    direction: i % 4 === 3 ? "Incoming" : "Outgoing", outcome: outcomes[i % outcomes.length],
    notes: i % 3 === 0 ? "Owner asked for pricing on WhatsApp." : "", durationMin: ri(1, 24), createdAt: isoAt(-ri(0, 12), ri(10, 18)),
  }));

  // ---------- products ----------
  const products: DB["products"] = [
    { id: "p1", name: "Website Development", sku: "WD-01", category: "Development", description: "Responsive business website, up to 8 pages, CMS + SEO basics", unit: "project", price: 25000, gstPct: 18, active: true },
    { id: "p2", name: "CRM Development", sku: "CRM-01", category: "Development", description: "Custom CRM with leads, pipeline, invoicing and reports", unit: "project", price: 150000, gstPct: 18, active: true },
    { id: "p3", name: "Digital Marketing (Monthly)", sku: "DM-01", category: "Marketing", description: "Social + search campaigns, monthly reporting", unit: "month", price: 15000, gstPct: 18, active: true },
    { id: "p4", name: "SEO Package", sku: "SEO-01", category: "Marketing", description: "On-page + local SEO, 20 keywords", unit: "month", price: 12000, gstPct: 18, active: true },
    { id: "p5", name: "Mobile App Development", sku: "MA-01", category: "Development", description: "Android + iOS hybrid app with admin panel", unit: "project", price: 200000, gstPct: 18, active: true },
    { id: "p6", name: "Custom Software Development", sku: "SD-01", category: "Development", description: "Bespoke business software, per sprint", unit: "sprint", price: 300000, gstPct: 18, active: true },
    { id: "p7", name: "Annual Maintenance", sku: "AM-01", category: "Support", description: "Bug fixes, updates, uptime monitoring", unit: "year", price: 24000, gstPct: 18, active: true },
    { id: "p8", name: "E-commerce Store", sku: "EC-01", category: "Development", description: "Online store with payment gateway and inventory", unit: "project", price: 60000, gstPct: 18, active: true },
  ];

  // ---------- quotations / invoices / payments / expenses ----------
  const mkItems = (defs: [string, number, number][]): DocItem[] =>
    defs.map(([pid, qty, disc]) => {
      const p = products.find((x) => x.sku === pid)!;
      return { id: uid(), name: p.name, productId: p.id, qty, rate: p.price, discountPct: disc, gstPct: p.gstPct };
    });
  const quotations: Quotation[] = [
    { id: uid(), number: "QT-2026-014", customerId: customers[0].id, date: isoDay(-2), validUntil: isoDay(13), items: mkItems([["WD-01", 1, 5], ["AM-01", 1, 0]]), discountPct: 0, status: "Sent", terms: "50% advance, balance on delivery. Valid 15 days.", notes: "", createdBy: "u_s1", createdAt: isoAt(-2) },
    { id: uid(), number: "QT-2026-013", customerId: customers[1].id, date: isoDay(-6), validUntil: isoDay(9), items: mkItems([["CRM-01", 1, 8]]), discountPct: 2, status: "Accepted", terms: "Milestones: 40/40/20.", notes: "Wants GST invoice monthly.", createdBy: "u_s2", createdAt: isoAt(-6) },
    { id: uid(), number: "QT-2026-012", customerId: customers[2].id, date: isoDay(-9), validUntil: isoDay(6), items: mkItems([["DM-01", 3, 0], ["SEO-01", 3, 10]]), discountPct: 0, status: "Sent", terms: "Monthly billing.", notes: "", createdBy: "u_s3", createdAt: isoAt(-9) },
    { id: uid(), number: "QT-2026-011", customerId: customers[3].id, date: isoDay(-15), validUntil: isoDay(0), items: mkItems([["EC-01", 1, 5]]), discountPct: 0, status: "Expired", terms: "", notes: "", createdBy: "u_s4", createdAt: isoAt(-15) },
    { id: uid(), number: "QT-2026-010", customerId: customers[4].id, date: isoDay(-20), validUntil: isoDay(-5), items: mkItems([["MA-01", 1, 0]]), discountPct: 5, status: "Rejected", terms: "", notes: "Budget constraints this quarter.", createdBy: "u_s5", createdAt: isoAt(-20) },
    { id: uid(), number: "QT-2026-015", customerId: customers[5].id, date: isoDay(0), validUntil: isoDay(15), items: mkItems([["SD-01", 1, 0], ["AM-01", 1, 0]]), discountPct: 0, status: "Draft", terms: "", notes: "", createdBy: "u_admin", createdAt: isoAt(0, 9) },
  ];
  const invoices: Invoice[] = [
    { id: "i1", number: "INV-2026-031", customerId: customers[1].id, date: isoDay(-4), dueDate: isoDay(11), items: mkItems([["CRM-01", 1, 8]]), discountPct: 2, status: "Sent", notes: "", quotationId: quotations[1].id, createdBy: "u_acct", createdAt: isoAt(-4) },
    { id: "i2", number: "INV-2026-030", customerId: customers[6].id, date: isoDay(-25), dueDate: isoDay(-5), items: mkItems([["WD-01", 1, 0], ["SEO-01", 2, 0]]), discountPct: 0, status: "Overdue", notes: "", createdBy: "u_acct", createdAt: isoAt(-25) },
    { id: "i3", number: "INV-2026-029", customerId: customers[7].id, date: isoDay(-32), dueDate: isoDay(-12), items: mkItems([["DM-01", 2, 0]]), discountPct: 0, status: "Partially Paid", notes: "", createdBy: "u_acct", createdAt: isoAt(-32) },
    { id: "i4", number: "INV-2026-028", customerId: customers[8].id, date: isoDay(-45), dueDate: isoDay(-25), items: mkItems([["EC-01", 1, 5]]), discountPct: 0, status: "Paid", notes: "", createdBy: "u_acct", createdAt: isoAt(-45) },
    { id: "i5", number: "INV-2026-027", customerId: customers[9].id, date: isoDay(-58), dueDate: isoDay(-38), items: mkItems([["MA-01", 1, 0]]), discountPct: 5, status: "Paid", notes: "", createdBy: "u_acct", createdAt: isoAt(-58) },
    { id: "i6", number: "INV-2026-032", customerId: customers[10].id, date: isoDay(0), dueDate: isoDay(15), items: mkItems([["AM-01", 1, 0]]), discountPct: 0, status: "Draft", notes: "", createdBy: "u_acct", createdAt: isoAt(0, 10) },
  ];
  const payments: Payment[] = [
    { id: uid(), invoiceId: "i3", customerId: customers[7].id, amount: 15000, date: isoDay(-15), mode: "UPI", txnId: "UPI-88213", notes: "Part 1", recordedBy: "u_acct", createdAt: isoAt(-15) },
    { id: uid(), invoiceId: "i4", customerId: customers[8].id, amount: 35000, date: isoDay(-40), mode: "Bank Transfer", txnId: "NEFT-5512", notes: "", recordedBy: "u_acct", createdAt: isoAt(-40) },
    { id: uid(), invoiceId: "i4", customerId: customers[8].id, amount: 24100, date: isoDay(-27), mode: "UPI", txnId: "UPI-90917", notes: "Balance", recordedBy: "u_acct", createdAt: isoAt(-27) },
    { id: uid(), invoiceId: "i5", customerId: customers[9].id, amount: 118000, date: isoDay(-50), mode: "Bank Transfer", txnId: "RTGS-1102", notes: "Advance 60%", recordedBy: "u_acct", createdAt: isoAt(-50) },
    { id: uid(), invoiceId: "i5", customerId: customers[9].id, amount: 79060, date: isoDay(-38), mode: "Cheque", txnId: "CHQ-00417", notes: "Balance", recordedBy: "u_acct", createdAt: isoAt(-38) },
  ];
  const expenses: Expense[] = [
    { id: uid(), category: "Office Rent", vendor: "Panchshil Properties", amount: 32000, date: isoDay(-3), notes: "September rent", recordedBy: "u_acct", createdAt: isoAt(-3) },
    { id: uid(), category: "Advertising", vendor: "Google Ads", amount: 18500, date: isoDay(-8), notes: "Lead campaigns", recordedBy: "u_mkt", createdAt: isoAt(-8) },
    { id: uid(), category: "Software", vendor: "AWS", amount: 7400, date: isoDay(-12), notes: "", recordedBy: "u_acct", createdAt: isoAt(-12) },
    { id: uid(), category: "Travel", vendor: "IRCTC / Uber", amount: 5300, date: isoDay(-16), notes: "Mumbai client visits", recordedBy: "u_s2", createdAt: isoAt(-16) },
    { id: uid(), category: "Salaries", vendor: "Payroll", amount: 240000, date: isoDay(-30), notes: "August payroll", recordedBy: "u_acct", createdAt: isoAt(-30) },
    { id: uid(), category: "Software", vendor: "Figma", amount: 3600, date: isoDay(-21), notes: "", recordedBy: "u_acct", createdAt: isoAt(-21) },
  ];

  // ---------- activity / notices / audit ----------
  const activities: Activity[] = [];
  const act = (entityType: string, entityId: string, userId: string, action: string, detail: string, daysAgo: number, h = 11) =>
    activities.push({ id: uid(), entityType, entityId, userId, action, detail, at: isoAt(-daysAgo, h, ri(0, 59)) });
  leads.slice(0, 12).forEach((l, i) => { act("lead", l.id, l.assigneeId || "u_mgr", "Lead created", `Source: ${l.source}`, ri(1, 60), ri(9, 18)); if (i % 2) act("lead", l.id, "u_mgr", "Lead assigned", `Assigned to ${users.find((u) => u.id === l.assigneeId)?.name || "team"}`, ri(0, 55)); });
  deals.slice(0, 6).forEach((d) => act("deal", d.id, d.ownerId || "u_mgr", "Deal moved", `Moved to ${dealStages.find((s) => s.id === d.stageId)?.name}`, ri(0, 20)));
  payments.forEach((p) => act("invoice", p.invoiceId, "u_acct", "Payment received", `₹${p.amount.toLocaleString("en-IN")} via ${p.mode}`, ri(0, 30)));
  activities.sort((a, b) => b.at.localeCompare(a.at));

  const notices: Notice[] = [
    { id: uid(), userId: "u_mgr", title: "3 follow-ups overdue", body: "Missed follow-ups need rescheduling.", read: false, at: isoAt(0, 9, 5), link: "/followups", kind: "followup" },
    { id: uid(), userId: "u_admin", title: "Invoice INV-2026-030 is overdue", body: "Balance outstanding beyond due date.", read: false, at: isoAt(0, 8, 30), link: "/invoices", kind: "invoice" },
    { id: uid(), userId: "u_s1", title: "New lead assigned", body: "A new lead was assigned to you.", read: false, at: isoAt(-1, 17), link: "/leads", kind: "lead" },
    { id: uid(), userId: "u_s2", title: "Hot lead found", body: "Lead scored above 80 — act within 4 hours.", read: false, at: isoAt(-1, 12), link: "/leads", kind: "ai" },
    { id: uid(), userId: "u_acct", title: "Payment recorded", body: "₹24,100 received against INV-2026-028.", read: true, at: isoAt(-27, 15), link: "/invoices", kind: "invoice" },
    { id: uid(), userId: "u_mgr", title: "Quotation QT-2026-013 accepted", body: "Convert to invoice when ready.", read: true, at: isoAt(-5, 11), link: "/quotations", kind: "quote" },
    { id: uid(), userId: "u_admin", title: "Weekly pipeline digest", body: "Pipeline value updated across 6 open stages.", read: true, at: isoAt(-3, 9), link: "/pipeline", kind: "system" },
  ];
  const auditLogs: DB["auditLogs"] = [
    { id: uid(), userId: "u_admin", userName: "Kautuk Ade", action: "Login", target: "auth", detail: "Successful login", at: isoAt(0, 9, 2) },
    { id: uid(), userId: "u_adm2", userName: "Kavya Nair", action: "Permission Changed", target: "role:r_sales", detail: "Added export on reports", at: isoAt(-2, 16) },
    { id: uid(), userId: "u_admin", userName: "Kautuk Ade", action: "User Created", target: "user:farhan", detail: "Created Farhan Khan (Marketing)", at: isoAt(-9, 12) },
    { id: uid(), userId: "u_acct", userName: "Neha Joshi", action: "Invoice Modified", target: "INV-2026-030", detail: "Updated due date", at: isoAt(-6, 14) },
    { id: uid(), userId: "u_mgr", userName: "Rohit Bansal", action: "Lead Deleted", target: "lead", detail: "Removed spam lead 'Test Corp'", at: isoAt(-11, 10) },
  ];

  // ---------- automation rules ----------
  const rules: DB["rules"] = [
    { id: uid(), name: "Hot leads — priority + manager alert", trigger: "lead.scored", condField: "score", condOp: "gte", condValue: "80", actions: [{ type: "set_priority", value: "High" }, { type: "notify", value: "managers" }, { type: "followup", value: "4", hours: 4, fuType: "Call" }], enabled: true },
    { id: uid(), name: "First touch after assignment", trigger: "lead.assigned", condField: "", condOp: "eq", condValue: "", actions: [{ type: "followup", value: "24", hours: 24, fuType: "Call" }], enabled: true },
    { id: uid(), name: "Software leads → Pune team", trigger: "lead.created", condField: "category", condOp: "contains", condValue: "Software", actions: [{ type: "assign_team", value: "t_pune" }], enabled: true },
    { id: uid(), name: "Quotation sent → 2-day follow-up", trigger: "quote.sent", condField: "", condOp: "eq", condValue: "", actions: [{ type: "followup", value: "48", hours: 48, fuType: "WhatsApp" }], enabled: true },
    { id: uid(), name: "Overdue invoice → notify accountant", trigger: "invoice.overdue", condField: "", condOp: "eq", condValue: "", actions: [{ type: "notify", value: "u_acct" }], enabled: true },
  ];
  const ruleRuns: DB["ruleRuns"] = [
    { id: uid(), ruleId: rules[1].id, ruleName: rules[1].name, summary: "Created Call follow-up for newly assigned lead", at: isoAt(-1, 11, 2) },
    { id: uid(), ruleId: rules[3].id, ruleName: rules[3].name, summary: "QT-2026-014 sent → WhatsApp follow-up in 48h", at: isoAt(-2, 10, 20) },
  ];

  // ---------- templates ----------
  const templates: DB["templates"] = [
    { id: uid(), channel: "whatsapp", name: "Introduction", subject: "", body: "Hello {{customer_name}},\n\nI am {{employee_name}} from {{company_name}}. Thank you for your interest in our services.\n\nWould you be available for a quick discussion this week?" },
    { id: uid(), channel: "whatsapp", name: "Follow-up", subject: "", body: "Hi {{customer_name}}, this is {{employee_name}} from {{company_name}}. Just following up on our last conversation — do you have any questions I can help with?" },
    { id: uid(), channel: "whatsapp", name: "Quotation Reminder", subject: "", body: "Hello {{customer_name}}, gentle reminder that quotation {{quotation_number}} from {{company_name}} is valid until the date mentioned. Happy to walk you through it. — {{employee_name}}" },
    { id: uid(), channel: "whatsapp", name: "Meeting Reminder", subject: "", body: "Hi {{customer_name}}, reminder: our meeting is scheduled shortly. Looking forward to it! — {{employee_name}}, {{company_name}}" },
    { id: uid(), channel: "whatsapp", name: "Payment Reminder", subject: "", body: "Hello {{customer_name}}, invoice {{invoice_number}} has an outstanding balance of {{amount_due}}. Kindly arrange the payment at the earliest. Thank you — {{company_name}}" },
    { id: uid(), channel: "whatsapp", name: "Thank You", subject: "", body: "Thank you {{customer_name}}! It was great working with you. — {{employee_name}}, {{company_name}}" },
    { id: uid(), channel: "email", name: "Introduction", subject: "Introduction — {{company_name}}", body: "Hello {{customer_name}},\n\nI am {{employee_name}} from {{company_name}}. We help businesses like yours with websites, CRM and digital growth.\n\nCould we schedule a 15-minute call?\n\nRegards,\n{{employee_name}}" },
    { id: uid(), channel: "email", name: "Quotation", subject: "Quotation {{quotation_number}} — {{company_name}}", body: "Hello {{customer_name}},\n\nPlease find our quotation {{quotation_number}} attached. It is valid as per the terms mentioned.\n\nRegards,\n{{employee_name}}\n{{company_name}}" },
    { id: uid(), channel: "email", name: "Invoice", subject: "Invoice {{invoice_number}} — {{company_name}}", body: "Hello {{customer_name}},\n\nInvoice {{invoice_number}} ({{amount_due}}) is attached. Kindly process the payment by the due date.\n\nRegards,\n{{company_name}}" },
    { id: uid(), channel: "email", name: "Payment Reminder", subject: "Payment reminder — {{invoice_number}}", body: "Hello {{customer_name}},\n\nThis is a gentle reminder that invoice {{invoice_number}} has a balance of {{amount_due}} past its due date.\n\nRegards,\n{{company_name}}" },
  ];

  return {
    v: 1,
    users, roles, teams,
    leads, leadSources: [...SOURCES], leadStatuses: ["New", "Contacted", "Interested", "Qualified", "Proposal", "Negotiation", "Converted", "Lost"],
    discoveryJobs: [
      { id: uid(), createdBy: "u_mkt", category: "Digital Marketing Agency", location: "Pune, Maharashtra", target: 40, source: "maps", keywords: "digital marketing", status: "Completed", discovered: 34, valid: 29, duplicates: 3, invalid: 2, failedRecords: 0, startedAt: isoAt(-4, 10), completedAt: isoAt(-4, 10, 24), error: "", attempts: 0, retryLog: [] },
      { id: uid(), createdBy: "u_mkt", category: "Interior Design", location: "Mumbai, Maharashtra", target: 25, source: "directory", keywords: "interior designers", status: "Partially Completed", discovered: 18, valid: 15, duplicates: 2, invalid: 1, failedRecords: 0, startedAt: isoAt(-2, 15), completedAt: isoAt(-2, 15, 12), error: "Source exhausted after page 4 (rate limit respected).", attempts: 3, retryLog: ["Attempt 2: HTTP 429 — paused 60s", "Attempt 3: resumed, source exhausted"] },
    ],
    customers, companies, contacts, deals, dealStages,
    followups, calls, meetings, tasks, notes: [],
    products, quotations, invoices, payments, expenses,
    activities, notices, auditLogs,
    rules, ruleRuns, templates, aiLogs: [],
    settings: {
      company: { name: "IT CYBER TECHNOLOGIES PVT LTD", tagline: "IT Services · Cyber Security · Digital Solutions", email: "hello@itctcrm.in", phone: "+91 98220 44551", website: "www.itctcrm.in", address: "4th Floor, Trade Centre, FC Road, Pune, MH 411005", gstin: "27AAACN4429F1Z5", pan: "AAACN4429F", currency: "INR", timezone: "Asia/Kolkata", logoMark: "I" },
      ai: { url: "http://localhost:11434", model: "qwen3", temperature: 0.4, timeoutSec: 30 },
      scoring: { phone: 10, email: 10, website: 10, location: 10, industry: 15, rating: 5, engagement: 20, targetLocations: ["Pune", "Mumbai", "Bengaluru", "Hyderabad"], targetIndustries: ["Software", "Digital Marketing", "E-commerce", "Manufacturing", "Real Estate"] },
      assignment: { strategy: "round_robin", rrPointer: 0, highValueThreshold: 100000, highValueUserId: "u_s5", categoryMap: { "Software Company": "u_s1" }, locationMap: { Pune: "u_s1", Mumbai: "u_s2" } },
    },
  };
}

export { isoDay, isoAt };
