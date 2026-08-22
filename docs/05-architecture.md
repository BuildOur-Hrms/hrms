# HRMS Blueprint — Application Architecture

> Document 05 of 11. Stack decisions are canonical (see `00-overview-and-roles.md` §4.3). Data shapes: `04-database.md`.

---

## 1. Architecture overview

```
┌─────────────┐   HTTPS    ┌───────────────────────────────────────────┐
│   Browser    │──────────▶│  Next.js 15 app (one deployable)          │
│ (desktop /   │           │  ├─ App Router UI (RSC + client comps)    │
│  mobile web) │           │  └─ /api/v1/* REST route handlers         │
└─────────────┘           │        │ middleware pipeline               │
                           │        ▼                                   │
                           │   src/modules/* services (domain logic)   │
                           │        │ tenant-scoped Prisma client      │
                           └────────┼───────────────┬─────────┬────────┘
                                    ▼               │         │
                             ┌────────────┐  enqueue│         │presign
                             │ PostgreSQL │         ▼         ▼
                             │  16 (RLS)  │   ┌─────────┐ ┌─────────┐
                             └────────────┘   │  Redis  │ │   S3 /  │
                                    ▲         │ BullMQ  │ │  MinIO  │
                             Prisma │         └────┬────┘ └─────────┘
                             ┌──────┴──────┐       │ consume
                             │   Worker    │◀──────┘
                             │ (Node proc) │──▶ email (Resend/Mailpit)
                             │ jobs + cron │──▶ PDF (@react-pdf/renderer)
                             └─────────────┘
```

**Modular monolith rule (canonical):** all server domain logic lives in `src/modules/<module>/`; a module's tables are touched only by its own service functions; cross-module needs call the other module's exported service (e.g., payroll calls `attendanceService.getMonthSummary()`, never queries `attendance_records` itself). This keeps Payroll/Recruitment/LMS bolt-on and extraction-ready.

---

## 2. Frontend structure

- **Route groups**: `(auth)` = public auth pages with minimal layout; `(app)` = authenticated shell (topbar + permission-driven sidebar). Route paths are the canonical list in `00-overview-and-roles.md`/CORE routes: `/dashboard`, `/me/*`, `/team/*`, `/hr/*`, `/admin/*`.
- **Layouts**: `(app)/layout.tsx` loads session + permission set server-side; sidebar sections render from a nav config filtered by permissions (never by role name).
- **Server vs client components**: pages/server components fetch initial data (direct service calls, not HTTP, where co-located); interactive islands (tables, forms, dialogs, check-in button) are client components using TanStack Query against `/api/v1`.
- **Data fetching**: TanStack Query with query keys `[module, resource, params]`; mutations invalidate the affected keys; optimistic updates only for notifications mark-read and check-in button.
- **Forms**: react-hook-form + zodResolver, sharing the same zod schemas the API validates with (`src/modules/*/validators.ts` imported both sides).
- **Error/loading conventions**: per-route `loading.tsx` (skeletons) and `error.tsx` (retry boundary); mutation outcomes via toast; API error envelope mapped to field errors (`details`) or toast (`message`).

---

## 3. Backend/API structure

Every route handler is a thin adapter:

```
handler = withApi(
  { permission: 'leave.approve', schema: approveLeaveSchema },
  async (req, ctx) => leaveService.approve(ctx, req.valid)
)
```

`withApi` pipeline (order matters):
1. **authenticate** — verify JWT session cookie → `ctx.userId`, `ctx.companyId`, `ctx.employeeId`, `ctx.permissions`, `ctx.sessionVersion` check.
2. **tenant resolve** — build tenant-scoped Prisma client; open transaction sets `SET LOCAL app.company_id` (see `04-database.md` §4.3).
3. **requirePermission** — declared permission ∈ `ctx.permissions`, else 403.
4. **zod validate** — body/query → typed `req.valid`, else 400 with `details`.
5. **service call** — domain logic in `src/modules/*`; throws typed `AppError`s mapped to the envelope.

- **Transactions** live in services (`db.$transaction`) around multi-write operations (approve leave = update request + balance + notification row + audit row atomically).
- **Domain events**: services emit in-process events (`leave.approved`, `payslip.published`) via a typed emitter; handlers enqueue BullMQ jobs (email fanout, PDF generation) and write `audit_logs`. Events keep modules decoupled: payroll doesn't import the mailer.
- **Serialization**: DTO mappers per module with field allowlists (salary/bank fields only in payroll DTOs) — never `return prismaRow` directly.

---

## 4. Authentication flow

1. HR creates employee → "invite user" → `users` row (`invited`) + `password_reset_tokens` (kind `invite`, TTL 7d) → email with link `/reset-password?token=…&kind=invite`.
2. User sets password (argon2id) → status `active` → redirected to login.
3. Login (Auth.js credentials): verify hash, check `status='active'` and `locked_until`, issue JWT (claims: userId, companyId, sessionVersion) in httpOnly Secure SameSite=Lax cookie; sliding 12h expiry (`security.session_hours`).
4. Next.js middleware guards `(app)` routes → redirect to `/login`; API returns 401.
5. Logout clears cookie; "logout everywhere" bumps `users.session_version` (JWT claim mismatch → 401).
6. Forgot/reset: same token table, kind `reset`, TTL 1h, single-use, hashed at rest.

---

## 5. File storage

- Buckets private; one bucket, keys namespaced: `{companyId}/{module}/{entityId}/{uuid}-{sanitizedFilename}`.
- **Upload**: client asks `POST /api/v1/documents/presign-upload` (permission-checked, validates mime/size against category rules) → presigned PUT URL (TTL 10 min) → client uploads → client confirms → metadata row created.
- **Download**: `GET /api/v1/documents/:id/download` re-checks object-level permission → presigned GET URL (TTL 5 min) → redirect.
- Limits: 10 MB default, 50 MB for training video files (P3); allowlist mime types per category.
- Virus-scan hook point: post-upload confirm enqueues optional `scan-file` job (no-op P1/P2, ClamAV P3).

---

## 6. Notification service

- Single `notify(event, payload)` entry in `src/modules/notifications/service.ts`.
- Resolves recipients (event-specific resolver), writes `notifications` rows (in-app, instant), enqueues `send-email` jobs per recipient if `notifications.email_enabled` and event toggle on.
- **Template registry**: one file per event key (subject/body builders for email; title/body/link for in-app) — the catalog in `07-workflows-and-automation.md` §3 is the authoritative event list.
- Push channel (P3) plugs in as another fanout target; per-user preferences table (P3) filters channels before fanout.

---

## 7. Background jobs & scheduled tasks

| Job | Trigger | Schedule (company TZ) | What it does | Phase |
|---|---|---|---|---|
| `send-email` | event | — | render template, send via mailer, retry ×5 backoff | P1 |
| `attendance-daily-calc` | cron | 00:30 daily | build/update yesterday's `attendance_records` from punches+shift+leave+holidays; mark absences; flag missing check-outs | P1 |
| `late-arrival-flags` | within daily-calc | — | compute late_minutes; notify employee + manager per toggle | P1 |
| `leave-accrual` | cron | 1st of month 01:00 | apply `leave_policies` accruals to `leave_balances`; prorate joiners | P1 |
| `leave-year-rollover` | cron | leave-year start 02:00 | carry-forward with caps; open new-year balances | P1 |
| `birthday-anniversary` | cron | 08:00 daily | notify team/HR per toggles | P1 |
| `probation-end-reminder` | cron | 08:00 daily | notify HR T-7 before `probation_end_date` | P1 |
| `payslip-generate` | event (`payroll_run.approved`) | — | render payslip PDFs, store, publish, notify | P2 |
| `document-expiry-scan` | cron | 07:00 daily | T-30/T-7/T-0 notifications; flip `expired` | P2 |
| `contract-expiry-scan` | within expiry scan | — | contract-category documents → HR notification | P2 |
| `report-export` | event | — | large exports to file, notify with link | P2 |
| `review-deadline-reminder` | cron | 08:00 daily | performance review T-7/T-1 nudges | P2 |
| `training-deadline-reminder` | cron | 08:00 daily | mandatory course due nudges | P3 |
| `daily-digest` | cron | 18:00 daily | batched summary email (opt-in) | P2 |
| `audit-retention` | cron | Sunday 03:00 | purge per retention policy | P2 |
| `scan-file` | event | — | virus scan hook | P3 |

Worker = separate Node process (`worker/index.ts`) sharing `src/modules` services via the same tenant-scoping utilities (jobs carry `companyId`; system actor for audit). Repeatable jobs registered idempotently on boot. Queue health (depth, failures) exposed at `/api/health` (see §9).

---

## 8. Integration seams (build the seam now, the integration later — P3)

- **Biometric devices**: `POST /api/v1/integrations/biometric/punches` (API-key auth per device, payload → `attendance_punches` with source `biometric`). Seam = punches table already sources-tagged.
- **Accounting**: payroll register export in a mapper interface (`toTallyCsv`, `toQuickBooksJson`). Seam = payslip/run DTOs.
- **Calendar**: leave/holiday iCal feed per user (signed URL). Seam = leave/holiday services.
- **Slack/Chat**: notification fanout target implementing the same channel interface as email.

---

## 9. Logging & error handling

- **pino** structured JSON logs; every request gets `request_id` (propagated to worker jobs); log line includes userId/companyId (never tokens/PII payloads).
- **Error taxonomy**: `AppError(code, httpStatus, message, details?)` subclasses — `ValidationError` 400, `AuthError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409, `BusinessRuleError` 422, `RateLimitError` 429. Route wrapper maps to the canonical envelope; unexpected errors log full stack, return generic 500 INTERNAL (no internals leaked).
- **Sentry** on web + worker (release-tagged); alert on new issue + job-failure spikes.
- `/api/health`: liveness (200) + readiness (DB ping, Redis ping, queue depth) for monitors.

---

## 10. Folder structure (full)

```
hrms/
├─ .github/workflows/ci.yml            # lint, typecheck, test, build, migrate, deploy
├─ docker-compose.yml                  # web, worker, postgres, redis, minio, mailpit
├─ Dockerfile                          # multi-stage: web + worker targets
├─ .env.example                        # every env var documented (10-roadmap §4)
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/                      # includes hand-written RLS/constraint SQL
│  └─ seed.ts
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/page.tsx
│  │  ├─ (auth)/forgot-password/page.tsx
│  │  ├─ (auth)/reset-password/page.tsx
│  │  ├─ (app)/layout.tsx              # shell: topbar, sidebar (permission-driven)
│  │  ├─ (app)/dashboard/page.tsx
│  │  ├─ (app)/me/{profile,attendance,leave,documents,payslips,expenses,training,performance,notifications,settings}/page.tsx
│  │  ├─ (app)/team/{page.tsx,attendance,leave-approvals,performance,reports}/
│  │  ├─ (app)/hr/{page.tsx,employees,employees/[id],departments,attendance,leave,payroll,documents,recruitment,performance,training,reports}/
│  │  ├─ (app)/admin/{company,roles,locations,settings,audit-logs}/page.tsx
│  │  └─ api/
│  │     ├─ health/route.ts
│  │     └─ v1/                        # one folder per resource; route.ts + [id]/route.ts + action routes
│  │        ├─ auth/{login,logout,forgot-password,reset-password,accept-invite,me}/route.ts
│  │        ├─ employees/…  departments/…  designations/…  locations/…
│  │        ├─ shifts/…  employee-shifts/…
│  │        ├─ attendance/{check-in,check-out,records,punches,corrections,locks}/…
│  │        ├─ leave-types/…  leave-policies/…  leave-balances/…  leave-requests/…  holidays/…
│  │        ├─ payroll/{components,structures,employee-salaries,runs,payslips}/…
│  │        ├─ documents/…  document-categories/…
│  │        ├─ job-postings/…  candidates/…  applications/…  interviews/…  offers/…
│  │        ├─ onboarding/{templates,tasks}/…  offboarding/{requests,tasks}/…
│  │        ├─ performance/{cycles,reviews,goals}/…  training/{courses,lessons,enrollments,certificates}/…
│  │        ├─ expenses/…  expense-categories/…  reimbursements/…
│  │        ├─ notifications/…  announcements/…  reports/…  audit-logs/…
│  │        └─ roles/…  permissions/…  users/…  settings/…
│  ├─ modules/                         # DOMAIN LOGIC — the heart
│  │  ├─ auth/{service.ts,validators.ts,types.ts}
│  │  ├─ employees/{service.ts,validators.ts,types.ts,dto.ts}
│  │  ├─ org/{service.ts,validators.ts}          # company, locations, departments, designations
│  │  ├─ attendance/{service.ts,calc.ts,validators.ts}   # calc.ts = pure day-computation (unit-tested hard)
│  │  ├─ shifts/{service.ts,validators.ts}
│  │  ├─ leave/{service.ts,accrual.ts,day-count.ts,validators.ts}
│  │  ├─ holidays/{service.ts,validators.ts}
│  │  ├─ payroll/{service.ts,engine.ts,validators.ts}    # engine.ts = pure calculation
│  │  ├─ documents/{service.ts,validators.ts}
│  │  ├─ recruitment/{service.ts,validators.ts}
│  │  ├─ boarding/{service.ts,validators.ts}             # on/offboarding
│  │  ├─ performance/{service.ts,validators.ts}
│  │  ├─ training/{service.ts,validators.ts}
│  │  ├─ expenses/{service.ts,validators.ts}
│  │  ├─ notifications/{service.ts,templates/,resolvers.ts}
│  │  ├─ reports/{service.ts,queries/}                   # raw SQL per report
│  │  ├─ audit/{service.ts}
│  │  └─ settings/{service.ts,catalog.ts}
│  ├─ lib/
│  │  ├─ auth.ts            # Auth.js config, session helpers
│  │  ├─ db.ts              # prisma base + tenantDb() extension + adminDb
│  │  ├─ permissions.ts     # can(), requirePermission(), permission catalog types
│  │  ├─ api.ts             # withApi() pipeline, envelope, error mapping
│  │  ├─ errors.ts          # AppError taxonomy
│  │  ├─ storage.ts         # presign helpers
│  │  ├─ email.ts           # mailer interface (Resend/Mailpit impls)
│  │  ├─ queue.ts           # BullMQ queues/registrations
│  │  ├─ events.ts          # typed domain-event emitter
│  │  ├─ rate-limit.ts
│  │  └─ utils.ts
│  ├─ components/{ui/,shared/,charts/}   # shadcn primitives; DataTable, FilterBar, EmptyState, StatCard…
│  └─ hooks/                             # useSession, usePermissions, useDataTable…
├─ worker/
│  ├─ index.ts                          # boot, register processors + repeatables
│  └─ jobs/                             # one file per job in §7 table
├─ tests/
│  ├─ unit/                             # calc.ts, engine.ts, day-count.ts, accrual.ts
│  ├─ integration/                      # API+DB (testcontainers), permission matrix, tenant isolation
│  └─ e2e/                              # Playwright flows
└─ docs/                                # this blueprint
```

---

## Decisions made in this document

- Server components may call module services directly (same process) for initial page data; all mutations and client refetches go through `/api/v1` so permissions/validation have a single choke point either way (`withApi` logic reused by a `withPage` helper for RSC reads).
- Pure calculators (`attendance/calc.ts`, `payroll/engine.ts`, `leave/day-count.ts`, `leave/accrual.ts`) take plain inputs and return plain outputs — no DB access — so the hardest HR math is trivially unit-testable.
- Worker imports module services (shared code) rather than duplicating logic; jobs always carry `companyId` and run under a system actor id for audit.
- One S3 bucket with company-prefixed keys (simpler ops); per-tenant buckets deferred until compliance demands.
