# ITCT-CRM — IT CYBER TECHNOLOGIES PVT LTD

A complete, production-grade CRM covering the full business lifecycle:

**Lead Discovery → Import → AI/Rules Qualification → Assignment → Follow-up → Pipeline →
Conversion → Quotation → Invoice → Payment → Reports & Analytics**

Stack: **React + Vite + TypeScript + Tailwind** frontend · **Node.js + Express + PostgreSQL** backend ·
JWT auth with refresh rotation · role-based access control with record ownership · optional Ollama AI.

> Production credentials are never stored in this repository.

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
npm run seed                    :: creates tables + first admin only when DB is empty
npm start                       :: http://localhost:8000
```
Verify:
- http://localhost:8000/api/health → `{"status":"ok","database":"connected","version":"2.0.0"}`
- Backend tests: `npm test` (units run anywhere; set `TEST_DATABASE_URL` for integration tests)

### Terminal 2 — Frontend
```cmd
npm install                     :: from the repository root
copy .env.example .env          :: VITE_API_URL=http://localhost:8000/api
npm run dev                     :: http://localhost:3000
```

The top-right pill shows **Backend · PostgreSQL** (green) when connected. If the backend is
unreachable the app shows a **“CRM server is unavailable”** screen with Retry — it never silently
writes business data to the browser. PostgreSQL is the only business-data source. The frontend
automatically re-syncs from the backend every 60 seconds and whenever the tab regains focus.

## Authentication

Production accounts are created and managed in PostgreSQL. For a brand-new empty database,
set `BOOTSTRAP_ADMIN_EMAIL` and a strong `BOOTSTRAP_ADMIN_PASSWORD` in the backend environment,
run `npm run seed` once, then remove/rotate the bootstrap password variable. The first bootstrap
account is forced to change its password on first login. Never put real credentials in source control.

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
| Customers / Companies / Contacts, Follow-ups, Tasks, Meetings, Quotations, Invoices, Payments, Expenses, Products, Discovery jobs, Reports, Users/Roles/Teams, Automation, Audit, Settings | ✅ PostgreSQL-backed; auto re-sync every 60 seconds + on tab focus; backend remains source of truth |

All money math (GST, discounts, paid/balance, invoice status) is authoritative on the backend.

## Repository layout

```
├── src/                  React frontend (pages, components, store, API client, mappers)
│   ├── lib/api.ts        Axios instance, JWT + refresh-queue interceptor, typed API clients
│   ├── lib/apiTypes.ts   snake_case API contracts
│   ├── lib/mappers.ts    central API ↔ UI mapping (integer IDs ⇄ UI IDs)
│   ├── lib/hydrate.ts    loads every PostgreSQL collection into the UI store after login
│   └── lib/db.ts         in-memory UI cache; production business data is never persisted in browser storage
├── backend/              Node.js + Express + PostgreSQL API
│   ├── src/server.js     app, CORS, health (503 semantics), error handling
│   ├── src/db.js         pg pool + full schema (idempotent auto-migrate)
│   ├── src/security.js   bcrypt, JWT, refresh hashing, RBAC, ownership helpers
│   ├── src/engines.js    automation rules + Ollama client with rules-engine fallback
│   ├── src/routes/       auth · crm · billing · admin
│   ├── src/seed.js       schema/bootstrap admin setup only; no business demo data
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
- **Frontend** — set `VITE_API_URL=https://YOUR-API/api`, build with `npm run build`, and run `npm start`.
  The included production server adds CSP, HSTS, anti-framing, no-sniff, referrer and permissions headers.
- **Backend** — set `NODE_ENV=production`, managed `DATABASE_URL`, a unique random `JWT_SECRET` of at least
  48 characters, and explicit HTTPS `CORS_ORIGINS`. Production startup fails closed if these are unsafe.
- Move the failed-login throttle and discovery worker to Redis/queue before scaling to multiple backend replicas.

## Troubleshooting
| Symptom | Fix |
| --- | --- |
| “CRM server is unavailable” | Backend not running — `cd backend && npm start` |
| Backend exits: `cannot reach PostgreSQL` | Check `DATABASE_URL` in `backend/.env`; ensure the `itct_crm` DB exists |
| `EADDRINUSE :8000` | Another process on the port — stop it or set `PORT=8001` (+ update `VITE_API_URL`) |
| Login 429 | 5 failed attempts lock for 5 minutes (anti-brute-force) |
| CORS errors | Add your origin to `CORS_ORIGINS` in `backend/.env` |
| AI features silent | `ollama serve` running? Test via Settings → AI |
