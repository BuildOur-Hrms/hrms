# HRMS Blueprint — Roadmap, Testing, Deployment & Build Order

> Document 10 of 11. Phase scope is canonical (matches `00-overview-and-roles.md` §3).

---

## 1. MVP rationale — what NOT to build in v1

MVP = a company can run daily HR ops: people, attendance, shifts, leave, holidays, approvals, dashboards, notifications, audit. Everything below is deliberately excluded from v1:

| Excluded | Why |
|---|---|
| Payroll | Highest correctness risk; needs a full locked month of trustworthy attendance data first |
| Recruitment | Valuable but independent; zero coupling to daily ops |
| Onboarding/Offboarding modules | Manual HR process suffices at pilot scale; needs stable employee lifecycle first |
| Performance | Cycle-based; no urgency in first months |
| LMS | Biggest scope item with least operational urgency |
| Expenses | Payout depends on payroll; standalone value limited |
| Custom roles | 4 system roles cover pilot; permission architecture already future-proofs it |
| SSO / MFA | Invite-only + strong passwords acceptable at pilot scale |
| PWA/push | Responsive web covers mobile day-1 needs |
| Biometric/integrations | Seams designed (`05-architecture.md` §8); hardware later |
| Advanced analytics / report builder | Fixed report catalog answers the real questions |
| Document-expiry automation | Documents module itself is P2 |

---

## 2. Development roadmap

Milestone template fields: Objective · Features · DB · Backend · Frontend · Security · Testing · Dependencies · **Done when**.

### Phase 1 (MVP)

**M0 — Foundation** *(everything depends on this)*
- Objective: running skeleton with auth, RBAC, tenancy, audit plumbing.
- Features: login/logout/reset/invite, app shell, settings read.
- DB: initial migration — org (companies, locations, system_settings), auth tables, employees (minimal), audit_logs; **RLS policies + app_user roles in same migration set**; seed (permissions catalog, 4 roles, pilot company, admin user, default shift placeholder).
- Backend: `withApi` pipeline, tenantDb extension, error taxonomy, domain-event emitter, audit writer, mailer + queue wiring, `/api/health`, auth endpoints.
- Frontend: (auth) screens, (app) shell with permission-driven sidebar, empty dashboard.
- Security: argon2id, lockout, rate limits, CSRF origin check, secret scanning in CI.
- Testing: unit (permissions), integration (auth flows, tenant smoke with 2 companies), CI green.
- Done when: invited user logs in, sees empty shell; foreign-tenant read test returns zero rows; audit rows written for auth events.

**M1 — Org & employees**
- Features: locations, departments, designations, employee CRUD + profile + emergency contacts + invite, employee self-profile edit, `/hr/employees` + detail, `/me/profile`.
- DB: complete employees + emergency_contacts (+ soft-delete filter in client).
- Security: DTO field allowlists, self-edit allowlist, object-level 404 tests.
- Done when: HR creates employee → invite → employee edits own phone; permission matrix tests pass for these endpoints.

**M2 — Shifts & attendance**
- Features: shift CRUD + assignment, check-in/out, punches, nightly calc job, corrections + approvals, month lock, manual entry, `/me/attendance`, `/team/attendance`, `/hr/attendance`.
- DB: shifts, employee_shifts, attendance_* tables, attendance_month_locks.
- Backend: `attendance/calc.ts` pure calculator + worker jobs (`attendance-daily-calc`).
- Testing: heavy unit table for calc (late/half/OT/overnight/week-off/missing-checkout), correction workflow integration, lock guards.
- Done when: a simulated month of punches produces correct records; correction round-trip works; locked month rejects everything.

**M3 — Leave & holidays**
- Features: types/policies, balances + accrual + rollover jobs, requests + approvals + cancellation, holidays CRUD, `/me/leave`, `/team/leave-approvals`, `/hr/leave`.
- Backend: `leave/day-count.ts`, `leave/accrual.ts` pure; balance transactions.
- Testing: day-count unit table (sandwich on/off, half-day, year-boundary split, proration), balance restore paths, approve-own blocked.
- Done when: full leave lifecycle with correct balances incl. cancellation restore; attendance shows `on_leave`.

**M4 — Dashboards, notifications, audit viewer, settings**
- Features: notification service + templates + bell + center, announcements, employee `/dashboard`, `/team`, `/hr` dashboards, `/admin/*` (company, locations, roles view, settings, audit-logs viewer), P1 cron set (accrual, daily-calc, birthdays, probation), basic reports R1–R4, R6–R7, R16.
- Done when: every P1 catalog event fires both channels; dashboards show live data; audit viewer filters work.

**M5 — Hardening & pilot launch**
- Features: empty/loading/error polish, mobile pass, seed-for-pilot tooling.
- Security: full permission-matrix suite, isolation suite, rate-limit smoke, backup + restore drill executed.
- Testing: Playwright e2e (login, check-in, leave request→approve, correction→approve, month lock), load test attendance month view + dashboards (500-employee dataset).
- Done when: go-live checklist (§5) fully checked; pilot company onboarded.

### Phase 2 (each milestone independently shippable)

- **P2-A Payroll**: components/structures/salaries, runs + engine + approval + payslip PDFs, `/hr/payroll`, `/me/payslips`, bank accounts (encrypted). Depends: M2 locks. Done when: parallel-run month matches manual payroll for pilot.
- **P2-B Documents + Expenses**: storage flows, categories, expiry scans; expense lifecycle + reimbursements. Done when: doc expiry notifies T-30/7/0; expense claim→reimbursed round-trip.
- **P2-C Recruitment + Onboarding + Offboarding**: pipeline/kanban, interviews, offers, conversion; templates/tasks/activation; resignation→settlement→deactivation. Done when: candidate→active-employee and employee→exited e2e pass incl. settlement handoff.
- **P2-D Performance**: cycles, goals, reviews, completion matrix. Done when: full cycle with reminders completes.
- **P2-E Reports & exports**: full catalog R5, R8–R15, async exports, digests. Done when: every report matches SQL-verified fixtures; exports audited.

### Phase 3 (outline)
LMS → advanced analytics → automation rules → integrations (biometric first) → PWA/push → multi-tenant self-serve + custom roles + SSO → compliance extras (legal hold, HIBP, external pentest gate).

---

## 3. Testing strategy

| Layer | Tooling | Coverage |
|---|---|---|
| Unit | Vitest | pure calculators (attendance calc, leave day-count, accrual, payroll engine), permission evaluation, zod schemas |
| Integration | Vitest + Testcontainers (Postgres+Redis) | services + API routes against real DB with RLS active |
| API contract | integration suite asserting envelope/error codes per `08-api.md` | every endpoint happy + guard paths |
| Permission matrix | generated suite: **every endpoint × 4 roles** | expected 2xx/403 grid derived from role matrix in `00-…` §6.4 |
| Tenant isolation | two seeded companies | every list/detail endpoint + raw SQL probes: zero cross-reads; foreign ids → 404 |
| Workflow/state | integration | every transition in `07-…` incl. **invalid** transitions → 422 |
| E2E | Playwright | login, check-in/out, leave apply→approve, correction, month lock, (P2) payroll wizard, offboarding |
| Responsive | Playwright viewports (375px, 768px, 1280px) | employee core flows on mobile |
| Performance | k6 or artillery | attendance month view, dashboards, payroll run @ 500 employees < 5 min, report exports |
| Security | suites from `09-security.md` §14 + gitleaks + osv in CI | |

**HR-specific test cases (mandatory list):** mid-month joiner accrual proration; leave overlapping holiday/week-off (sandwich on & off); half-day leave + worked half-day same date; overnight shift crossing midnight and DST-less TZ sanity (company TZ fixed); month lock blocks punches/corrections/manual entries; negative-balance prevention & max_negative honored; payroll rerun blocked after approve, revert allowed before; LOP combining absence + unpaid leave; approve-own-request blocked (leave/correction/expense); manager cannot act on non-reports; exited employee: login blocked, sessions dead, excluded from payroll after exit date; duplicate check-in idempotent; leave request spanning leave-year boundary splits correctly; balance changed between submit and approve → 422; correction on future date rejected.

---

## 4. Deployment & operations

**Environments**: dev (docker-compose full stack incl. Mailpit/MinIO) → staging (prod-shape, masked seed data, every migration rehearses here) → prod.

**Env var catalog** (secret ⚿):
`DATABASE_URL`⚿, `DIRECT_DATABASE_URL`⚿(migrations), `REDIS_URL`⚿, `AUTH_SECRET`⚿, `APP_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`⚿, `S3_SECRET_ACCESS_KEY`⚿, `EMAIL_PROVIDER`, `RESEND_API_KEY`⚿, `EMAIL_FROM`, `SENTRY_DSN`, `FIELD_ENCRYPTION_KEY`⚿(bank numbers), `SEED_DEMO`, `LOG_LEVEL`, `NODE_ENV`.

**Migrations**: `prisma migrate deploy` as a CI step before app rollout; backward-compatible releases (expand-contract for destructive changes); staging rehearsal mandatory; RLS/constraint SQL versioned with migrations.

**CI/CD (GitHub Actions)**: lint → typecheck → unit → integration (testcontainers) → build images → push → staging deploy + migrate + smoke (health, login, isolation probe) → manual gate → prod migrate + deploy → smoke → tag release.

**Monitoring**: uptime checks on `/api/health` (readiness = DB+Redis+queue depth); alerts: p95 latency, 5xx rate, job failure count, queue depth > threshold, cron-missed heartbeats (dead-man switch on daily-calc). Logs: pino JSON → host aggregation (Loki/CloudWatch). Errors: Sentry web+worker, release-tagged.

**Backups**: per `09-security.md` §12; restore drill monthly (calendar-tracked).

**Rollback**: previous image kept warm (`:previous` tag); app rollback = redeploy previous; DB policy — migrations are roll-forward-only (no down migrations in prod); risky Phase-2 modules ship behind feature flags (`payroll.enabled` etc.) so rollback = flag off.

### 5. Deployment & go-live checklists

**Every deploy**: CI green incl. isolation+matrix suites · staging migration rehearsed · smoke passed · Sentry release created · rollback image verified present.
**Go-live (pilot)**: prod env vars set + secrets rotated from defaults · seed run (company, roles, permissions, shifts, leave types, settings) · admin + HR users invited and verified · SMTP/Resend domain verified (SPF/DKIM) · S3 bucket private + presign tested · backups running **and one restore tested** · rate limits enabled · audit logging verified end-to-end · month-lock and payroll flags in correct phase state · uptime + dead-man alerts firing to a human.

---

## 6. Build Order (canonical implementation sequence)

Phase 1:
1. **Repo scaffold** — Next.js 15 TS strict, Tailwind, shadcn/ui, ESLint/Prettier, Vitest. *(dep: —)*
2. **Docker + CI** — compose (pg/redis/minio/mailpit), GitHub Actions lint/type/test. *(1)*
3. **Prisma core schema migration** — org + auth + employees-min + audit tables, **RLS SQL, DB roles**, seed (permissions, roles, company, admin). *(2)*
4. **lib plumbing** — errors, envelope, `withApi`, tenantDb extension, events, queue, mailer, rate-limit. *(3)*
5. **Auth module** — login/logout/reset/invite endpoints + (auth) screens + session middleware. *(4)*
6. **RBAC** — permission catalog, `can()`/`requirePermission`, role assignment endpoints, sidebar-by-permission shell. *(5)*
7. **Audit plumbing** — event→audit writer, viewer API + `/admin/audit-logs`. *(6)*
8. **Org structure** — locations, departments, designations (API + admin/HR screens). *(6)*
9. **Employees** — CRUD, profile tabs, self-service edits, invite wiring, `/me/profile`. *(8)*
10. **Shifts** — definitions + assignments. *(9)*
11. **Attendance** — punches, check-in/out, calc job + worker boot, records views, corrections, month lock. *(10)*
12. **Leave** — types/policies/balances/accrual jobs, requests + approvals, `/me/leave`, approvals screens. *(11 for on_leave integration; 9)*
13. **Holidays** — CRUD + integration into calc/day-count. *(12)*
14. **Notifications** — service, templates, bell, center, announcements; wire P1 events + crons. *(12)*
15. **Dashboards** — employee `/dashboard`, `/team`, `/hr` + basic reports (R1–R4, R6–R7, R16). *(14)*
16. **Settings** — catalog service + `/admin/settings`, `/admin/company`. *(6)*
17. **Hardening** — permission-matrix + isolation + e2e suites, mobile pass, load test, backup/restore drill, pilot launch. *(all)*

Phase 2 order: 18. Payroll (engine → admin → runs → payslips) → 19. Documents → 20. Expenses → 21. Recruitment → 22. Onboarding → 23. Offboarding → 24. Performance → 25. Full reports/exports.
Phase 3 order: 26. LMS → 27. Analytics → 28. Automation rules → 29. Integrations → 30. PWA/push → 31. Multi-tenant GA (self-serve signup, custom roles, SSO, pentest gate).

---

## Decisions made in this document

- Roll-forward-only DB policy in prod (no down migrations) — rollback via app image + feature flags.
- Payroll go-live requires one **parallel run** (system vs existing manual payroll) with zero unexplained diffs.
- Permission-matrix tests are generated from the role matrix table, not hand-written, so drift between docs and code fails CI.
- 500-employee dataset is the standing performance fixture size.
