# HRMS Blueprint — Database Schema & Multi-Tenant Model

> Document 04 of 11. **Canonical for all data shapes.** Where any other doc disagrees with this one on tables/columns/enums, this doc wins.

---

## 1. Conventions

- PostgreSQL 16, Prisma ORM, `prisma migrate`.
- Tables: snake_case plural. PK: `id uuid` (default `gen_random_uuid()`).
- **`company_id uuid NOT NULL`** on every tenant-scoped table (all tables below except `roles`, `permissions`, `role_permissions` global seeds — see notes — and global `system_settings` rows). Always indexed; member of scoped unique keys `(company_id, code)`.
- `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL` (Prisma `@updatedAt`) on **all** tables. Not repeated per table below.
- Soft delete: `deleted_at timestamptz NULL` on master/people data only (marked ⚑SD below). Transactional/immutable rows (attendance, payslips, audit, notifications) never soft-delete — status fields instead.
- Money: `bigint` integer minor units; currency lives on `companies.currency char(3)`.
- Dates: `date` for calendar days, `timestamptz` (UTC) for instants, `time` for shift times.
- Enum columns implemented as Postgres enums via Prisma; values are canonical (listed per table).
- FK on-delete default: `RESTRICT` (protect history); exceptions noted.

---

## 2. Schema

### 2.1 Org

**companies** — tenant root. ⚑SD
| column | type | null | notes |
|---|---|---|---|
| id | uuid | no | PK |
| name | varchar(160) | no | display name |
| legal_name | varchar(200) | yes | |
| slug | varchar(60) | no | UNIQUE (platform-wide) |
| logo_key | varchar(255) | yes | storage key |
| address | text | yes | |
| contact_email | varchar(160) | yes | |
| timezone | varchar(64) | no | IANA, default 'Asia/Kolkata' |
| currency | char(3) | no | default 'INR' |
| status | enum | no | `active\|suspended` |
Indexes: `slug` unique. (No company_id — it *is* the tenant.)

**locations** — offices/branches. ⚑SD
id PK; company_id FK→companies; name varchar(120); code varchar(30); address text null; timezone varchar(64) null (falls back to company).
Unique `(company_id, code)`. Index `(company_id)`.

**departments** — org units. ⚑SD
id PK; company_id FK; name varchar(120); code varchar(30); head_employee_id uuid null FK→employees (SET NULL).
Unique `(company_id, code)`. Index `(company_id)`.

**designations** — job titles. ⚑SD
id PK; company_id FK; title varchar(120); code varchar(30); level int no default 1.
Unique `(company_id, code)`. Index `(company_id, level)`.

**system_settings** — key/value config.
id PK; company_id uuid **null** FK (null = global default); key varchar(120); value jsonb; updated_by uuid null FK→users.
Unique `(company_id, key)` (Postgres: use `COALESCE` unique index or partial unique for null company_id). Index `(key)`.

### 2.2 Auth

**users** — login identity (not every employee must have one immediately).
id PK; company_id FK; email varchar(160); password_hash varchar(255) null (null until invite accepted); status enum `invited|active|disabled`; session_version int no default 1 (bump = logout everywhere); failed_login_count int default 0; locked_until timestamptz null; last_login_at timestamptz null.
Unique `(company_id, email)`; global unique index on `lower(email)` (login has no company context pre-auth). Index `(company_id, status)`.

**roles** — role definitions. Seeded per company (system roles) with `is_system=true`.
id PK; company_id FK; name varchar(60) (`super_admin|hr_admin|manager|employee` + custom P3); description text null; is_system bool default false.
Unique `(company_id, name)`.

**permissions** — global catalog (no company_id; platform-defined).
id PK; code varchar(80) UNIQUE (`module.action`); module varchar(40); action varchar(20); description text null.

**role_permissions** — grant mapping.
id PK; role_id FK→roles (CASCADE); permission_id FK→permissions (CASCADE).
Unique `(role_id, permission_id)`. Tenant scoping inherited through role.

**user_roles** — user↔role.
id PK; user_id FK→users (CASCADE); role_id FK→roles (CASCADE); assigned_by uuid null FK→users.
Unique `(user_id, role_id)`.

**password_reset_tokens** — reset + invite tokens.
id PK; user_id FK→users (CASCADE); token_hash varchar(255) (SHA-256 of token; raw never stored); kind enum `reset|invite`; expires_at timestamptz; used_at timestamptz null.
Index `(user_id)`, `(token_hash)` unique.

### 2.3 People

**employees** — the master. ⚑SD
| column | type | null | notes |
|---|---|---|---|
| id | uuid | no | PK |
| company_id | uuid | no | FK |
| user_id | uuid | yes | FK→users, UNIQUE (one employee per user) |
| candidate_id | uuid | yes | FK→candidates (recruitment origin) |
| employee_code | varchar(30) | no | auto-generated |
| first_name / last_name | varchar(80) | no/yes | |
| work_email | varchar(160) | yes | |
| personal_email | varchar(160) | yes | |
| phone | varchar(30) | yes | |
| date_of_birth | date | yes | |
| gender | enum | yes | `male\|female\|other\|undisclosed` |
| address | text | yes | |
| photo_key | varchar(255) | yes | storage |
| department_id / designation_id / location_id | uuid | no | FKs (RESTRICT) |
| manager_id | uuid | yes | FK→employees self-ref (SET NULL) |
| employment_type | enum | no | `full_time\|part_time\|contract\|intern` |
| status | enum | no | `onboarding\|active\|on_notice\|exited` |
| join_date | date | no | |
| probation_end_date | date | yes | |
| confirmation_date | date | yes | |
| exit_date | date | yes | |
| notice_period_days | int | yes | overrides company default |
Unique `(company_id, employee_code)`; Indexes `(company_id, status)`, `(company_id, department_id)`, `(manager_id)`, `(user_id)`.

**employee_bank_accounts** — payout details (sensitive; column-encrypt account_number). ⚑SD
id PK; company_id FK; employee_id FK→employees (CASCADE); account_holder varchar(120); account_number_enc bytea; ifsc_or_swift varchar(20); bank_name varchar(120); is_primary bool default true.
Index `(employee_id)`. Partial unique `(employee_id) WHERE is_primary`.

**emergency_contacts** — ⚑SD
id PK; company_id FK; employee_id FK (CASCADE); name varchar(120); relationship varchar(60); phone varchar(30); is_primary bool default false.
Index `(employee_id)`.

### 2.4 Time

**shifts** — working-time rules. ⚑SD
id PK; company_id FK; name varchar(80); code varchar(30); start_time time; end_time time (may be < start_time = overnight); grace_minutes int default 10; half_day_threshold_minutes int; break_minutes int default 0; week_off_days int[] (0=Sun…6=Sat) default `{0,6}`; is_default bool default false.
Unique `(company_id, code)`. Partial unique `(company_id) WHERE is_default`.

**employee_shifts** — assignment history.
id PK; company_id FK; employee_id FK (CASCADE); shift_id FK→shifts; effective_from date; effective_to date null.
Index `(employee_id, effective_from)`. App-enforced: no overlapping ranges per employee (exclusion constraint `EXCLUDE USING gist` optional hardening).

**attendance_punches** — immutable raw events.
id PK; company_id FK; employee_id FK; punched_at timestamptz; direction enum `in|out`; source enum `web|mobile|biometric|manual`; note varchar(255) null; created_by uuid null FK→users (manual entries).
Index `(company_id, employee_id, punched_at)`. No soft delete; corrections supersede.

**attendance_records** — one per employee per date (computed).
id PK; company_id FK; employee_id FK; work_date date; status enum `present|absent|half_day|on_leave|holiday|week_off`; source enum `web|mobile|biometric|manual`; first_in timestamptz null; last_out timestamptz null; worked_minutes int default 0; late_minutes int default 0; overtime_minutes int default 0; overtime_approved bool default false; overtime_approved_by uuid null FK→users; needs_review bool default false; locked bool default false.
Unique `(company_id, employee_id, work_date)`. Indexes `(company_id, work_date)`, `(company_id, work_date, status)`.

**attendance_corrections** — regularization requests.
id PK; company_id FK; employee_id FK; work_date date; requested_in timestamptz null; requested_out timestamptz null; requested_status enum(attendance status) null; reason text; status enum `pending|approved|rejected|cancelled`; reviewed_by uuid null FK→users; reviewed_at timestamptz null; review_note text null.
Indexes `(company_id, status)`, `(employee_id, work_date)`.

**attendance_month_locks** *(additional)* — payroll-safe month freeze.
id PK; company_id FK; year int; month int; locked_by FK→users; locked_at timestamptz.
Unique `(company_id, year, month)`.

### 2.5 Leave

**leave_types** — ⚑SD
id PK; company_id FK; name varchar(80); code varchar(20); is_paid bool; color varchar(9) null; requires_attachment bool default false.
Unique `(company_id, code)`.

**leave_policies** — accrual rules per type.
id PK; company_id FK; leave_type_id FK (CASCADE); accrual_frequency enum `monthly|yearly|none`; accrual_amount numeric(5,2); max_carry_forward numeric(5,2) default 0; max_negative numeric(5,2) default 0; min_notice_days int default 0; max_consecutive_days int null; applicable_after_probation bool default false; sandwich_rule bool default false.
Unique `(company_id, leave_type_id)` (one active policy per type; revisions overwrite + audit).

**leave_balances** — per employee/type/year.
id PK; company_id FK; employee_id FK (CASCADE); leave_type_id FK; year int; opening numeric(5,2) default 0; accrued numeric(5,2) default 0; used numeric(5,2) default 0; carried_forward numeric(5,2) default 0; adjusted numeric(5,2) default 0 (manual HR +/-); current numeric(5,2) GENERATED/maintained = opening+accrued+carried_forward+adjusted−used.
Unique `(company_id, employee_id, leave_type_id, year)`. Index `(employee_id, year)`.

**leave_requests**
id PK; company_id FK; employee_id FK; leave_type_id FK; start_date date; end_date date; half_day enum `none|first_half|second_half` default none; days numeric(4,2) (computed working days); reason text; attachment_key varchar(255) null; status enum `pending|approved|rejected|cancelled`; approver_id uuid null FK→employees (resolved manager at submit); reviewed_by uuid null FK→users; reviewed_at timestamptz null; review_note text null.
Indexes `(company_id, status)`, `(employee_id, start_date)`, `(approver_id, status)`.

**holidays**
id PK; company_id FK; location_id uuid null FK (null = company-wide); name varchar(120); holiday_date date; is_optional bool default false (P2).
Unique `(company_id, location_id, holiday_date, name)`. Index `(company_id, holiday_date)`.

### 2.6 Payroll (Phase 2 tables, in schema from day 1 migrations set 2)

**salary_components** — ⚑SD
id PK; company_id FK; name varchar(80); code varchar(30); kind enum `earning|deduction`; calc_type enum `fixed|percentage`; percent_of_component_id uuid null FK→salary_components (base, e.g. BASIC); default_value bigint null (minor units or basis points for percentage); taxable bool default true; statutory bool default false; display_order int default 0.
Unique `(company_id, code)`.

**salary_structures** — templates. ⚑SD
id PK; company_id FK; name varchar(80); description text null.
Unique `(company_id, name)`.

**salary_structure_components**
id PK; company_id FK; structure_id FK (CASCADE); component_id FK→salary_components; value bigint (minor units, or basis points if percentage).
Unique `(structure_id, component_id)`.

**employee_salaries** — assignment + revision history.
id PK; company_id FK; employee_id FK; structure_id uuid null FK; annual_ctc bigint; components jsonb (resolved `[ {component_id, code, kind, monthly_amount} ]` snapshot); effective_from date; effective_to date null; created_by FK→users.
Index `(employee_id, effective_from)`. App-enforced non-overlap.

**payroll_runs**
id PK; company_id FK; year int; month int; status enum `draft|processing|pending_approval|approved|paid`; period_days int; input_snapshot jsonb null (per-employee attendance/leave summary at processing); created_by FK→users; approved_by uuid null FK→users; approved_at timestamptz null; paid_at timestamptz null.
Unique `(company_id, year, month)`. Index `(company_id, status)`.

**payslips** — immutable after publish.
id PK; company_id FK; payroll_run_id FK (CASCADE while draft; RESTRICT conceptually after approve — enforced in app); employee_id FK; period_days int; payable_days numeric(4,1); lop_days numeric(4,1); gross bigint; total_deductions bigint; net bigint; status enum `draft|published|paid`; pdf_key varchar(255) null; published_at timestamptz null.
Unique `(payroll_run_id, employee_id)`. Index `(employee_id)`, `(company_id, status)`.

**payslip_items** — line items.
id PK; company_id FK; payslip_id FK (CASCADE); component_code varchar(30); component_name varchar(80); kind enum `earning|deduction`; amount bigint; display_order int.
Index `(payslip_id)`.

### 2.7 Documents

**document_categories** — ⚑SD
id PK; company_id FK; name varchar(80); code varchar(30); employee_uploadable bool default false; expiry_required bool default false; manager_visible bool default false; system_managed bool default false (e.g. payslip).
Unique `(company_id, code)`.

**documents** — metadata; file in object storage. ⚑SD
id PK; company_id FK; category_id FK; employee_id uuid null FK (null = company-level doc); name varchar(160); file_key varchar(255); mime_type varchar(120); size_bytes bigint; expiry_date date null; status enum `active|expired|archived`; uploaded_by FK→users; verified_by uuid null FK→users; verified_at timestamptz null.
Indexes `(company_id, category_id)`, `(employee_id)`, `(company_id, expiry_date) WHERE expiry_date IS NOT NULL`.

### 2.8 Recruitment (Phase 2)

**job_postings** — ⚑SD
id PK; company_id FK; title varchar(160); department_id FK; designation_id FK; location_id FK; openings int default 1; employment_type enum(as employees); description text; salary_min / salary_max bigint null (internal); status enum `draft|open|on_hold|closed`; published_at timestamptz null.
Index `(company_id, status)`.

**candidates** — ⚑SD
id PK; company_id FK; first_name varchar(80); last_name varchar(80) null; email varchar(160); phone varchar(30) null; resume_key varchar(255) null; source enum `referral|portal|agency|direct`; notes text null.
Unique `(company_id, email)`. Index `(company_id)`.

**applications**
id PK; company_id FK; candidate_id FK (CASCADE); job_posting_id FK (CASCADE); stage enum `applied|screening|interview|offer|hired|rejected`; rejection_reason text null; stage_changed_at timestamptz.
Unique `(candidate_id, job_posting_id)`. Index `(company_id, job_posting_id, stage)`.

**interviews**
id PK; company_id FK; application_id FK (CASCADE); round_name varchar(80); scheduled_at timestamptz; mode enum `onsite|video|phone`; interviewer_employee_id FK→employees; status enum `scheduled|completed|cancelled`; feedback text null; rating int null (1–5); recommendation enum `strong_yes|yes|no|strong_no` null.
Index `(application_id)`, `(interviewer_employee_id, scheduled_at)`.

**offers**
id PK; company_id FK; application_id FK UNIQUE; designation_id FK; annual_ctc bigint; joining_date date; expires_on date; status enum `draft|sent|accepted|declined|withdrawn`; letter_key varchar(255) null; approved_by uuid null FK→users; sent_at / responded_at timestamptz null.
Index `(company_id, status)`.

### 2.9 Boarding (Phase 2)

**onboarding_templates** — shared by on/offboarding via `kind`. ⚑SD
id PK; company_id FK; name varchar(120); kind enum `onboarding|offboarding`; description text null.
Unique `(company_id, name, kind)`.

**onboarding_template_tasks**
id PK; company_id FK; template_id FK (CASCADE); title varchar(160); description text null; assignee_kind enum `hr|it|manager|new_hire`; due_offset_days int default 0; required bool default true; sort_order int.
Index `(template_id)`.

**onboarding_tasks** — instantiated checklist items.
id PK; company_id FK; employee_id FK (CASCADE); template_task_id uuid null FK; title varchar(160); description text null; assignee_user_id FK→users; due_date date; required bool; status enum `pending|completed|skipped`; completed_by uuid null FK→users; completed_at timestamptz null; skip_reason text null.
Indexes `(employee_id, status)`, `(assignee_user_id, status)`.

**offboarding_requests**
id PK; company_id FK; employee_id FK UNIQUE-active (partial unique `WHERE status NOT IN ('completed')`); reason text; requested_last_day date; notice_period_days int; last_working_day date null; status enum `initiated|in_progress|cleared|settled|completed`; approved_by_manager uuid null FK→users; confirmed_by_hr uuid null FK→users; settlement jsonb null (leave encashment days/amount, recoveries, notice shortfall); completed_at timestamptz null.
Index `(company_id, status)`.

**offboarding_tasks** — same shape as onboarding_tasks with offboarding_request_id FK (CASCADE) instead of employee-only link.
id PK; company_id FK; offboarding_request_id FK; title; description; assignee_user_id FK; due_date; required bool; blocking bool default false (blocks `cleared`); status enum `pending|completed|skipped`; completed_by/at; skip_reason.
Index `(offboarding_request_id, status)`.

### 2.10 Performance (Phase 2)

**performance_cycles** — ⚑SD
id PK; company_id FK; name varchar(80); period_start date; period_end date; review_deadline date; status enum `draft|active|review|closed`.
Unique `(company_id, name)`.

**goals**
id PK; company_id FK; employee_id FK; cycle_id uuid null FK; title varchar(160); description text null; weight int default 0 (percent); progress int default 0 (0–100); status enum `not_started|in_progress|completed|cancelled`; approved_by uuid null FK→users.
Index `(employee_id, cycle_id)`.

**performance_reviews**
id PK; company_id FK; cycle_id FK; employee_id FK; self_rating int null; self_comments text null; self_submitted_at timestamptz null; manager_rating int null; manager_comments text null; manager_submitted_at timestamptz null; final_rating int null; status enum `pending_self|pending_manager|completed`.
Unique `(cycle_id, employee_id)`. Index `(company_id, status)`.

### 2.11 Training (Phase 3)

**courses** — ⚑SD
id PK; company_id FK; title varchar(160); description text; category varchar(60) null; mandatory bool default false; deadline_days int null; status enum `draft|published|archived`.
Index `(company_id, status)`.

**lessons**
id PK; company_id FK; course_id FK (CASCADE); title varchar(160); content_type enum `text|video|file`; body text null; media_key varchar(255) null; duration_minutes int null; sort_order int.
Index `(course_id, sort_order)`.

**training_enrollments**
id PK; company_id FK; course_id FK; employee_id FK; status enum `enrolled|in_progress|completed`; progress int default 0; due_date date null; completed_at timestamptz null; score int null; completed_lesson_ids uuid[] default '{}'.
Unique `(course_id, employee_id)`. Index `(employee_id, status)`.

**certificates**
id PK; company_id FK; enrollment_id FK UNIQUE; employee_id FK; course_id FK; certificate_no varchar(40) UNIQUE(platform); pdf_key varchar(255); issued_at timestamptz.

### 2.12 Expenses (Phase 2)

**expense_categories** — ⚑SD
id PK; company_id FK; name varchar(80); code varchar(30); per_claim_limit bigint null; receipt_required bool default true.
Unique `(company_id, code)`.

**expenses**
id PK; company_id FK; employee_id FK; category_id FK; amount bigint; expense_date date; description text; receipt_keys jsonb default '[]' (array of storage keys); status enum `draft|submitted|approved|rejected|reimbursed`; reviewed_by uuid null FK→users; reviewed_at timestamptz null; review_note text null; reimbursement_id uuid null FK→reimbursements.
Indexes `(company_id, status)`, `(employee_id, expense_date)`.

**reimbursements**
id PK; company_id FK; employee_id FK; total_amount bigint; method enum `payroll|bank_transfer|cash`; reference varchar(120) null; paid_at timestamptz null; payroll_run_id uuid null FK; created_by FK→users.
Index `(employee_id)`.

### 2.13 Comms

**notifications** — per-recipient rows; no soft delete.
id PK; company_id FK; user_id FK (CASCADE); type varchar(60) (event key); title varchar(160); body text; link varchar(255) null; read_at timestamptz null.
Indexes `(user_id, read_at)`, `(user_id, created_at DESC)`.

**announcements** — ⚑SD
id PK; company_id FK; title varchar(160); body_html text (sanitized server-side); audience enum `company|department`; department_id uuid null FK; published_at timestamptz null; created_by FK→users.
Index `(company_id, published_at DESC)`.

**announcement_reads**
id PK; company_id FK; announcement_id FK (CASCADE); user_id FK (CASCADE); read_at timestamptz.
Unique `(announcement_id, user_id)`.

### 2.14 Ops

**audit_logs** — append-only (app DB role: INSERT + SELECT only).
id PK (uuid v7 preferred for time-ordering); company_id FK; actor_user_id uuid null FK (null = system job); action varchar(80) (`module.action` verb); entity_type varchar(60); entity_id uuid null; before jsonb null; after jsonb null; ip inet null; user_agent varchar(255) null; created_at timestamptz.
Indexes `(company_id, created_at DESC)`, `(company_id, entity_type, entity_id)`, `(actor_user_id, created_at DESC)`. No updated_at (immutable).

---

## 3. Relationship narrative

- **Company → everything**: `companies` is the tenant root; `locations`, `departments`, `designations`, and every operational table carry `company_id`. Company → Departments → Employees is the primary org drill-down (department FK on employee; department optionally points back to a head employee).
- **User ↔ Employee**: `employees.user_id` (unique, nullable) — an employee may exist before being invited; a user always belongs to one company; roles attach to the user, not the employee.
- **Employee → manager**: self-referential `manager_id` defines the team tier used by all `view_team` permissions and approval routing.
- **Employee → time**: one `attendance_records` row per day (unique employee+date), derived from many `attendance_punches`; `attendance_corrections` reference the day and, when approved, trigger recomputation; `employee_shifts` supplies the shift rules effective on that date; `attendance_month_locks` freezes months.
- **Employee → leave**: `leave_balances` (per type/year) are mutated only by accrual jobs, approval/cancellation of `leave_requests`, and audited HR adjustments; requests resolve day counts against `holidays` + shift week-offs.
- **Employee → money**: `employee_salaries` (versioned by effective dates) feed `payroll_runs`, which emit one `payslips` row per employee with `payslip_items` lines; expenses may flow into a run via `reimbursements.payroll_run_id`.
- **Recruitment chain**: `candidates` ×`job_postings` → `applications` (stage machine) → `interviews` (n per application) → `offers` (1 per application) → on accept, an `employees` row is created carrying `candidate_id` provenance → onboarding tasks instantiate.
- **Boarding chains**: `onboarding_templates` (+template tasks, kind-discriminated) instantiate into `onboarding_tasks` (join-date offsets) or `offboarding_tasks` (linked to an `offboarding_requests` row that drives the exit state machine and final settlement handoff).
- **Performance & training**: `performance_reviews` unique per (cycle, employee) with goals optionally cycle-linked; `training_enrollments` unique per (course, employee) with `certificates` 1:1 on completion.
- **Comms**: `notifications` are per-user fanout rows; `announcements` broadcast with `announcement_reads` receipts.
- **audit_logs** uses polymorphic `entity_type` + `entity_id` — no FK, by design (logs must survive entity deletion); `before/after` jsonb captures diffs.

---

## 4. Multi-tenant model

### 4.1 Strategy: shared database, shared schema, `company_id` column

Chosen over schema-per-tenant (migration fan-out pain) and DB-per-tenant (operational overkill pre-scale). Compare: column strategy needs rigorous scoping — delivered by two independent layers below. Migration cost stays O(1) per release regardless of tenant count.

### 4.2 Layer 1 — tenant-scoped Prisma client (app layer, primary)

A Prisma client extension wraps every model operation:
```
// pseudo-code
const tenantDb = (companyId) => prisma.$extends({
  query: { $allModels: {
    $allOperations({ model, operation, args, query }) {
      if (TENANT_MODELS.has(model)) {
        args.where = { AND: [args.where ?? {}, { company_id: companyId }] }
        if (operation.startsWith('create')) args.data.company_id = companyId
      }
      return query(args)
    },
  }},
})
```
- Request context resolves `companyId` from the authenticated session **server-side** (never from client input).
- The raw unscoped client is exported only as `adminDb` and is importable only by `super_admin` platform services (lint rule + code review gate).

### 4.3 Layer 2 — PostgreSQL RLS (defense-in-depth)

Every tenant table gets RLS enabled from the first migration; each request's transaction sets `SET LOCAL app.company_id = '<uuid>'` (and `app.is_super_admin`):

```sql
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON employees
  USING (company_id = current_setting('app.company_id')::uuid
         OR current_setting('app.is_super_admin', true) = 'on');

-- identical policies on leave_requests, payslips, etc.
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payslips
  USING (company_id = current_setting('app.company_id')::uuid
         OR current_setting('app.is_super_admin', true) = 'on');

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON audit_logs FOR SELECT
  USING (company_id = current_setting('app.company_id')::uuid
         OR current_setting('app.is_super_admin', true) = 'on');
CREATE POLICY tenant_insert ON audit_logs FOR INSERT
  WITH CHECK (company_id = current_setting('app.company_id')::uuid);
```
- App connects as a non-superuser role without `BYPASSRLS`.
- If the app layer ever leaks a query without scoping, RLS returns zero rows instead of another tenant's data.
- `super_admin` bypass = explicit session flag set only by platform-service code paths.

### 4.4 Why both layers
RLS alone can't express "manager sees only direct reports" cheaply, and app scoping alone is one forgotten `where` away from a breach. App layer = business scoping + good errors; RLS = last-line isolation guarantee. Tenant-isolation tests (two seeded companies, assert zero cross-reads) run in CI against both layers (see `10-roadmap-testing-deployment.md`).

### 4.5 Access tiers on top of tenancy

| Tier | Who | Query shape (inside tenant scope) |
|---|---|---|
| own | employee | `where employee_id = ctx.employeeId` (or `user_id = ctx.userId`) |
| team | manager (`*.view_team`) | `where employee.manager_id = ctx.employeeId` |
| company | HR (`*.view_all`) | no additional filter (tenant scope only) |
| platform | super_admin | `adminDb`, RLS bypass flag; every use audit-logged |

Object-level guards layered in services: approver ≠ requester; manager approvals verify the target's `manager_id`; salary/bank fields stripped from any non-`payroll.*`/non-self serialization (field-level allowlists in DTO mappers).

---

## 5. Seed data

1. Platform: full `permissions` catalog (every module.action used in `08-api.md`).
2. One company (pilot) with timezone/currency defaults.
3. Four system roles for the company + `role_permissions` per the matrix in `00-overview-and-roles.md` §6.4.
4. Default shift (09:30–18:30, grace 10, half-day threshold 240 min, week-off Sat/Sun) marked `is_default`.
5. Leave types Casual/Sick/Earned/Unpaid with policies (e.g., CL 1/month, SL 0.5/month, EL 1.25/month carry-forward ≤ 30, LWP unpaid no accrual).
6. Default document categories (P2 migration), expense categories (P2), settings rows for every `system_settings` key with defaults.
7. One `super_admin` user + one `hr_admin` user (invited state; passwords set via invite links). Dev-only: sample departments/designations/employees fixture behind a `SEED_DEMO=true` flag.

---

## 6. Migration & data lifecycle

- `prisma migrate dev` locally; `prisma migrate deploy` in CI against staging → prod; no `db push` outside prototypes.
- RLS policies and the `EXCLUDE`/partial-unique constraints live in customized migration SQL (Prisma doesn't model them) — committed alongside.
- Destructive migrations (drop/retype) require a two-release expand-contract pattern and a verified backup (checklist in `10-roadmap-testing-deployment.md`).
- Soft-deleted master rows excluded by a default `deleted_at IS NULL` filter in the Prisma extension; hard purges only via retention jobs per `09-security.md` §13.
- Enum growth is additive-only within a phase; renames = new value + backfill + removal across two releases.

---

## Decisions made in this document

- `attendance_month_locks` added (additional table) — cleaner than a boolean scattered on records; `attendance_records.locked` mirrors it for query speed.
- `employee_salaries.components` stores a resolved jsonb snapshot so historical payslips never re-derive from mutated component definitions.
- `permissions` is a global (non-tenant) catalog; `roles` are per-company rows so Phase 3 custom roles need no schema change.
- Login uses a platform-wide unique `lower(email)` index because the login form has no company context; per-company email reuse is therefore not supported (acceptable: one identity per person per platform).
- uuid v7 recommended for `audit_logs` and other high-insert tables for index locality; standard v4 elsewhere.
