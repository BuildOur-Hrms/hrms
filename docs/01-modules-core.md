# HRMS Blueprint — Core Modules (1–8)

> Document 01 of 11. Covers modules: 1 Authentication & Security, 2 Employee Management, 3 Company & Organization, 4 Departments & Designations, 5 Attendance, 6 Shift Management, 7 Leave Management, 8 Holiday Management.
> Data shapes: `04-database.md`. Endpoints: `08-api.md`. Screens: `06-ui-ux.md`. Workflows: `07-workflows-and-automation.md`.

---

## Module 1 — Authentication & Security (Phase 1)

### Purpose
Control who can enter the system and prove who they are. Accounts are **invite-only** — there is no public signup; HR creates an employee, which triggers a user invite.

### Features
- Invite flow: HR creates employee → optional user account → invite email with single-use token (P1)
- Accept invite: set password, activate account (`users.status` invited → active) (P1)
- Login / logout with email + password (argon2id) (P1)
- Forgot / reset password (single-use, TTL-bound, hashed-at-rest tokens) (P1)
- JWT session in httpOnly Secure SameSite=Lax cookie; sliding expiry (P1)
- Account lockout after repeated failures + progressive delay (P1)
- Rate limiting on auth endpoints (P1)
- "Logout everywhere" via session-version claim bump (P1)
- Google SSO, MFA (P3)

### User roles involved
- All roles: login, logout, reset own password.
- `hr_admin`: trigger/resend/revoke invites (via Employee Management).
- `super_admin`: disable any user, global password policy.

### Main screens
`/login`, `/forgot-password`, `/reset-password`, accept-invite screen (reuses reset-password UI with invite token).

### Main actions
login, logout, request-reset, reset, accept-invite, resend-invite (HR), disable-user (HR/admin).

### Approval workflows
None. Security-relevant events (login failure, lockout, password change, invite issued) are audit-logged.

### Required database entities
`users`, `password_reset_tokens`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_logs`.

### Dependencies
None (foundation). Every other module depends on it.

---

## Module 2 — Employee Management (Phase 1)

### Purpose
The employee master: one profile per person holding identity, job, org placement, and lifecycle status. Everything else (attendance, leave, payroll, documents) hangs off `employees.id`.

### Features
- Employee CRUD with soft delete (P1)
- Profile sections: personal, contact, job (department/designation/location/manager/shift), employment type, dates (join, probation end, confirmation), status lifecycle (P1)
- Manager assignment (self-referential `manager_id`) (P1)
- Emergency contacts (P1)
- Bank accounts (P2 — payroll dependency; masked display, restricted access)
- User-account linking + invite from employee record (P1)
- Employee code auto-generation, unique per company (P1)
- Status lifecycle: `onboarding → active → on_notice → exited` (P1; `on_notice`/`exited` transitions driven by Offboarding in P2, manual in P1)
- Bulk CSV import (P2)

### User roles involved
- `employee`: view own full profile; edit a limited self-service field set (phone, address, emergency contacts, photo).
- `manager`: view direct reports' work profiles (no salary/bank/ID numbers).
- `hr_admin`: full CRUD, status transitions, exports.

### Main screens
`/hr/employees` (list), `/hr/employees/[id]` (detail with tabs: Overview, Job, Documents P2, Attendance, Leave, Salary P2, History), `/me/profile`.

### Main actions
create, edit, change-status, assign-manager, assign-shift, invite-user, deactivate (disables `users` row too), export CSV.

### Approval workflows
None in-module. Self-service edits to non-sensitive fields apply immediately; sensitive identity changes (name, DOB, IDs) are HR-only. (A field-change-approval flow is deliberately out of scope — HR performs sensitive edits.)

### Required database entities
`employees`, `emergency_contacts`, `employee_bank_accounts`, `users`, `departments`, `designations`, `locations`, `audit_logs`.

### Dependencies
Company & Organization (company, locations), Departments & Designations, Authentication (user linking).

---

## Module 3 — Company & Organization (Phase 1)

### Purpose
The tenant root. Holds company identity and org-wide defaults every module reads: timezone, currency, working week, leave-year start.

### Features
- Company profile: name, legal name, logo, address, contact (P1)
- Org defaults: timezone, currency (char(3)), date format, default week-off pattern, leave year start month (P1)
- Locations CRUD (offices/branches; each employee belongs to one) (P1)
- Company provisioning for new tenants (P3 — until then a single seeded company)

### User roles involved
- `hr_admin`: edit company profile and defaults (company scope).
- `super_admin`: create companies, global settings.
- All: read basics (name/logo in shell).

### Main screens
`/admin/company`, `/admin/locations`.

### Main actions
edit-company, upload-logo, create/edit/delete location.

### Approval workflows
None. All changes audit-logged.

### Required database entities
`companies`, `locations`, `system_settings`.

### Dependencies
None (root). Everything depends on it via `company_id`.

---

## Module 4 — Departments & Designations (Phase 1)

### Purpose
Org structure (where you sit) and job title/level (what you are). Both are reporting dimensions for every report and dashboard.

### Features
- Department CRUD: name, code (unique per company), optional department head (employee) (P1)
- Designation CRUD: title, code, level (int, for ordering/grading) (P1)
- Soft delete with guard: cannot delete while active employees are assigned (P1)
- Nested department tree (P3)

### User roles involved
- `hr_admin`: full CRUD.
- `manager`/`employee`: read (their own placement, org directory).

### Main screens
`/hr/departments` (departments + designations tabs; also linked from `/admin`).

### Main actions
create, edit, soft-delete, assign-head.

### Approval workflows
None.

### Required database entities
`departments`, `designations`, `employees` (head reference, assignment).

### Dependencies
Company & Organization. Employee Management consumes both.

---

## Module 5 — Attendance (Phase 1)

### Purpose
Trustworthy daily presence records: raw punches, computed daily status, correction flow, and a month lock that makes data payroll-safe.

### Features
- Web check-in / check-out (multiple punch pairs per day allowed → breaks) (P1)
- `attendance_punches`: immutable raw events (`in`/`out`, timestamp, source `web|mobile|manual|biometric`) (P1; biometric source arrives P3)
- `attendance_records`: one row per employee per date — computed status `present|absent|half_day|on_leave|holiday|week_off`, worked minutes, late minutes, overtime minutes (P1)
- Nightly calculation job: builds/updates records for the previous day from punches + shift + approved leave + holidays + week-offs (P1)
- Rules (canonical): late if first check-in > shift.start_time + grace_minutes; half_day if worked < half_day_threshold_minutes; overtime = worked minutes beyond shift duration, payable only when approved (P1 capture/approve; P2 payout via payroll)
- Corrections (regularization): employee raises `attendance_corrections` (missed punch, wrong status) → manager approves → record recomputed (P1)
- Manual entry by HR (source `manual`, audit-logged) (P1)
- Month lock: HR locks a month per company; locked days reject punches edits and corrections (P1)
- Missing check-out detection + notification (P1)

### User roles involved
- `employee`: check-in/out, view own calendar/summary, raise corrections.
- `manager`: team day/month views, approve/reject corrections of direct reports.
- `hr_admin`: all views, manual entries, force-approve, lock month, export.

### Main screens
`/me/attendance` (today card + month calendar), `/team/attendance` (team day grid + pending corrections), `/hr/attendance` (company view, filters, lock control).

### Main actions
check-in, check-out, request-correction, approve/reject-correction, manual-entry, lock-month, export.

### Approval workflows
Correction: employee submits (`pending`) → manager of the employee approves/rejects (`approved|rejected`); employee may `cancel` while pending; `hr_admin` may approve/override any. Approval triggers recomputation of that day's record. Locked month blocks the whole flow (422 BUSINESS_RULE).

### Required database entities
`attendance_punches`, `attendance_records`, `attendance_corrections`, `shifts`, `employee_shifts`, `holidays`, `leave_requests` (read), `employees`.

### Dependencies
Shift Management (rules), Leave Management (on_leave status), Holiday Management, Employee Management. Payroll (P2) consumes locked months.

---

## Module 6 — Shift Management (Phase 1 basic, Phase 2 rostering)

### Purpose
Define working-time rules that attendance calculation evaluates against, and assign them to employees over time.

### Features
- Shift definitions: name, code, start_time, end_time (overnight-capable), grace_minutes, half_day_threshold_minutes, break_minutes (unpaid, deducted from worked), week-off pattern (array of weekdays) (P1)
- Default company shift (seeded; new employees auto-assigned) (P1)
- Assignment with effective dates: `employee_shifts` (employee, shift, effective_from, effective_to nullable) — history preserved, one active assignment per employee per date (P1)
- Rotating rosters / bulk assignment calendar (P2)

### User roles involved
- `hr_admin`: CRUD shifts, assign employees.
- `manager`: view team shifts.
- `employee`: view own shift.

### Main screens
Shift list + form inside `/hr/attendance` settings area; assignment from employee detail Job tab.

### Main actions
create/edit/delete shift, assign-shift (with effective_from), end-assignment.

### Approval workflows
None. Assignment changes audit-logged (they change pay-relevant attendance math).

### Required database entities
`shifts`, `employee_shifts`, `employees`.

### Dependencies
Company & Organization (defaults). Attendance depends on this module.

---

## Module 7 — Leave Management (Phase 1)

### Purpose
Policy-driven leave: types, accrual rules, live balances, and an approval workflow employees trust.

### Features
- Leave types: name, code, paid/unpaid flag, color (P1). Seeded defaults: Casual, Sick, Earned/Privilege, Unpaid (LWP); Comp-off (P2).
- Leave policies per type: accrual frequency (`monthly|yearly|none`), accrual amount, max carry-forward, max negative balance (default 0), min notice days, max consecutive days, applicable after probation flag, sandwich rule flag (P1)
- Sandwich rule (configurable, default off): holidays/week-offs falling **inside** a leave span count as leave days; adjacent ones never count (P1)
- Balances: `leave_balances` per (employee, leave_type, year) — opening, accrued, used, carried_forward, current (P1)
- Monthly accrual cron per policy; proration for mid-year joiners (join month counts if joined on/before the 15th — company setting) (P1)
- Year-end carry-forward job (caps applied per policy) (P1)
- Requests: date range, half-day flag (first/second half) for single-day requests, reason, attachment (sick note) optional (P1)
- Working-days computation for a request: excludes holidays/week-offs unless sandwich rule applies (P1)
- Overlap prevention against existing pending/approved requests (P1)
- Cancellation: pending → by employee; approved → allowed before start date (restores balance), else HR only (P1)
- HR adjustment (manual credit/debit with reason, audit-logged) (P1)

### User roles involved
- `employee`: view balances/history, submit, cancel.
- `manager`: approve/reject direct reports' requests, team leave calendar.
- `hr_admin`: everything, on-behalf submission, adjustments, policy management.

### Main screens
`/me/leave` (balances cards + request list + apply dialog), `/team/leave-approvals`, `/hr/leave` (all requests, balances, types/policies settings).

### Main actions
apply, approve, reject, cancel, adjust-balance, manage-types, manage-policies.

### Approval workflows
Request: `pending` → manager approve (`approved`, balance deducted) | reject (`rejected`) | employee cancel (`cancelled`). Approved → `cancelled` (before start, or HR override) restores balance. Approver must not be the requester; `leave.approve` + team scope required (HR bypasses team scope). Balance sufficiency checked at submit **and** re-checked at approval.

### Required database entities
`leave_types`, `leave_policies`, `leave_balances`, `leave_requests`, `holidays`, `employees`, `notifications`, `audit_logs`.

### Dependencies
Holiday Management (day counting), Employee Management (probation, manager), Attendance (marks `on_leave`), Notifications.

---

## Module 8 — Holiday Management (Phase 1)

### Purpose
Company holiday calendar consumed by attendance calculation, leave day-counting, and dashboards.

### Features
- Holiday CRUD: name, date, optional location_id (null = company-wide) (P1)
- Year view + upcoming-holidays widget (P1)
- Optional/floating holidays (employee picks N from a pool) (P2)
- Bulk import for a year (P2)

### User roles involved
- `hr_admin`: CRUD.
- All: view calendar.

### Main screens
Holidays tab under `/hr/leave` (admin) ; upcoming-holidays widget on `/dashboard`.

### Main actions
create, edit, delete, filter-by-location/year.

### Approval workflows
None.

### Required database entities
`holidays`, `locations`.

### Dependencies
Company & Organization (locations). Attendance and Leave consume it.

---

## Decisions made in this document

- Multiple punch pairs per day are allowed; worked minutes = sum of in→out intervals; breaks are implicit gaps (plus fixed unpaid `break_minutes` on the shift).
- Missing check-out: nightly job marks the day `present` with worked minutes to shift end minus a company-configurable penalty of 0 by default, flags the record `needs_review = true`, and notifies the employee to file a correction.
- Employee self-editable profile fields fixed set: phone, personal email, address, photo, emergency contacts. Everything else HR-only.
- Half-day leave allowed only on single-day requests (first/second half).
- Leave balance check uses the balance of the year containing the leave start date.
- Delete guards: departments/designations/shifts/leave types/locations cannot be soft-deleted while referenced by active employees or open records — 409 CONFLICT.
