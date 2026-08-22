# HRMS Blueprint — Talent & Money Modules (9–16)

> Document 02 of 11. Covers modules: 9 Payroll, 10 Employee Documents, 11 Recruitment, 12 Onboarding, 13 Performance Management, 14 Training/LMS, 15 Expenses & Reimbursements, 16 Employee Self-Service.
> Data shapes: `04-database.md`. Endpoints: `08-api.md`. Screens: `06-ui-ux.md`. Workflows: `07-workflows-and-automation.md`.

---

## Module 9 — Payroll (Phase 2)

### Purpose
Compute pay from locked attendance/leave data, run an approval gate, and publish immutable payslips. Country-agnostic core: statutory items are configuration, not code.

### Features
- **Salary components** (`salary_components`): name, code, kind `earning|deduction`, calc type `fixed|percentage` (percentage of a named base component, typically BASIC), taxable flag, statutory flag, display order (P2). Examples seeded: BASIC, HRA (50% of BASIC), Special Allowance, PF (12% of BASIC, statutory), Professional Tax (fixed, statutory), TDS (manual override field).
- **Salary structures** (`salary_structures` + `salary_structure_components`): reusable templates listing components with default values/percentages (P2)
- **Employee salary assignment** (`employee_salaries`): structure + resolved per-component amounts + annual CTC, `effective_from` / `effective_to` — full revision history, exactly one active row per employee per date (P2)
- **Payroll runs** (`payroll_runs`): one per company per month; lifecycle `draft → processing → pending_approval → approved → paid` (P2)
- Inputs snapshot at `processing`: per employee — period days, payable days, LOP days (unapproved absence + unpaid leave), overtime approved minutes, one-off adjustments (bonus/advance/recovery) (P2)
- Calculation (canonical): payable_days = period_days − LOP_days; each component prorated by payable_days/period_days (statutory percentage components recompute on prorated base); gross = Σ earnings; net = gross − Σ deductions. Money in integer minor units. (P2)
- **Payslips** (`payslips` + `payslip_items`): generated at approval, status `draft → published → paid`; PDF via worker; employee notified on publish (P2)
- Off-cycle adjustments and final settlement runs (offboarding handoff) (P2)
- Statutory country pack (configurable PF/ESI/PT/TDS presets for India, etc.) (P3)

### User roles involved
- `hr_admin`: full module (`payroll.manage`, `payroll.approve` — approval by a second HR user recommended, enforced when >1 exists).
- `employee`: own payslips only (`payroll.view_own`).
- `manager`: **no access** (salary is never team-visible).

### Main screens
`/hr/payroll` (runs list, run wizard: Prepare → Review lines → Approve → Publish; components & structures settings; employee salary tab on employee detail), `/me/payslips`.

### Main actions
manage-components, manage-structures, assign-salary (with effective_from), create-run, process-run, edit-line-adjustments (draft only), submit-for-approval, approve, publish-payslips, mark-paid, download-payslip.

### Approval workflows
Run: `draft` (editable inputs) → `processing` (system computing; locks inputs) → `pending_approval` (review screen; can revert to draft) → `approved` (payslips generated; irreversible) → `paid`. Requires attendance month lock first (422 otherwise). Approver must hold `payroll.approve`.

### Required database entities
`salary_components`, `salary_structures`, `salary_structure_components`, `employee_salaries`, `payroll_runs`, `payslips`, `payslip_items`, `attendance_records` (read), `leave_requests` (read), `employees`, `employee_bank_accounts`.

### Dependencies
Attendance (locked months), Leave (unpaid leave), Employee Management (bank accounts, status), Offboarding (settlement), Notifications, Documents (payslip PDFs in storage).

---

## Module 10 — Employee Documents (Phase 2)

### Purpose
Central, permission-controlled store of employee and company documents with expiry tracking.

### Features
- Categories (`document_categories`): ID proof, contract, certificate, policy, payslip, other; per-category flags: employee-uploadable, expiry-required (P2)
- Upload via presigned URL; metadata row in `documents` (owner employee or company-level, category, name, file key, mime, size, expiry_date nullable, status `active|expired|archived`) (P2)
- Download via short-lived presigned URL after server permission check (P2)
- Expiry automation: daily scan flips status to `expired`, notifies employee + HR at T-30/T-7/T-0 (P2)
- Company documents (policies/handbook) visible to all employees (P2)
- Versioning-by-replacement (old file archived) (P2); e-sign (P3)

### User roles involved
- `employee`: view own + company docs; upload into employee-uploadable categories.
- `manager`: view direct reports' **work** documents (category-flagged), not identity/salary docs.
- `hr_admin`: full CRUD, categories, exports.

### Main screens
`/hr/documents` (all docs, expiring-soon view), `/me/documents`, Documents tab on employee detail.

### Main actions
upload, download, replace, archive, set-expiry, manage-categories.

### Approval workflows
None (uploads are direct). Optional HR verification flag per document (`verified_by`, `verified_at`) — informational, P2.

### Required database entities
`documents`, `document_categories`, `employees`, `notifications`.

### Dependencies
Employee Management; storage service; Notifications (expiry). Payroll writes payslip PDFs as documents (category `payslip`, system-managed).

---

## Module 11 — Recruitment (Phase 2)

### Purpose
Hiring pipeline from job posting to accepted offer, ending in conversion to an employee record.

### Features
- Job postings: title, department, designation, location, openings, employment type, description, salary range (internal-only), status `draft|open|on_hold|closed` (P2)
- Candidates: name, email, phone, resume file, source (`referral|portal|agency|direct`), talent-pool reuse across jobs (P2)
- Applications: candidate × job posting; stage `applied → screening → interview → offer → hired | rejected` (rejection allowed from any stage, with reason) (P2)
- Interviews: per application, round name, scheduled_at, interviewer (employee), mode, feedback text, rating 1–5, recommendation `strong_yes|yes|no|strong_no` (P2)
- Offers: application, designation, proposed CTC (minor units), joining date, expiry date, status `draft|sent|accepted|declined|withdrawn`; offer letter PDF (P2)
- Convert-to-employee: accepted offer → creates `employees` row (status `onboarding`), copies data, links back (P2)
- Public careers page + application form (P3)

### User roles involved
- `hr_admin`: full pipeline management.
- `manager` (as interviewer): sees assigned interviews, submits feedback.
- `employee`: none (referrals P3).

### Main screens
`/hr/recruitment` (jobs list; per-job kanban by stage; candidate drawer; interviews calendar; offers list).

### Main actions
create-job, publish/close-job, add-candidate, move-stage, schedule-interview, submit-feedback, create-offer, send-offer, record-accept/decline, convert-to-employee.

### Approval workflows
Offer requires `recruitment.approve` before `sent` (senior HR gate). Stage transitions are permission-gated (`recruitment.edit`) but not approval flows.

### Required database entities
`job_postings`, `candidates`, `applications`, `interviews`, `offers`, `departments`, `designations`, `locations`, `employees` (interviewers; conversion target).

### Dependencies
Departments & Designations, Employee Management (conversion), Onboarding (triggered post-conversion), Documents (resume/offer files), Notifications.

---

## Module 12 — Onboarding (Phase 2)

### Purpose
Turn a new hire into a productive, fully-set-up employee via reusable task checklists.

### Features
- Templates (`onboarding_templates` + `onboarding_template_tasks`): named checklists; tasks have title, description, assignee role (`hr|it|manager|new_hire`), due offset days from join date, required flag (P2)
- Instantiation: on employee creation (status `onboarding`) HR picks a template → concrete `onboarding_tasks` rows with resolved assignees + due dates (P2)
- Task completion tracking with per-task status `pending|completed|skipped`, completed_by/at (P2)
- Completion gate: when all required tasks complete, HR activates employee (status → `active`) (P2)
- Progress view per new hire + overdue task nudges (P2)

### User roles involved
- `hr_admin`: templates, instantiate, monitor, activate.
- `manager` / `employee` (new hire) / IT (an hr-designated user): complete assigned tasks.

### Main screens
Onboarding tab within `/hr/employees/[id]`; "My tasks" widget on `/dashboard`; template settings under `/hr/employees` settings.

### Main actions
manage-templates, start-onboarding, complete-task, skip-task (with reason), activate-employee.

### Approval workflows
None per task; activation is the implicit gate (requires all required tasks complete, else 422).

### Required database entities
`onboarding_templates`, `onboarding_template_tasks`, `onboarding_tasks`, `employees`, `notifications`.

### Dependencies
Employee Management (status), Recruitment (conversion entry point), Documents (doc-collection tasks link), Notifications.

---

## Module 13 — Performance Management (Phase 2)

### Purpose
Lightweight goal-setting and review cycles: self review + manager review with ratings, per cycle.

### Features
- Cycles (`performance_cycles`): name (e.g., "H1 2027"), period start/end, review deadline, status `draft|active|review|closed` (P2)
- Goals (`goals`): employee, optional cycle, title, description, weight %, progress %, status `not_started|in_progress|completed|cancelled`; manager approval of goal set (P2)
- Reviews (`performance_reviews`): employee × cycle; self_rating + self_comments, manager_rating + manager_comments, final_rating; status `pending_self|pending_manager|completed` (P2)
- Rating scale 1–5 (company-configurable labels) (P2)
- Reminders before review deadline (P2)
- 360° feedback, calibration (P3)

### User roles involved
- `employee`: own goals, self review.
- `manager`: approve goals, manager reviews for direct reports.
- `hr_admin`: cycles, monitor completion, final ratings export.

### Main screens
`/me/performance` (goals + my reviews), `/team/performance` (reports' goals/reviews), `/hr/performance` (cycles admin, completion matrix).

### Main actions
create-cycle, activate-cycle, add-goal, approve-goals, update-progress, submit-self-review, submit-manager-review, close-cycle, export-ratings.

### Approval workflows
Goal set: employee proposes → manager approves (edits allowed before approval). Review chain: `pending_self` → employee submits → `pending_manager` → manager submits → `completed`. HR can reopen a review before cycle close.

### Required database entities
`performance_cycles`, `performance_reviews`, `goals`, `employees`, `notifications`.

### Dependencies
Employee Management (manager chain), Notifications, Reports (ratings distribution).

---

## Module 14 — Training / LMS (Phase 3)

### Purpose
Internal course delivery: content, enrollment, progress, certification.

### Features
- Courses (`courses`): title, description, category, mandatory flag, deadline days (for mandatory), status `draft|published|archived` (P3)
- Lessons (`lessons`): ordered content units — rich text, video URL, file attachment; duration minutes (P3)
- Enrollments (`training_enrollments`): employee × course; status `enrolled|in_progress|completed`; progress % (lessons completed / total); due_date for mandatory; score nullable (P3)
- Self-enroll (open courses) and HR/manager assignment (mandatory) (P3)
- Certificates (`certificates`): generated PDF on completion, verifiable id (P3)
- Quizzes/assessments with pass mark (P3, after core LMS)

### User roles involved
- `employee`: browse, enroll, learn, download certificates.
- `manager`: view team progress, assign courses to reports.
- `hr_admin`: manage courses/lessons, assign, completion reports.

### Main screens
`/me/training` (my courses, player view), `/hr/training` (courses admin, enrollment matrix).

### Main actions
create-course, add-lessons, publish, enroll/assign, mark-lesson-complete, complete-course, issue-certificate, export-completion.

### Approval workflows
None. Mandatory-course overdue drives escalating reminders.

### Required database entities
`courses`, `lessons`, `training_enrollments`, `certificates`, `employees`, `notifications`.

### Dependencies
Employee Management, Notifications, storage (videos/files, certificate PDFs).

---

## Module 15 — Expenses & Reimbursements (Phase 2)

### Purpose
Employee expense claims with receipts, manager approval, and tracked payout.

### Features
- Categories (`expense_categories`): name, per-claim limit (minor units, nullable), receipt-required flag (P2)
- Expenses (`expenses`): employee, category, amount (minor units), expense date, description, receipt file(s); status `draft → submitted → approved | rejected → reimbursed` (P2)
- Approval by manager; HR override; auto-flag over-limit claims (P2)
- Reimbursements (`reimbursements`): payout record — expense(s) grouped, method `payroll|bank_transfer|cash`, paid_at, reference; marking paid flips expenses to `reimbursed` (P2)
- Payroll integration: approved expenses can attach to next payroll run as an earning adjustment (P2)

### User roles involved
- `employee`: create/edit drafts, submit, view history.
- `manager`: approve/reject reports' claims.
- `hr_admin`: override, mark reimbursed, categories, export.

### Main screens
`/me/expenses`, approvals inside `/team` (pending approvals widget), HR expenses view under `/hr/reports` area (expenses report) + admin list.

### Main actions
create-draft, submit, approve, reject (reason required), mark-reimbursed, manage-categories, export.

### Approval workflows
`draft` → employee submits → `submitted` → manager approve → `approved` → HR reimburses → `reimbursed`; reject → `rejected` (employee may duplicate-and-resubmit). Approver ≠ claimant; over-limit requires `hr_admin` approval regardless of manager approval.

### Required database entities
`expense_categories`, `expenses`, `reimbursements`, `employees`, `notifications`.

### Dependencies
Employee Management, Notifications, Payroll (optional payout path), storage (receipts).

---

## Module 16 — Employee Self-Service (Phase 1)

### Purpose
The employee-facing surface: everything an employee can see/do about themselves, in one place. Not a data-owning module — a composition of own-tier permissions over other modules.

### Features (what an employee can do, by module)
| Area | Employee can (own scope) | Phase |
|---|---|---|
| Profile | view full profile; edit phone, personal email, address, photo, emergency contacts | P1 |
| Attendance | check-in/out; month calendar; raise corrections | P1 |
| Leave | balances; apply; cancel; history | P1 |
| Holidays | view calendar | P1 |
| Documents | view own + company docs; upload allowed categories | P2 |
| Payslips | view/download own | P2 |
| Expenses | create, submit, track | P2 |
| Performance | goals, self reviews | P2 |
| Training | enroll, learn, certificates | P3 |
| Notifications | view, mark read | P1 |
| Offboarding | submit resignation, track exit tasks | P2 |
| Settings | change password | P1 |

### User roles involved
`employee` (primary); every user gets ESS regardless of extra roles.

### Main screens
`/dashboard` (widgets: check-in card, leave balances, upcoming holidays, my pending tasks, announcements), all `/me/*` routes.

### Main actions
See table above; all actions delegate to owning modules' services/APIs.

### Approval workflows
Inherited from owning modules (leave, corrections, expenses, resignation).

### Required database entities
None owned; reads/writes through other modules' services.

### Dependencies
All Phase-relevant modules; Notifications.

---

## Decisions made in this document

- Payroll approval: `payroll.approve` should be held by a different user than the run creator when the company has >1 HR user (four-eyes); enforced as a soft rule (warning) in P2, hard setting in P3.
- Percentage salary components resolve against a single named base component (BASIC) to avoid dependency graphs in v1; chained percentages are out of scope.
- Payslip PDFs are stored as `documents` rows (category `payslip`, system-managed, employee-visible, not employee-uploadable).
- Candidate PII kept in `candidates` distinct from `employees`; conversion copies data (no shared row), links via `employees.candidate_id` (nullable).
- Expense multi-receipt support = multiple `documents`-style file keys on the expense row (JSON array of storage keys) rather than a join table, to keep P2 lean.
- Rating scale fixed at 1–5 integers; labels configurable in system settings.
