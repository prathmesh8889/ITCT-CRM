# ITCT CRM — Backend (Node.js + Express + PostgreSQL)

Real server-side CRM API: JWT auth with refresh rotation, RBAC, record ownership,
server-side pagination, automation engine, optional Ollama AI. **No Python.**

## Windows setup — exact commands

```cmd
:: 0. Create the database once (pgAdmin → Query Tool, or psql):
::    CREATE DATABASE itct_crm;

cd backend
npm install

copy .env.example .env
:: edit .env → set your Postgres password in DATABASE_URL and a long JWT_SECRET

npm run seed        :: creates tables + demo data (also done automatically on start)
npm start           :: http://localhost:8000
```

- Health: http://localhost:8000/api/health → `{"status":"ok","database":"connected"}` (503 if DB is down)
- Dev mode with auto-restart: `npm run dev`
- Tests: `npm test` (units run without Postgres; set `TEST_DATABASE_URL` for integration tests)

## Demo login

| Role | Email | Password |
| --- | --- | --- |
| Super Admin (owner — Kautuk Ade) | `admin@crm.local` | `Admin@123` |
| Sales Manager | `rohit@itctcrm.in` | `Admin@123` |
| Sales Executives | `rahul@itctcrm.in` (+ priya/amit/sneha/vikram) | `Sales@123` |
| Accountant | `neha@itctcrm.in` | `Sales@123` |

**Change the admin password in production.**

## API surface (matches the React frontend exactly)

```
POST /api/auth/login · /refresh (rotation + reuse detection) · /logout · /change-password
GET  /api/auth/me                      → { user, role, perms, is_super }

GET  /api/leads  (page, page_size, search, status, source, priority, city, owner, sort_by, sort_order)
POST /api/leads · GET/PATCH/DELETE /api/leads/:id (PATCH is partial, ownership-checked)
POST /api/leads/:id/assign · /score (Ollama or rules fallback) · /convert · /notes
GET  /api/leads/duplicates · /export (CSV) · POST /api/leads/import (multipart CSV + mapping)

GET/POST /api/customers · GET/PATCH/DELETE /api/customers/:id
GET/POST /api/companies · /api/contacts          (paged)
GET  /api/deals/stages · /api/deals (paged) · PATCH /api/deals/:id · /api/deals/:id/stage
GET/POST /api/followups · PATCH /api/followups/:id (complete → smart chaining via next_in_days)
GET/POST /api/tasks · PATCH /api/tasks/:id · GET/POST /api/meetings · POST /api/calls
POST /api/discovery/jobs · GET /api/discovery/jobs(/:id) · POST .../pause|resume|cancel

GET/POST /api/products · PATCH /api/products/:id
GET/POST /api/quotations · PATCH /api/quotations/:id · POST /api/quotations/:id/convert-to-invoice
GET/POST /api/invoices · PATCH /api/invoices/:id · POST /api/invoices/:id/payments (validates ≤ balance)
GET  /api/payments · /api/expenses · POST/GET /api/attachments (upload validated: type + size)

GET/POST /api/users · PATCH/DELETE /api/users/:id · GET /api/roles · PUT /api/roles/:id/permissions
GET/POST /api/teams · GET/POST/PATCH /api/automation/rules · GET /api/automation/executions
GET  /api/audit-logs (paged) · GET/PUT /api/settings
GET  /api/notifications · /notifications/unread · PATCH /notifications/:id/read · POST /notifications/read-all
GET  /api/dashboard · /dashboard/hot-leads · /dashboard/agenda · /dashboard/activity
GET  /api/reports/leads · /sales · /payments · /performance
GET  /api/search?q=...
POST /api/ai/test · /ai/lead-summary · /ai/next-action · /ai/ask
```

## Design notes

- **Money is authoritative here** — GST/discount/totals and paid/balance/status are always recomputed server-side (`src/routes/billing.js`).
- **Ownership** — Sales Executives can only touch their own leads/deals/tasks/followups/customers; every direct `:id` endpoint goes through `ensure*()` in `src/security.js` (403 otherwise). Managers/Admins are wide.
- **Record codes** (`LD-…`, `QT-…`, `INV-…`, `PAY-…`, `CU-…`) are date-stamped + random and uniqueness-checked — never `count()+1`.
- **Refresh tokens** are stored **hashed (SHA-256)**; rotation on every refresh; reuse of a revoked token revokes the whole session family.
- **Failed-login throttle** is keyed by normalized email + IP with stale-entry cleanup (in-memory; move to Redis for multi-instance production).
- **Discovery jobs** persist in PostgreSQL; an in-process worker advances Running jobs and inserts real, deduped leads. For scale, move the worker to a queue (BullMQ/Celery-style) — the routes already treat it as a background service.
- **Ollama is optional** — every AI endpoint falls back to the deterministic rules engine and reports `"AI temporarily unavailable."` instead of failing.
- **Migrations** — schema is applied idempotently (`CREATE TABLE IF NOT EXISTS`) on boot via `AUTO_MIGRATE=true`. For evolving production schemas, layer a migration tool (e.g. `node-pg-migrate`) on top; the DDL lives in `src/db.js`.

## Structure

```
backend/
  package.json · .env.example · README.md
  src/
    server.js        Express app, CORS, health (503 semantics), error handler, boot
    core.js          config, HttpError, money/GST math, codes, normalisation, CSV
    db.js            pg pool + full PostgreSQL schema (auto-migrate)
    security.js      bcrypt, JWT, refresh hashing, RBAC middleware, ownership helpers
    engines.js       automation rules + Ollama client with rules-engine fallback
    seed.js          demo data (50 leads, 20 deals, invoices, payments, rules…)
    routes/auth.js   login (throttled) · refresh rotation · logout · me · change-password
    routes/crm.js    leads · customers · companies · contacts · deals · followups ·
                     tasks · meetings · calls · discovery jobs
    routes/billing.js products · quotations · invoices · payments · expenses · uploads
    routes/admin.js  users · roles · teams · automation · audit · settings ·
                     notifications · dashboard · reports · search · AI
  tests/api.test.js  node:test suite (units + guarded integration)
```
