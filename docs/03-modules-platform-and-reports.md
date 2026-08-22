# HRMS Blueprint — Platform Modules (17–23) & Reports Catalog

> Document 03 of 11. Covers modules: 17 Manager Dashboard, 18 HR Dashboard, 19 Notifications, 20 Reports & Analytics, 21 Offboarding, 22 Audit Logs, 23 System Settings.
> Data shapes: `04-database.md`. Endpoints: `08-api.md`. Screens: `06-ui-ux.md`. Workflows: `07-workflows-and-automation.md`.

---

## Module 17 — Manager Dashboard (Phase 1)

### Purpose
One screen where a manager sees team status and clears pending approvals. Scope is always direct reports (`employees.manager_id`).

### Features
- Team presence today: present / absent / on leave / late counts + per-person list (P1)
- Pending approvals inbox: leave requests, attendance corrections (P1); expenses, resignations (P2)
- Team leave calendar (this week/month) (P1)
- Team headcount card and upcoming birthdays/anniversaries of reports (P1)
- Team performance summary (review completion, goal progress) (P2)
- Quick links to team reports (P2)

### User roles involved
`manager` (T-scope); `hr_admin` may view any manager's team view (support/debug).

### Main screens
`/team` (dashboard), plus `/team/attendance`, `/team/leave-approvals`, `/team/performance`, `/team/reports`.

### Main actions
approve/reject from inbox (inline), navigate to detail views.

### Approval workflows
Surfaces approvals owned by Leave / Attendance / Expenses / Offboarding modules; no own flows.

### Required database entities
None owned — reads via module services (`attendance_records`, `leave_requests`, `attendance_corrections`, `expenses`, `employees`, `performance_reviews`).

### Dependencies
Attendance, Leave, Employee Management; P2: Expenses, Performance, Offboarding.

---

## Module 18 — HR Dashboard (Phase 1)

### Purpose
Company-wide operational snapshot for HR: who's here, what needs action, what's trending.

### Features / composition
**KPI cards (P1):** total active headcount; present today; on leave today; absent today; late today; pending approvals (all types); employees on probation; on notice (P2).
**Charts:** headcount by department (bar) P1; attendance trend last 30 days (line: present%/late%) P1; leave usage by type this month (donut) P1; headcount trend 12 months (line) P2; attrition rate (line) P2; payroll cost trend (line, `payroll.view_all` only) P2.
**Lists (P1):** today's absences without leave; pending leave approvals (oldest first); upcoming holidays; recent joiners; upcoming probation ends.
**Quick actions (P1):** add employee, apply leave on behalf, add holiday, lock attendance month (P1); run payroll (P2).

### User roles involved
`hr_admin` (A-scope). `super_admin` sees per-company selector (P3 multi-tenant).

### Main screens
`/hr` (dashboard). Drill-through into each module's HR screen.

### Main actions
Navigation + quick actions; no own mutations.

### Approval workflows
None owned.

### Required database entities
None owned — aggregates via module services.

### Dependencies
All Phase-1 modules; P2 additions read Payroll/Offboarding/Performance.

---

## Module 19 — Notifications (Phase 1)

### Purpose
Deliver system events to users in-app and by email, from one dispatch service with templated messages. Full event catalog: `07-workflows-and-automation.md` §3.

### Features
- `notifications` table rows per recipient: type, title, body, link (deep link into app), read_at (P1)
- Bell dropdown (latest 10, unread badge) + `/me/notifications` center with filters (P1)
- Mark read / mark all read (P1)
- Email fanout via worker queue (template registry; per-event enable toggle in settings) (P1)
- Announcements: HR-authored broadcast (`announcements`, rich text sanitized) with audience company-wide or department; `announcement_reads` receipts (P1)
- Daily digest option (P2); web push via PWA (P3); per-user channel preferences (P3)

### User roles involved
All users receive; `hr_admin` creates announcements (`notifications.manage` for templates/toggles).

### Main screens
Bell dropdown (global shell), `/me/notifications`, announcements composer in `/hr` area.

### Main actions
mark-read, mark-all-read, create/publish announcement.

### Approval workflows
None. Announcements publish directly (require `announcements.create`).

### Required database entities
`notifications`, `announcements`, `announcement_reads`, `users`.

### Dependencies
Every event-producing module; worker/queue; email service.

---

## Module 20 — Reports & Analytics (Phase 1 basic lists; Phase 2 full catalog + exports; Phase 3 analytics)

### Purpose
Answer operational and compliance questions with filterable, exportable tabular reports and dashboard KPIs.

### Global report behavior
All reports: filter bar (date range presets + custom, department, location, employee, status where applicable), server-side pagination, column sort, CSV/XLSX export (P2; PDF where noted), permission = `reports.view_all` scoped by module-specific export permission for downloads. Manager variants under `/team/reports` auto-scope to direct reports with `reports.view_team`.

### Report catalog

| # | Report | Purpose | Key columns | Extra filters / grouping | KPIs on top | Phase |
|---|---|---|---|---|---|---|
| R1 | Headcount | Current workforce composition | employee, code, dept, designation, location, type, status, join date | group by dept/location/type/status | total, by-status counts | P1 |
| R2 | Attendance summary | Per-employee month grid | employee, days present/absent/half/leave/holiday/week-off, worked hrs, OT hrs | month picker; dept | avg presence % | P1 |
| R3 | Absence report | Unapproved absences | employee, date, expected shift, reason (none) | date range, dept | absence count, top absentees | P1 |
| R4 | Late arrivals | Punctuality | employee, date, shift start, check-in, late minutes | threshold minutes; dept | late %, avg late mins | P1 |
| R5 | Overtime | OT liability | employee, date, OT minutes, approved?, approver | approved-only toggle | total OT hrs | P2 |
| R6 | Leave usage | Balances vs usage | employee, type, opening, accrued, used, carried, current | year, type, dept | utilization % | P1 |
| R7 | Leave calendar | Who's off when | date, employee, type, half-day | month, dept | days off this month | P1 |
| R8 | Payroll register | Run line items | employee, gross, per-component columns, deductions, net | run picker | total gross/net, employer cost | P2 |
| R9 | Payroll cost trend | Cost over time | month, gross, net, headcount, cost/head | 12/24 months | YoY delta | P2 |
| R10 | Recruitment funnel | Pipeline health | job, applied, screening, interview, offer, hired, rejected, days-to-hire | job, date range | conversion %, avg time-to-hire | P2 |
| R11 | Turnover / attrition | Exits analysis | employee, join date, exit date, tenure, dept, reason | period, dept | attrition % (annualized), avg tenure | P2 |
| R12 | Performance distribution | Ratings spread | cycle, rating buckets 1–5 counts, dept breakdown | cycle, dept | avg rating, completion % | P2 |
| R13 | Training completion | Compliance | course, enrolled, in progress, completed, overdue | course, dept, mandatory-only | completion % | P3 |
| R14 | Expense summary | Spend control | employee, category, count, amount, status | period, category, dept | total spend, avg claim | P2 |
| R15 | Document expiry | Compliance | employee, document, category, expiry date, days left | category, window (30/60/90) | expiring ≤30d count | P2 |
| R16 | Audit activity | Sensitive-action review | timestamp, actor, action, entity, summary | actor, entity type, action, date | — (list only) | P1 |

Export events themselves are audit-logged (who exported what, when).

### User roles involved
`hr_admin` (all, company scope); `manager` (R1–R7 team-scoped variants); `employee` none.

### Main screens
`/hr/reports` (catalog grid → report page), `/team/reports`.

### Main actions
run report, change filters, export, schedule email report (P3).

### Approval workflows
None.

### Required database entities
None owned; read-only aggregation over module tables. Heavy reports use read-optimized SQL (raw queries) not ORM loops.

### Dependencies
Every data module; worker for async export generation of large files.

---

## Module 21 — Offboarding (Phase 2)

### Purpose
Controlled exit: resignation → approval → notice period → exit checklist → clearance → settlement handoff → deactivation. Ensures nothing (assets, access, money) is left dangling.

### Features
- Resignation submission by employee (or HR on behalf): reason, requested last working day (P2)
- Manager approval → HR confirmation; notice period from employment terms (company setting default, overridable per employee); system computes last_working_day (P2)
- Employee status → `on_notice` on approval (P2)
- Exit checklist from template: asset return, access revocation, knowledge transfer, exit interview — tasks assigned to HR/IT/manager/employee with due dates (P2)
- Asset clearance flag per task; blocking: settlement cannot start until required tasks complete (P2)
- Final settlement inputs: unused paid leave encashment (days × per-day rate), pending expense reimbursements, recovery items, notice shortfall — handed to Payroll as a settlement run line (P2)
- Account deactivation on completion: `users.status → disabled`, sessions invalidated, employee `exited`, personal data retention clock starts (P2)
- Statuses (`offboarding_requests.status`): `initiated → in_progress → cleared → settled → completed` (P2)

### User roles involved
- `employee`: submit resignation, complete own tasks, view exit status.
- `manager`: approve resignation of direct reports, complete assigned tasks.
- `hr_admin`: confirm, manage checklist, settlement, deactivate.

### Main screens
Offboarding tab in `/hr/employees/[id]`; resignation dialog in `/me/profile`; exit-pipeline list view in `/hr/employees` (filter: on_notice).

### Main actions
submit-resignation, approve-resignation, set-last-working-day, start-checklist, complete-task, mark-cleared, record-settlement, complete-offboarding.

### Approval workflows
Resignation: employee submits (`initiated`) → manager approves → HR confirms (sets last_working_day, status `in_progress`). Withdrawal allowed while `initiated`/`in_progress` before last working day (HR approves withdrawal; status back to active employment, request `cancelled` — modeled as terminal note, request row kept). `cleared` requires all required tasks done; `settled` requires settlement recorded; `completed` performs deactivation.

### Required database entities
`offboarding_requests`, `offboarding_tasks`, `onboarding_templates` (shared template mechanism — offboarding templates flagged by `kind`), `employees`, `users`, `leave_balances` (encashment read), `expenses` (pending read), `payroll_runs` (settlement), `notifications`, `audit_logs`.

### Dependencies
Employee Management, Leave (encashment), Expenses, Payroll (settlement), Authentication (deactivation), Notifications.

---

## Module 22 — Audit Logs (Phase 1)

### Purpose
Append-only, tamper-evident record of every sensitive action for accountability and compliance.

### What is logged (catalog)
- Auth: login success/failure, lockout, password change/reset, invite issued/accepted, user disabled
- RBAC: role assigned/removed, permission set changed
- Employee: create, sensitive-field edit (name/DOB/IDs/bank), status change, delete
- Attendance: manual entry, correction approve/reject, month lock/unlock
- Leave: approve/reject/cancel, balance adjustment, policy change
- Payroll: component/structure change, salary assignment, run state transitions, payslip publish (P2)
- Documents: upload, download of sensitive categories, delete (P2)
- Recruitment: offer sent/accepted (P2)
- Offboarding: every state transition (P2)
- Settings: any change
- Exports: any report/data export (who, what, filter params)

### Log record shape
`audit_logs`: id, company_id, actor_user_id (nullable for system jobs), action (verb string e.g. `leave.approve`), entity_type, entity_id, before (jsonb, nullable), after (jsonb, nullable), ip, user_agent, created_at. **Append-only**: no update/delete API; DB role used by the app has no UPDATE/DELETE grant on this table; RLS still scopes reads by company.

### Features
- Automatic emission from service layer via domain events (P1)
- Viewer with filters: date range, actor, action, entity type, entity id (P1)
- Detail drawer showing before/after diff (P1)
- Retention job (default 2 years, configurable) (P2)
- Export (P1, itself logged)

### User roles involved
`hr_admin` (company scope read), `super_admin` (all). No write API for anyone.

### Main screens
`/admin/audit-logs`.

### Main actions
filter, inspect diff, export.

### Approval workflows
None.

### Required database entities
`audit_logs`.

### Dependencies
All modules emit; none consumed.

---

## Module 23 — System Settings (Phase 1)

### Purpose
Central configuration store (`system_settings`: key, value jsonb, company_id nullable → null = global/platform default; company row overrides global).

### Settings catalog

| Key | Scope | Type | Default | Phase |
|---|---|---|---|---|
| `general.timezone` | company | string (IANA) | Asia/Kolkata | P1 |
| `general.currency` | company | char(3) | INR | P1 |
| `general.date_format` | company | string | DD/MM/YYYY | P1 |
| `general.working_days` | company | int[] weekdays | [1,2,3,4,5] | P1 |
| `general.leave_year_start_month` | company | int 1–12 | 1 | P1 |
| `attendance.join_mid_month_cutoff_day` | company | int | 15 | P1 |
| `attendance.missing_checkout_policy` | company | enum flag+penalty | flag_only | P1 |
| `attendance.auto_absent_after_days` | company | int | 1 | P1 |
| `leave.sandwich_rule_default` | company | bool | false | P1 |
| `leave.allow_negative_balance` | company | bool | false | P1 |
| `security.password_min_length` | global | int | 10 | P1 |
| `security.lockout_threshold` | global | int | 5 | P1 |
| `security.session_hours` | global | int | 12 | P1 |
| `notifications.email_enabled` | company | bool | true | P1 |
| `notifications.event_toggles` | company | jsonb map | all on | P2 |
| `payroll.pay_day` | company | int | 1 | P2 |
| `payroll.notice_period_days_default` | company | int | 30 | P2 |
| `payroll.leave_encashment_enabled` | company | bool | true | P2 |
| `performance.rating_labels` | company | jsonb | 1–5 labels | P2 |
| `retention.*` (per entity) | global | jsonb | see 09-security | P2 |

### User roles involved
`hr_admin` edits company-scope keys (`settings.manage` company); `super_admin` edits global keys.

### Main screens
`/admin/settings` (grouped tabs: General, Attendance, Leave, Security, Notifications, Payroll P2).

### Main actions
edit-setting (typed forms per group; every change audit-logged with before/after).

### Approval workflows
None.

### Required database entities
`system_settings`.

### Dependencies
None; all modules read settings through a cached settings service (cache invalidated on write).

---

## Decisions made in this document

- Offboarding checklists reuse the onboarding template mechanism via a `kind` discriminator (`onboarding|offboarding`) on `onboarding_templates` — one mechanism, two flows.
- Settings storage = key/value jsonb with global-then-company override resolution; typed accessors in code guard against shape drift.
- Report exports > 5,000 rows generate asynchronously in the worker and deliver via notification with download link; smaller exports stream synchronously.
- Audit `before`/`after` store only changed fields (diff), not whole rows, except state transitions which store `{status: from→to}` plus context ids.
- Manager dashboard birthday/anniversary widgets show day+month only (no birth year) — privacy default.
