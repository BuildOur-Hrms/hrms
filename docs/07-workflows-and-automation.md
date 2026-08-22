# HRMS Blueprint — Workflows, Notifications & Automation

> Document 07 of 11. States use canonical enums from `04-database.md`. Every transition below implies: permission check → transaction → audit log entry → notification(s) → (maybe) job enqueue.

---

## 1. Workflow maps

### 1.1 Employee onboarding (Candidate → Active Employee) — P2 (P1 = direct employee creation, steps 4–7)

```
1. Recruitment: offers.status = accepted
2. HR clicks "Convert to employee"
   → employees row created: status=onboarding, candidate_id set, join_date=offer.joining_date
3. Resume/offer docs copied as documents rows (category: contract/resume)
4. HR picks onboarding template → onboarding_tasks instantiated
   (assignees resolved: hr→HR user, manager→employee.manager.user, new_hire→employee.user, it→designated user;
    due_date = join_date + due_offset_days)
5. HR triggers user invite (users row status=invited, invite email)
6. Assignees complete tasks (status pending→completed; skip requires reason)
7. All required tasks completed → HR "Activate"
   → employees.status = active; welcome notification
```
- Actors: hr_admin (drive), manager/IT/new hire (tasks).
- Side effects: notifications on task assignment + overdue; audit on conversion/activation.
- Edge cases: offer declined after conversion started → HR cancels: employee row soft-deleted if never active, tasks cancelled. Join date shifts → due dates recompute (HR edits join_date; task recompute job).

### 1.2 Attendance day cycle — P1

```
check-in (punch in, source=web) ─▶ [0..n punch pairs] ─▶ check-out (punch out)
        nightly attendance-daily-calc (00:30) for yesterday:
        for each active employee:
          shift = effective employee_shifts row
          if approved leave covering date  → status=on_leave (half-day leave + punches → half_day/present math)
          elif holiday (location-aware)    → status=holiday
          elif weekday in shift.week_off   → status=week_off
          elif no punches                  → status=absent (notify)
          else: worked=Σ(in→out)−break; late=max(0, first_in−(start+grace));
                status = worked < half_day_threshold ? half_day : present;
                overtime = max(0, worked − shift_duration); missing check-out → needs_review
```
Correction sub-flow:
```
employee submits attendance_corrections (pending)
  ├─ employee cancel → cancelled
  ├─ manager reject  → rejected (note required, notify)
  └─ manager approve → approved → punches adjusted/created (source=manual, audit)
                        → day recomputed immediately
Guards: work_date in locked month → 422 at submit AND at approve; approver must be
        target's manager or hold attendance.approve with view_all (HR).
```
Month lock: HR locks (company, year, month) → all records flagged locked; punches/corrections/manual entries for that month rejected; unlock = super_admin-grade HR action, audited, only while payroll run for the month is absent or draft.

### 1.3 Leave — P1

State machine (`leave_requests.status`):
```
            ┌────────── employee cancel ──────────┐
submit ─▶ pending ── manager/HR approve ─▶ approved ── cancel(before start, or HR) ─▶ cancelled(+restore)
            └── manager/HR reject ─▶ rejected
```
- Submit guards: dates valid & future-or-today (HR on-behalf may backdate), computed days > 0, balance ≥ days (unless policy max_negative), no overlap with pending/approved, min notice respected, probation rule, attachment if type requires.
- Approve (permission `leave.approve`, approver ≠ requester, target is direct report unless HR): re-check balance & overlap → decrement `leave_balances.used` (+days) atomically → notify employee → attendance for those dates will compute `on_leave`.
- Reject: note required → notify.
- Cancel pending: by employee anytime. Cancel approved: employee before start_date; HR anytime (past cancellations trigger attendance recompute for affected days) → restore balance.
- Edge cases: request spanning leave-year boundary → split across two balance years at submit; holiday/week-off inside span excluded unless sandwich rule on; balance changed between submit and approve → approval fails 422 with explanation.

### 1.4 Payroll — P2

```
create run (year, month) ── guards: attendance_month_locks row exists; no existing run
  draft ──"Process"──▶ processing (job): snapshot per employee:
        period_days, payable_days = period_days − LOP_days,
        LOP = absent days + unpaid-leave days (from locked attendance + approved unpaid leave),
        OT approved minutes, adjustments (manual + approved expense reimbursements opted-in)
        → payslips(draft) + payslip_items computed via payroll engine
  processing ──auto──▶ pending_approval
  pending_approval ──"Revert"──▶ draft (payslips deleted, inputs editable)
  pending_approval ──"Approve" (payroll.approve, type-to-confirm)──▶ approved
        → payslip-generate job: PDFs rendered, payslips.status=published, employees notified
  approved ──"Mark paid" (+paid_at)──▶ paid → payslips.status=paid
```
- Guards: employee joined mid-month → prorated by join-date; exited employees included only up to exit_date (final-settlement runs handle the rest); salary assignment missing → line flagged, run cannot leave pending_approval until resolved or employee excluded (explicit, audited).
- Rollback rules: anything before `approved` is reversible; `approved` is not — corrections happen via next-cycle adjustments (audited).

### 1.5 Offboarding — P2

```
employee submits resignation ─▶ offboarding_requests: initiated
  manager approves ─▶ HR confirms: sets notice_period_days (default from settings/employee),
                      last_working_day computed/overridable
                      → employees.status = on_notice ─▶ request: in_progress
                      → offboarding template instantiated (offboarding_tasks; blocking flags)
  tasks completed (asset return, access revocation, KT, exit interview)
     all blocking tasks done ─▶ HR marks cleared
  HR records settlement (leave encashment days×rate, pending reimbursements,
     recoveries, notice shortfall) → payroll settlement line ─▶ settled
  on/after last_working_day: HR completes ─▶ completed:
     users.status=disabled, session_version++, employees.status=exited, exit_date set
```
- Withdrawal: while initiated/in_progress and before last_working_day, employee requests, HR approves → request closed (kept for history), employee back to active, tasks cancelled.
- Edge cases: pending approved future leave beyond last working day → auto-cancelled with balance restore at confirmation; pending expenses → resolved before settled; employee is a manager → HR must reassign reports before completed (guard 422).

### 1.6 Recruitment — P2

```
job_postings: draft → open (publish) → on_hold ⇄ open → closed
application stages: applied → screening → interview → offer → hired
                        └────────────── rejected (any stage, reason required)
interview: scheduled → completed (feedback+rating) | cancelled
offer: draft → sent (requires recruitment.approve) → accepted → [convert to employee]
                                   ├─ declined
                                   └─ withdrawn
```
- Guards: stage `offer` requires ≥1 completed interview (configurable); `hired` set automatically when offer accepted; converting requires stage=hired; closing a job with open applications prompts bulk-reject with reason.
- Side effects: interviewer notified on schedule; HR notified on feedback submitted; candidate emails (offer sent) are manual in P2 (mailto/attachment), automated P3.

### 1.7 Training — P3

```
course: draft → published → archived
enrollment: enrolled → in_progress (first lesson completed) → completed (all lessons; score if assessment)
    completed → certificate generated (PDF job) → notification
```
- Mandatory course assignment sets due_date = assigned_at + deadline_days → reminder cron.
- Edge cases: course content changed after enrollments → progress preserved by lesson id; archived course blocks new enrollment, preserves history.

---

## 2. Cross-cutting transition rules

- Every approval action: permission + scope check, approver ≠ subject, state precondition, atomic transaction, audit entry with before/after status, notification to affected parties.
- Invalid transitions return 422 BUSINESS_RULE with a machine-readable `details.transition` field.
- All state changes emit domain events (`module.event`) consumed by the notification dispatcher and audit writer (see `05-architecture.md` §3, §6).

---

## 3. Notifications & automation catalog

Channels: **A** in-app, **E** email, **P** push (P3). Trigger: **ev** domain event, **cr** cron.

| Event key | Trigger | Recipients | Channels | Timing | Phase |
|---|---|---|---|---|---|
| `employee.invited` | ev | new user | E | instant | P1 |
| `leave.submitted` | ev | approver (manager), HR toggle | A,E | instant | P1 |
| `leave.approved` / `leave.rejected` | ev | requester | A,E | instant | P1 |
| `leave.cancelled` | ev | approver | A | instant | P1 |
| `attendance.correction_submitted` | ev | approver | A,E | instant | P1 |
| `attendance.correction_resolved` | ev | requester | A,E | instant | P1 |
| `attendance.late` | cr (daily-calc) | employee; manager per toggle | A | 00:30 next day | P1 |
| `attendance.absent_no_leave` | cr (daily-calc) | employee, manager | A,E | 00:30 next day | P1 |
| `attendance.missing_checkout` | cr (daily-calc) | employee | A | 00:30 next day | P1 |
| `attendance.month_locked` | ev | all HR users | A | instant | P1 |
| `holiday.upcoming` | cr | all employees (location-aware) | A | T-1 08:00 | P1 |
| `birthday` / `work_anniversary` | cr | team members + HR (toggles) | A | 08:00 | P1 |
| `probation.ending` | cr | HR, manager | A,E | T-7 | P1 |
| `payslip.published` | ev | employee | A,E | instant | P2 |
| `payroll.pending_approval` | ev | payroll approvers | A,E | instant | P2 |
| `document.expiring` | cr | owner employee, HR | A,E | T-30, T-7, T-0 | P2 |
| `contract.expiring` | cr | HR | A,E | T-30, T-7 | P2 |
| `expense.submitted` | ev | approver | A,E | instant | P2 |
| `expense.approved/rejected/reimbursed` | ev | claimant | A,E | instant | P2 |
| `onboarding.task_assigned` / `offboarding.task_assigned` | ev | assignee | A,E | instant | P2 |
| `boarding.task_overdue` | cr | assignee, HR | A | daily 08:00 | P2 |
| `resignation.submitted` | ev | manager, HR | A,E | instant | P2 |
| `offboarding.state_changed` | ev | employee, HR | A | instant | P2 |
| `review.deadline` | cr | pending reviewers | A,E | T-7, T-1 | P2 |
| `goal.approved` | ev | employee | A | instant | P2 |
| `interview.scheduled` | ev | interviewer | A,E | instant + T-1 reminder cr | P2 |
| `announcement.published` | ev | audience users | A (+E toggle) | instant | P1 |
| `training.deadline` | cr | enrollee, manager | A,E | T-7, T-1 | P3 |
| `training.completed` | ev | enrollee (certificate) | A,E | instant | P3 |
| `report.export_ready` | ev | requester | A | instant | P2 |

**Automation policy**: instant events dispatch immediately (email via queue); cron-driven events batch into one job run each (see job table in `05-architecture.md` §7). Digest mode (P2): user-opted events collapse into 18:00 daily email instead of instant emails; in-app always instant. Quiet hours: emails only 07:00–21:00 company TZ — outside window, deferred to window start (in-app unaffected).

---

## Decisions made in this document

- Leave requests spanning leave-year boundary are split into two linked requests at submit (simpler balance math, clearer approvals).
- Correction approval edits/creates punches (source `manual`) rather than editing the computed record — the record stays derivable from punches at all times.
- Payroll `approved` state is immutable by design; monetary corrections are next-cycle adjustments — matches audit expectations.
- Offer-stage automation (candidate-facing emails) deferred to P3; P2 records statuses while HR communicates manually.
- Cron times are company-timezone-relative; multi-tenant P3 runs per-company schedules from one scheduler loop.
