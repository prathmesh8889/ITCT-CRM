# ITCT-CRM — IT CYBER TECHNOLOGIES PVT LTD

A complete, production-grade CRM covering the full business lifecycle:

**Lead Discovery → Import → AI/Rules Qualification → Assignment → Follow-up → Pipeline →
Conversion → Quotation → Invoice → Payment → Reports & Analytics**

Stack: **React + Vite + TypeScript + Tailwind** frontend · **Node.js + Express + PostgreSQL** backend ·
JWT auth with refresh rotation · role-based access control with record ownership · optional Ollama AI.

> Owner: **Kautuk Ade** · Super Admin login: `admin@crm.local` / `Admin@123` — *change in production.*

---

## Run locally (Windows, two terminals)

### 0. Prerequisites
- Node.js 18+ (same runtime powers frontend *and* backend)
- PostgreSQL 14+ running on `localhost:5432`
- (Optional) Ollama for AI features — https://ollama.com

### 1. Create the database (once)
In pgAdmin → Query Tool (or `psql`):
```sql
CREATE DATABASE itct_crm;
```

### Terminal 1 — Backend (Node.js + PostgreSQL)
```cmd
cd backend
npm install
copy .env.example .env          :: set your DB password + a long JWT_SECRET
npm run seed                    :: creates tables + demo data
npm start                       :: http://localhost:8000
```
Verify:
- http://localhost:8000/api/health → `{"status":"ok","database":"connected","version":"2.0.0"}`
- Backend tests: `npm test` (units run anywhere; set `TEST_DATABASE_URL` for integration tests)

### Terminal 2 — Frontend
```cmd
npm install                     :: from the repository root
copy .env.example .env          :: VITE_API_URL=http://localhost:8000/api  ·  VITE_DEMO_MODE=false
npm run dev                     :: http://localhost:3000
```

The top-right pill shows **Backend · PostgreSQL** (green) when connected. If the backend is
unreachable the app shows a **“CRM server is unavailable”** screen with Retry — it never silently
writes business data to the browser. An explicitly labelled *demo workspace* (browser-only) is
available from that screen or via `VITE_DEMO_MODE=true`.

## Demo logins

| Role | Email | Password |
| --- | --- | --- |
| Super Admin (Kautuk Ade) | `admin@crm.local` | `Admin@123` |
| Admin | `kavya@itctcrm.in` | `Admin@123` |
| Sales Manager | `rohit@itctcrm.in` | `Admin@123` |
| Sales Executives | `rahul@itctcrm.in` · `priya@…` · `amit@…` · `sneha@…` · `vikram@itctcrm.in` | `Sales@123` |
| Accountant | `neha@itctcrm.in` | `Sales@123` |

Sales Executives only ever see **their own** leads/deals/tasks/follow-ups/customers — enforced in
the backend (403 on direct ID access), not just hidden in the UI.

## Ollama (optional AI)
```cmd
ollama pull qwen3
ollama serve
```
Then **Settings → AI → Test connection**. If Ollama is offline the CRM keeps working — scoring and
the assistant fall back to the deterministic rules engine and report *“AI temporarily unavailable.”*

## Module wiring status

| Module | Backend integration |
| --- | --- |
| Auth (login / refresh rotation / logout / me) | ✅ full |
| Dashboard (KPIs, charts, hot leads, agenda, activity) | ✅ full — `GET /api/dashboard` + widgets |
| Leads (CRUD, server pagination/filters/sort, dedupe, import/export, assign, AI score, convert) | ✅ full |
| Pipeline (Kanban, stage moves with rollback, deal CRUD) | ✅ full — `PATCH /api/deals/:id/stage` |
| Notifications (bell, unread count, mark read) | ✅ full |
| Global search (Ctrl+K) | ✅ full — `GET /api/search` |
| Customers / Companies / Contacts, Follow-ups, Tasks, Meetings, Quotations, Invoices, Payments, Expenses, Products, Discovery jobs, Reports, Users/Roles/Teams, Automation, Audit, Settings | ✅ read-synced from PostgreSQL on login; write paths are being migrated module-by-module (backend endpoints already exist — see `backend/README.md`) |

All money math (GST, discounts, paid/balance, invoice status) is authoritative on the backend.

## Repository layout

```
├── src/                  React frontend (pages, components, store, API client, mappers)
│   ├── lib/api.ts        Axios instance, JWT + refresh-queue interceptor, typed API clients
│   ├── lib/apiTypes.ts   snake_case API contracts
│   ├── lib/mappers.ts    central API ↔ UI mapping (integer IDs ⇄ UI IDs)
│   ├── lib/hydrate.ts    loads every PostgreSQL collection into the UI store after login
│   └── lib/db.ts         embedded workspace used ONLY in labelled demo mode
├── backend/              Node.js + Express + PostgreSQL API
│   ├── src/server.js     app, CORS, health (503 semantics), error handling
│   ├── src/db.js         pg pool + full schema (idempotent auto-migrate)
│   ├── src/security.js   bcrypt, JWT, refresh hashing, RBAC, ownership helpers
│   ├── src/engines.js    automation rules + Ollama client with rules-engine fallback
│   ├── src/routes/       auth · crm · billing · admin
│   ├── src/seed.js       demo data (50 leads, 20 deals, invoices, payments…)
│   └── tests/api.test.js node:test suite
└── .github/workflows/ci.yml
```

## Push to GitHub

```cmd
git add .
git commit -m "ITCT-CRM: Node.js+PostgreSQL backend, JWT/RBAC, API-wired frontend"
git remote add origin https://github.com/prathmesh8889/ITCT-CRM.git   :: if not set
git branch -M main
git push -u origin main            :: add --force only if remote history diverges
```
Never commit `backend/.env`, `.env`, `node_modules/`, or `backend/uploads/` (all gitignored).

## Production deployment
- **Frontend** — any static host (Vercel/Netlify): set `VITE_API_URL=https://YOUR-API/api`, build with `npm run build`.
- **Backend** — Railway/Render/VPS: set `DATABASE_URL` (managed PostgreSQL), a strong `JWT_SECRET`,
  and `CORS_ORIGINS` to your frontend domain. Run `npm run seed` once, then `npm start`.
- Move the failed-login throttle and discovery worker to Redis/queue for multi-instance scale.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| “CRM server is unavailable” | Backend not running — `cd backend && npm start` |
| Backend exits: `cannot reach PostgreSQL` | Check `DATABASE_URL` in `backend/.env`; ensure the `itct_crm` DB exists |
| `EADDRINUSE :8000` | Another process on the port — stop it or set `PORT=8001` (+ update `VITE_API_URL`) |
| Login 429 | 5 failed attempts lock for 5 minutes (anti-brute-force) |
| CORS errors | Add your origin to `CORS_ORIGINS` in `backend/.env` |
| AI features silent | `ollama serve` running? Test via Settings → AI |
