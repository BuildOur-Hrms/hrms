# HRMS Blueprint — API Specification

> Document 08 of 11. Canonical endpoint catalog. Shapes reference `04-database.md`; workflow guards reference `07-workflows-and-automation.md`.

---

## 1. Conventions

- Base `/api/v1`; plural kebab-case resources. Session-cookie auth (JWT, httpOnly). CSRF: SameSite=Lax cookie **plus** Origin/Referer check on all mutating methods (reject mismatches 403).
- Pipeline per route: authenticate → tenant resolve → `requirePermission` → zod validate → service (see `05-architecture.md` §3).
- Success `{ data, meta? }`; list meta `{ page, pageSize, total }`. Pagination `?page=1&pageSize=20` (max 100). Filtering `?q=&sort=field:asc&from=&to=&departmentId=…`.
- Error `{ error: { code, message, details? } }`.

### Common errors (defined once; apply everywhere)

| HTTP | code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | zod failure; `details` = field map |
| 401 | UNAUTHENTICATED | no/expired session, session_version mismatch |
| 403 | FORBIDDEN | missing permission, scope violation, origin mismatch |
| 404 | NOT_FOUND | id absent **or outside tenant scope** (no existence leak) |
| 409 | CONFLICT | unique violation, delete-guard (referenced rows) |
| 422 | BUSINESS_RULE | workflow guard (named in `details.rule`) |
| 429 | RATE_LIMITED | bucket exceeded; `Retry-After` header |
| 500 | INTERNAL | unexpected; generic message only |

Per-endpoint tables below list only **permission, request essentials, response essentials, and notable 422/409 rules**. CRUD validation (types/lengths/enums) follows `04-database.md` implicitly.

---

## 2. Auth (Phase 1) — public unless noted

| Method & path | Perm | Request | Response | Notable errors |
|---|---|---|---|---|
| POST `/auth/login` | — | email, password | user summary + permissions; sets cookie | 401 generic invalid-credentials; 429; 422 `account_locked`, `account_disabled` |
| POST `/auth/logout` | session | — | ok; clears cookie | |
| POST `/auth/forgot-password` | — | email | always ok (no enumeration) | 429 |
| POST `/auth/reset-password` | — | token, password | ok | 422 `token_invalid_or_expired`, `password_policy` |
| POST `/auth/accept-invite` | — | token, password | ok (activates user) | same as reset |
| GET `/auth/me` | session | — | user, employee summary, roles, permissions, company | |

## 3. Users, roles, permissions (Phase 1)

| Method & path | Perm | Notes |
|---|---|---|
| GET `/users` | `users.view_all` | filters: status, role |
| POST `/users/:id/resend-invite` | `users.manage` | 422 `not_invited_state` |
| POST `/users/:id/disable` / `enable` | `users.manage` | disable bumps session_version; 422 `cannot_disable_self` |
| GET `/roles` | `roles.view_all` | with permission codes |
| POST `/roles` / PATCH `/roles/:id` | `roles.manage` | P3 (custom roles); system roles immutable 422 `system_role` |
| PUT `/roles/:id/permissions` | `roles.manage` | replace grant set; audited |
| GET `/permissions` | `roles.view_all` | global catalog |
| POST `/users/:id/roles` / DELETE `.../roles/:roleId` | `roles.manage` | 422 `last_hr_admin` guard |

## 4. Company, settings, locations (Phase 1)

| Method & path | Perm |
|---|---|
| GET/PATCH `/companies/current` | view: session; PATCH: `company.manage` |
| GET `/settings` · PUT `/settings/:key` | `settings.manage` (global keys: super_admin only → 403) |
| GET/POST `/locations` · PATCH/DELETE `/locations/:id` | view: session; write: `company.manage`; DELETE 409 if employees assigned |

## 5. Departments & designations (Phase 1)

| Method & path | Perm |
|---|---|
| GET/POST `/departments` · PATCH/DELETE `/departments/:id` | view: session; write: `department.manage`; DELETE 409 in-use |
| GET/POST `/designations` · PATCH/DELETE `/designations/:id` | same pattern |

## 6. Employees (Phase 1; bank P2)

| Method & path | Perm | Notes |
|---|---|---|
| GET `/employees` | `employee.view_all` \| `view_team` (auto-scoped) | filters: departmentId, locationId, status, type, q |
| POST `/employees` | `employee.create` | multi-section body; optional `invite:true`; 409 duplicate code/email |
| GET `/employees/:id` | `view_all` \| `view_team`(report) \| `view_own`(self) | DTO strips salary/bank unless self/payroll perms |
| PATCH `/employees/:id` | `employee.edit`; self-service subset via `employee.view_own` (allowlisted fields) | 403 on non-allowlisted self edit |
| POST `/employees/:id/status` | `employee.edit` | {status}; 422 invalid transition (e.g. exited→active) |
| DELETE `/employees/:id` | `employee.delete` | soft; 422 `has_active_user` (disable first) |
| GET/POST/PATCH/DELETE `/employees/:id/emergency-contacts(/:cid)` | own or `employee.edit` | |
| GET/PUT `/employees/:id/bank-account` | self read (masked) or `payroll.manage` | P2; write audited |
| POST `/employees/:id/invite` | `users.manage` | creates user+invite; 409 user exists |
| GET `/employees/export` | `employee.export` | CSV; audited |

## 7. Shifts (Phase 1)

| Method & path | Perm | Notes |
|---|---|---|
| GET/POST `/shifts` · PATCH/DELETE `/shifts/:id` | view: session; write `shifts.manage` | DELETE 409 if assigned; one default enforced 422 |
| GET `/employee-shifts?employeeId=` | scope-tiered | assignment history |
| POST `/employee-shifts` | `shifts.manage` | {employeeId, shiftId, effectiveFrom}; auto-closes previous; 422 `overlap` |

## 8. Attendance (Phase 1)

| Method & path | Perm | Request → response | Notable errors |
|---|---|---|---|
| POST `/attendance/check-in` · `/check-out` | `attendance.view_own` (self only) | → punch + today summary | 422 `already_checked_in`/`not_checked_in` (idempotency), `month_locked`, `not_active_employee` |
| GET `/attendance/records` | own/team/all tier params | employeeId?, month, → records+punches | 403 scope |
| POST `/attendance/records` (manual) | `attendance.edit` | employeeId, date, in/out | 422 `month_locked`; audited |
| GET `/attendance/summary` | tier | month aggregates (present/absent/…) | |
| GET/POST `/attendance/corrections` | own create; list per tier | date, requested in/out/status, reason | 422 `month_locked`, `duplicate_pending`, `future_date` |
| POST `/attendance/corrections/:id/approve` · `/reject` | `attendance.approve` (team or all) | reject: note required | 422 `not_pending`, `own_request`, `month_locked` |
| POST `/attendance/corrections/:id/cancel` | requester | | 422 `not_pending` |
| GET/POST `/attendance/locks` | `attendance.manage` | {year, month} | 422 `pending_corrections_exist` (list in details), 409 already locked |
| DELETE `/attendance/locks/:id` | `attendance.manage` | unlock | 422 `payroll_run_exists` |

## 9. Leave & holidays (Phase 1)

| Method & path | Perm | Notable errors |
|---|---|---|
| GET/POST `/leave-types` · PATCH/DELETE `/leave-types/:id` | write `leave.manage` | DELETE 409 in-use |
| GET/PUT `/leave-policies/:leaveTypeId` | `leave.manage` | |
| GET `/leave-balances` | tier (own/team/all; employeeId, year) | |
| POST `/leave-balances/adjust` | `leave.manage` | {employeeId, typeId, year, delta, reason}; audited |
| GET `/leave-requests` | tier + filters status/type/date | |
| POST `/leave-requests` | own `leave.create` (HR on-behalf: `leave.create`+`view_all`, employeeId param) | 422 `insufficient_balance`, `overlap`, `min_notice`, `probation`, `attachment_required`, `max_consecutive`, `invalid_range` |
| POST `/leave-requests/:id/approve` · `/reject` | `leave.approve` (scope) | 422 `not_pending`, `own_request`, `balance_changed`; reject note required |
| POST `/leave-requests/:id/cancel` | requester (rules) or HR | 422 `already_started` (non-HR) |
| GET `/leave-requests/:id/day-breakdown` | request visibility | computed day list with skip reasons |
| GET/POST `/holidays` · PATCH/DELETE `/holidays/:id` | write `holidays.manage` | 409 duplicate date+location |

## 10. Payroll (Phase 2)

| Method & path | Perm | Notable errors |
|---|---|---|
| CRUD `/payroll/components`, `/payroll/structures` (+`/components` sub-list) | `payroll.manage` | 409 code dup; 422 `percentage_base_missing` |
| GET/POST `/payroll/employee-salaries` | `payroll.manage` (GET own summary: none — employee never sees structure admin, only payslips) | POST: {employeeId, structureId?, components, ctc, effectiveFrom}; 422 `overlap` |
| GET/POST `/payroll/runs` | `payroll.view_all` / `payroll.create` | POST 422 `month_not_locked`, 409 run exists |
| POST `/payroll/runs/:id/process` | `payroll.create` | 422 `not_draft`, `missing_salary_assignments` (details list) |
| POST `/payroll/runs/:id/revert` | `payroll.create` | 422 `not_pending_approval` |
| PATCH `/payroll/runs/:id/lines/:payslipId` | `payroll.edit` | draft-run adjustments only 422 |
| POST `/payroll/runs/:id/approve` | `payroll.approve` | 422 `not_pending_approval`, `unresolved_lines`; irreversible |
| POST `/payroll/runs/:id/mark-paid` | `payroll.approve` | 422 `not_approved` |
| GET `/payroll/payslips` | `payroll.view_all`; `?employeeId=me` via `payroll.view_own` | |
| GET `/payroll/payslips/:id/pdf` | owner or `payroll.view_all` | presigned redirect; audited |

## 11. Documents (Phase 2)

| Method & path | Perm | Notable errors |
|---|---|---|
| CRUD `/document-categories` | `documents.manage` | |
| GET `/documents` | tier (own + company-level; manager: category.manager_visible only) | filters: categoryId, employeeId, expiring≤days |
| POST `/documents/presign-upload` | own (uploadable categories) or `documents.create` | {categoryId, employeeId?, filename, mime, size} → presigned PUT + draft key; 422 `category_not_uploadable`, `mime_not_allowed`, `too_large` |
| POST `/documents` (confirm) | same | metadata row; 422 `upload_not_found` |
| GET `/documents/:id/download` | object-level check | presigned GET redirect; sensitive categories audited |
| PATCH/DELETE `/documents/:id` | `documents.edit`/`delete` | system_managed 422 |

## 12. Recruitment (Phase 2)

| Method & path | Perm | Notable errors |
|---|---|---|
| CRUD `/job-postings`; POST `/:id/publish` · `/close` | `recruitment.*` | 422 close-with-open-apps prompts `open_applications` |
| CRUD `/candidates` | `recruitment.*` | 409 email dup |
| GET/POST `/applications` | `recruitment.view_all/create` | 409 candidate+job dup |
| POST `/applications/:id/stage` | `recruitment.edit` | {stage, reason?}; 422 `invalid_transition`, `interview_required`, reason required for rejected |
| CRUD `/interviews`; POST `/interviews/:id/feedback` | schedule `recruitment.edit`; feedback: assigned interviewer | 422 `not_interviewer`, `already_submitted` |
| POST `/offers` · `/offers/:id/send` · `/accept` · `/decline` · `/withdraw` | create `recruitment.create`; send requires `recruitment.approve` | 422 state guards, `expired` |
| POST `/offers/:id/convert-to-employee` | `employee.create` | 422 `not_accepted`; returns new employeeId |

## 13. Onboarding & offboarding (Phase 2)

| Method & path | Perm | Notable errors |
|---|---|---|
| CRUD `/onboarding/templates` (+tasks) | `onboarding.manage` (kind on/offboarding) | |
| POST `/onboarding/tasks/instantiate` | `onboarding.manage` | {employeeId, templateId} |
| GET `/onboarding/tasks` | own-assigned or `onboarding.view_all` | |
| POST `/onboarding/tasks/:id/complete` · `/skip` | assignee or HR | skip reason required; 422 `not_pending` |
| POST `/employees/:id/activate` | `onboarding.manage` | 422 `required_tasks_incomplete` (list) |
| POST `/offboarding/requests` | own (`offboarding.create`) or HR on-behalf | 422 `already_active_request` |
| POST `/offboarding/requests/:id/approve` | manager `offboarding.approve` | |
| POST `/offboarding/requests/:id/confirm` | `offboarding.manage` | sets last_working_day; instantiates tasks; auto-cancels post-LWD leave |
| POST `/offboarding/requests/:id/withdraw` | employee + HR approval flow | 422 after LWD |
| POST `/offboarding/tasks/:id/complete` | assignee/HR | |
| POST `/offboarding/requests/:id/clear` · `/settle` · `/complete` | `offboarding.manage` | 422 `blocking_tasks_pending`, `settlement_missing`, `manager_has_reports` |

## 14. Performance (Phase 2)

| Method & path | Perm | Notable errors |
|---|---|---|
| CRUD `/performance/cycles`; POST `/:id/activate` · `/close` | `performance.manage` | 422 state guards |
| GET/POST/PATCH `/performance/goals` | own create/update-progress; approve `performance.approve` (manager) | 422 `cycle_closed` |
| GET `/performance/reviews` | tier | |
| POST `/performance/reviews/:id/submit-self` | subject employee | 422 `not_pending_self` |
| POST `/performance/reviews/:id/submit-manager` | manager of subject | 422 `not_pending_manager`, `self_review_missing` |
| POST `/performance/reviews/:id/reopen` | `performance.manage` | 422 `cycle_closed` |

## 15. Training (Phase 3)

CRUD `/training/courses` (+`/lessons`) — `training.manage`; publish guard `no_lessons`.
GET `/training/courses` (published) — session. POST `/training/enrollments` — self-enroll open courses or `training.manage` assign; 409 dup.
POST `/training/enrollments/:id/lessons/:lessonId/complete` — enrollee; auto-completes course at 100% → certificate job.
GET `/training/certificates/:id/pdf` — owner/HR.

## 16. Expenses (Phase 2)

| Method & path | Perm | Notable errors |
|---|---|---|
| CRUD `/expense-categories` | `expenses.manage` | |
| GET/POST/PATCH `/expenses` | own (draft edit only); tier list | 422 `receipt_required`, `over_limit_needs_hr` flag |
| POST `/expenses/:id/submit` | owner | 422 `not_draft` |
| POST `/expenses/:id/approve` · `/reject` | `expenses.approve` scope | 422 `not_submitted`, `own_claim`, `over_limit_needs_hr` |
| POST `/reimbursements` | `expenses.manage` | {expenseIds, method, reference} → marks reimbursed; 422 `not_approved` |

## 17. Notifications & announcements (Phase 1)

GET `/notifications` (own; unread filter) · POST `/notifications/:id/read` · POST `/notifications/read-all`.
GET `/announcements` (audience-scoped) · POST `/announcements` (`announcements.create`; body sanitized) · POST `/announcements/:id/publish` · POST `/announcements/:id/read` (receipt).

## 18. Reports (Phase 1 basic → P2 full)

GET `/reports/:name` — name ∈ catalog (R1–R16, `03-…` doc); perm `reports.view_all` or `reports.view_team` (auto-scoped); query = report filters; → `{ data: rows, meta }`.
POST `/reports/:name/export` — additionally `*.export` for the module; small sync (CSV stream) / large async (202 + notification); every call audited.

## 19. Audit logs (Phase 1)

GET `/audit-logs` — `audit.view_all` (company scope); filters actor, action, entityType, entityId, from/to.
GET `/audit-logs/:id` — detail with before/after.
(No write endpoints exist.)

---

## Decisions made in this document

- HR "on-behalf" actions reuse the standard endpoints with an `employeeId` parameter + elevated permission, rather than separate admin endpoints.
- Check-in/check-out endpoints are self-only by design; manual third-party entries go through `/attendance/records` (manual, audited).
- 404 (not 403) for cross-tenant/out-of-scope ids — no existence leaking.
- Report names are a closed server-side registry; no ad-hoc query endpoint (SQL injection surface stays zero).
- Payslip PDF and sensitive-document downloads always route through the API for permission check + audit, never direct bucket links.
