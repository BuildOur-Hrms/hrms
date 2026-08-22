# HRMS Blueprint — Product Overview, Requirements & Role Model

> Document 00 of 11. This doc set is the single source of truth for building the HRMS.
> Canonical data shapes live in `04-database.md`. Canonical decisions (stack, tables, enums, routes, phases) are repeated consistently across all docs; where docs disagree, `04-database.md` wins for data and this doc wins for scope/roles.

---

## 1. Product Requirements Document (PRD)

### 1.1 Purpose

A single web platform where a company manages the entire employee lifecycle: hiring, onboarding, daily attendance, shifts, leave, payroll, documents, performance, training, expenses, internal communication, offboarding, and reporting. It replaces spreadsheets, email threads, and disconnected point tools with one permission-controlled, auditable system.

The system ships as a **single-company application** but is **multi-tenant-ready from day 1**: every tenant-scoped table carries `company_id`, and authorization is built on tenant isolation + permissions, so supporting many companies later requires onboarding flows — not a rewrite.

### 1.2 Target users / personas

| Persona | Role in system | What they need |
|---|---|---|
| Founder / IT owner | `super_admin` | Platform configuration, company setup, roles/permissions, audit visibility, data safety |
| HR generalist / HR head | `hr_admin` | Employee master data, attendance/leave administration, payroll runs, recruitment, documents, reports |
| Team lead / department head | `manager` | Team attendance, leave approvals, corrections approvals, team performance, team reports |
| Every staff member | `employee` | Self-service: check-in/out, apply leave, view payslips/documents, submit expenses, training, own profile |

One person can hold multiple roles (e.g., an HR head is also a manager of the HR team) via `user_roles`.

### 1.3 Business problems solved

1. **Scattered records** — employee data in spreadsheets, contracts in email, no single profile. → One employee master with documents attached.
2. **Untrusted attendance** — manual registers, no late/overtime rules. → Timestamped check-in/out with shift rules, corrections with approval trails.
3. **Leave chaos** — balances tracked by hand, disputes about carry-forward. → Policy-driven accruals, live balances, approval workflow, full history.
4. **Slow, error-prone payroll** — manual LOP counting, no payslip archive. → Payroll runs computed from attendance/leave snapshots, approved, published as PDFs.
5. **No manager visibility** — managers can't see team status without asking HR. → Team dashboards scoped to direct reports.
6. **Zero auditability** — no record of who changed a salary or approved a leave. → Append-only audit logs on all sensitive actions.
7. **Compliance risk** — expiring contracts/documents unnoticed. → Expiry tracking with automated reminders.

### 1.4 Goals

- Every HR workflow (listed in §2) executable end-to-end inside the system with correct permissions.
- An employee's day-1 needs (check-in, leave, profile) usable on a phone browser.
- HR can answer "who was absent last month?", "what did we pay in March?", "whose contract expires in 30 days?" in under a minute.
- All sensitive reads/writes are permission-checked server-side and audit-logged.
- A second company can be onboarded with configuration only (no schema or code changes).

### 1.5 Non-goals

- Not a public job board, benefits marketplace, or background-check provider.
- No country-specific statutory tax engine hard-coded in core (statutory items are configurable salary components; a country pack can be layered later).
- No native mobile apps (responsive web first; PWA in Phase 3).
- No custom workflow builder / BPM engine — approval flows are fixed single-level (manager → HR override) until proven insufficient.
- No AI features in scope for v1–v3.

### 1.6 Success metrics

- 100% of active employees checked in via the system within 2 weeks of pilot.
- Leave requests resolved (approved/rejected) in < 48h median.
- Payroll run for the pilot company completed in < 1 day of effort (Phase 2).
- Zero cross-tenant data reads in isolation tests (continuous, automated).
- < 1% attendance records requiring manual correction after month 2.

---

## 2. Core workflows (summary)

Full state machines with side effects live in `07-workflows-and-automation.md`.

- **Employee onboarding** — A hired candidate's accepted offer converts into an `employees` row (status `onboarding`), HR collects documents, an onboarding checklist (from a template) is executed by HR/IT/manager/new hire, and on completion the employee becomes `active` with a user account invited.
- **Attendance** — Employee checks in/out (punches accumulate); a nightly job computes the daily `attendance_records` row (status, worked minutes, late minutes, overtime) against the assigned shift; discrepancies are fixed via `attendance_corrections` with manager approval; the month is locked before payroll.
- **Leave** — Employee submits a `leave_requests` row against a live balance; manager approves/rejects (HR can override); approval deducts `leave_balances`, cancellation restores it; every transition notifies the parties.
- **Payroll** — HR opens a `payroll_runs` period; the system snapshots attendance/leave, computes LOP, prorates salary components, produces payslips; HR reviews, `hr_admin` approves; payslip PDFs are generated and published to employees; run is marked paid.
- **Offboarding** — Resignation is submitted and approved; notice period and last working day are computed; exit checklist and asset clearance run; final settlement inputs hand off to payroll; on completion the user account is disabled and the employee becomes `exited`.
- **Recruitment** — HR publishes a `job_postings` row; candidates are added; each `applications` row moves applied → screening → interview → offer → hired/rejected; interviews collect structured feedback; an accepted offer triggers conversion to employee (onboarding workflow).
- **Training** — HR publishes a course with lessons; employees are enrolled (self or assigned); progress is tracked per lesson; completion issues a certificate.

---

## 3. MVP scope vs future scope

Detailed milestone plan: `10-roadmap-testing-deployment.md`.

### Phase 1 — MVP (launchable HRMS)

Auth + invites, permission-based RBAC, company/org setup, locations, departments, designations, employee master + profiles, shifts (definitions + assignment), attendance (web check-in/out, punches, nightly calculation, corrections), leave (types, policies, balances, requests, approvals), holidays, employee self-service, manager team view + approvals, basic HR dashboard, in-app + email notifications, audit logs, basic system settings.

**Deliberately NOT in MVP:** payroll, recruitment, onboarding/offboarding modules, performance, LMS, expenses, document-expiry automation, advanced analytics/report builder, PWA/push, custom roles, SSO, biometric integration. (Rationale per item in `10-roadmap-testing-deployment.md` §1.)

### Phase 2

Payroll (components, structures, runs, payslips), employee documents, expenses & reimbursements, recruitment, onboarding, offboarding, performance management, advanced shift rostering, reports + exports.

### Phase 3

Training/LMS, advanced analytics, automation rules, integrations (biometric devices, accounting, calendar, Slack), PWA + web push, multi-tenant self-serve signup, custom roles, SSO.

---

## 4. Recommended architecture

### 4.1 Options compared

| Option | Strengths | Weaknesses |
|---|---|---|
| **(a) Modular monolith — Next.js full-stack** | One language/repo/deploy; fastest iteration; server components + REST API in one app; module boundaries enforced by convention allow later extraction | Requires discipline to keep module boundaries; worker runs as a second process |
| (b) NestJS API + React SPA | Strong DI/module system; clean API separation | Two apps to build/deploy/version; duplicated types unless extra tooling; slower for a small team |
| (c) BaaS (Supabase) | Auth/RLS/storage out of the box; very fast start | Payroll math, workflow state machines, PDF generation, and scheduled jobs need a real server anyway; vendor lock-in on auth; harder local testing |

**Recommendation: (a) modular monolith on Next.js.** A small team ships one TypeScript codebase; domain logic lives in `src/modules/*` behind service functions, so Payroll/Recruitment/LMS bolt on without touching core; if scale ever demands it, a module extracts into its own service because nothing else touches its tables directly.

### 4.2 Why this scales to multi-tenant without rewrite

- `company_id` is on every tenant table from the first migration; all queries pass through a tenant-scoped Prisma client extension.
- PostgreSQL RLS policies (session variable `app.company_id`) provide defense-in-depth beneath the app layer.
- Authorization is permissions + data-scope tiers (own/team/company/platform) — nothing assumes "there is only one company."
- Becoming true SaaS later = add company signup/provisioning + billing, not schema surgery.

### 4.3 Technology stack (canonical)

| Layer | Choice | Why | Alternative considered |
|---|---|---|---|
| Framework | Next.js 15 (App Router, TypeScript strict) | One deployable for UI + API; RSC for fast reads; huge ecosystem | NestJS + React SPA |
| UI | Tailwind CSS + shadcn/ui, lucide-react, Recharts | Professional look fast; accessible primitives; no design-system tax | MUI, Ant Design |
| Data fetching / tables / forms | TanStack Query, TanStack Table, react-hook-form + zod | Server-state caching; headless tables; shared client/server validation | SWR, Formik |
| API | REST route handlers `/api/v1/*` | Simple, cacheable, testable; no GraphQL complexity needed | GraphQL, tRPC |
| Database | PostgreSQL 16 + Prisma ORM (UUID PKs, prisma migrate) | Relational integrity for HR data; RLS support; typed queries | MySQL, Drizzle |
| Auth | Auth.js v5 credentials (argon2id), JWT session httpOnly cookie | Invite-only workforce auth; stateless sessions; SSO pluggable later | Clerk, Supabase Auth |
| AuthZ | Permission RBAC (`requirePermission()`) + tenant-scoped Prisma extension + Postgres RLS | Permission-based, tenant-safe, defense-in-depth | CASL, hard-coded roles |
| Files | S3-compatible storage (S3/R2 prod, MinIO dev), presigned URLs | Private-by-default documents; no server file handling | Local disk, DB blobs |
| Jobs | BullMQ + Redis, separate worker process | Reliable retries; cron repeatables for accruals/reminders | pg-boss, in-process cron |
| Email | Provider-agnostic mailer (Resend prod, Mailpit dev) | Swappable; local testing | SMTP direct |
| PDF | @react-pdf/renderer in worker | Payslips/certificates server-side, off request path | Puppeteer |
| Deploy | Docker Compose (web, worker, postgres, redis, minio); GitHub Actions CI/CD | Reproducible; runs on any VPS/Render/Fly | Vercel + managed addons |

---

## 5. Feature hierarchy (all 23 modules)

Legend: **P1** = MVP, **P2**, **P3**.

1. **Authentication & Security** — invite-only accounts P1; login/logout P1; forgot/reset password P1; session management P1; account lockout P1; rate limiting P1; SSO (Google) P3; MFA P3
2. **Employee Management** — employee CRUD + profile P1; manager assignment P1; bank accounts P2 (payroll dependency); emergency contacts P1; employment types/status lifecycle P1; bulk import P2
3. **Company & Organization** — company profile & settings P1; org defaults (timezone, currency, week-offs) P1; multi-company provisioning P3
4. **Departments & Designations** — department CRUD + head P1; designation CRUD + level P1; department tree (nested) P3
5. **Attendance** — web check-in/out + punches P1; nightly calculation P1; corrections + approval P1; month lock P1; overtime capture P1 (approval P1, payout P2); biometric ingestion P3
6. **Shift Management** — shift definitions (times, grace, thresholds, week-offs) P1; employee assignment with effective dates P1; rotation/rostering P2
7. **Leave Management** — leave types P1; policies (accrual, carry-forward, proration, sandwich rule) P1; balances P1; requests + approvals P1; half-day leave P1; comp-off P2
8. **Holiday Management** — holiday calendar CRUD P1; location-specific holidays P1; optional/floating holidays P2
9. **Payroll** — salary components P2; structures P2; employee salary assignment P2; payroll runs P2; payslips + PDF publish P2; final settlement P2; statutory country pack P3
10. **Employee Documents** — categories P2; upload/download (presigned) P2; expiry tracking P2; expiry automation P2; e-sign P3
11. **Recruitment** — job postings P2; candidates P2; application pipeline P2; interviews + feedback P2; offers P2; convert-to-employee P2; careers page P3
12. **Onboarding** — task templates P2; per-hire checklists P2; multi-assignee tasks P2
13. **Performance Management** — cycles P2; goals P2; self + manager reviews P2; ratings P2; 360° feedback P3
14. **Training/LMS** — courses + lessons P3; enrollments + progress P3; certificates P3; assessments/quizzes P3
15. **Expenses & Reimbursements** — categories P2; claims with receipts P2; approval P2; reimbursement payout (payroll or direct) P2
16. **Employee Self-Service** — dashboard P1; own attendance/leave/profile P1; payslips P2; documents P2; expenses P2; training P3
17. **Manager Dashboard** — team overview P1; pending approvals P1; team attendance P1; team performance P2; team reports P2
18. **HR Dashboard** — headcount & presence KPIs P1; pending actions P1; charts P1 (basic) / P2 (extended)
19. **Notifications** — in-app P1; email P1; digests P2; web push P3; preferences P3
20. **Reports & Analytics** — attendance/leave reports P1 (basic lists); full catalog + exports P2; analytics dashboards P3
21. **Offboarding** — resignation + approval P2; exit checklist P2; asset clearance P2; settlement handoff P2; account deactivation P2 (deactivation itself exists P1 via employee status)
22. **Audit Logs** — append-only log P1; viewer + filters P1; retention policy P2
23. **System Settings** — company settings P1; attendance/leave rules P1; password policy P1; notification toggles P2

---

## 6. Role & permission system

### 6.1 System roles

| Role | Scope | Summary |
|---|---|---|
| `super_admin` | platform | Everything, across companies (when multi-tenant). Company provisioning, global settings, all audit logs. Not part of approval chains. |
| `hr_admin` | company | Full HR administration inside own company: employees, attendance, leave, payroll, recruitment, documents, reports, settings, roles assignment. Can override any approval. |
| `manager` | team | Direct reports only: view team attendance/leave/profiles (work data, not salary), approve leave/corrections/expenses/overtime, team reports. |
| `employee` | own | Self-service only: own profile, attendance, leave, payslips, documents, expenses, training, notifications. |

Roles are **seeded rows**, not code constants. A user gets roles via `user_roles`; a role gets capabilities via `role_permissions`. Custom roles (Phase 3) are just new rows — zero code change, which is the point of permission-based design.

### 6.2 Permission architecture

- Permission = string `module.action`, e.g. `leave.approve`, `employee.view_all`, `payroll.manage`.
- Action vocabulary (closed set): `view_own`, `view_team`, `view_all`, `create`, `edit`, `delete`, `approve`, `export`, `manage`.
- `manage` = module administration (configure types/policies/templates/settings for that module); it does not imply the other actions — grants are explicit.
- Enforcement is server-side only: every API route declares its required permission; UI uses the same permission set to show/hide navigation and buttons (cosmetic, never trusted).
- **Never** `if (role === 'hr_admin')` in feature code. Always `can(user, 'module.action')`.

### 6.3 Data-scope tiers (combine with permissions)

| Tier | Meaning | Enforced by |
|---|---|---|
| own | rows where `employee_id` = caller's employee id (or `user_id` = caller) | service-layer filter |
| team | rows of employees whose `manager_id` = caller's employee id | service-layer filter |
| company | all rows in caller's `company_id` | tenant-scoped Prisma client + RLS |
| platform | across companies | `super_admin` only, explicit bypass client |

`view_own` / `view_team` / `view_all` select the tier; tenant isolation always applies underneath (a manager with `view_team` still can't cross companies). Object-level rules add a third layer: e.g., approver ≠ requester, manager approves only direct reports.

### 6.4 Default role → permission matrix (all 23 modules)

Legend: **O**=view_own, **T**=view_team, **A**=view_all, **C**=create, **E**=edit, **Ap**=approve, **D**=delete, **X**=export, **M**=manage. `super_admin` holds every permission platform-wide and is omitted from cells (always: all).

**People & org**

| Module | employee | manager | hr_admin |
|---|---|---|---|
| 2 Employee Management | O, E(own limited fields) | T | A, C, E, D, X |
| 3 Company & Organization | O(view basics) | O | A, E, M |
| 4 Departments & Designations | O(view) | O(view) | A, C, E, D, M |

**Time**

| Module | employee | manager | hr_admin |
|---|---|---|---|
| 5 Attendance | O, C(check-in/out, correction request) | T, Ap(corrections) | A, C(manual entry), E, Ap, X, M(lock) |
| 6 Shift Management | O(view own shift) | T(view) | A, C, E, D, M |
| 7 Leave Management | O, C(request), E(cancel own) | T, Ap | A, C(on behalf), E, Ap, X, M(types/policies) |
| 8 Holiday Management | O(view) | O(view) | A, C, E, D, M |

**Money & talent**

| Module | employee | manager | hr_admin |
|---|---|---|---|
| 9 Payroll | O(own payslips) | — | A, C, E, Ap, X, M |
| 10 Employee Documents | O, C(upload own where allowed) | T(view work docs) | A, C, E, D, X, M(categories) |
| 11 Recruitment | — (referrals P3) | T(interviewer: view assigned, C feedback) | A, C, E, D, X, M |
| 12 Onboarding | O(own tasks, complete) | T(assigned tasks) | A, C, E, M(templates) |
| 13 Performance Management | O, C(self review, goals) | T, C(manager review), Ap(goals) | A, C, E, X, M(cycles) |
| 14 Training/LMS | O, C(self-enroll) | T(view progress) | A, C, E, D, X, M(courses) |
| 15 Expenses & Reimbursements | O, C, E(draft) | T, Ap | A, Ap(override), E, X, M(categories, mark reimbursed) |

**Platform**

| Module | employee | manager | hr_admin |
|---|---|---|---|
| 16 Employee Self-Service | O (composite of own-tier grants) | O | O |
| 17 Manager Dashboard | — | T | A(view as any manager) |
| 18 HR Dashboard | — | — | A |
| 19 Notifications | O, E(mark read) | O | O + C(announcements), M |
| 20 Reports & Analytics | — | T(team reports), X(team) | A, X, M |
| 21 Offboarding | O, C(resignation) | T, Ap(resignation of reports) | A, C, E, Ap, M |
| 22 Audit Logs | — | — | A(company), X |
| 23 System Settings | — | — | E, M (company scope; global scope = super_admin) |

Seed data must materialize this matrix into `permissions` + `role_permissions` rows (see `04-database.md` §6).

---

## Decisions made in this document

- Product name placeholder is "HRMS"; branding is a launch-time concern, not a build blocker.
- `manage` action defined as module configuration and explicitly non-hierarchical (no implied grants).
- Managers see team **work** data only — never salary/payslips/bank details (field-level rule, restated in `09-security.md`).
- Recruitment interviewer capability is modeled as manager-tier permissions on assigned interviews, not a fifth role.
- Success metrics chosen for a pilot company of roughly 20–200 employees; thresholds are configuration, not code.
