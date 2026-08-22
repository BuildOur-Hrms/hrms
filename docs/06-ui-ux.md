# HRMS Blueprint — UI/UX Screen Specifications

> Document 06 of 11. Routes are canonical. Components: Tailwind CSS + shadcn/ui + lucide-react + Recharts.

---

## 1. Design principles & system

- **Look**: clean professional SaaS — white/neutral surfaces, one primary brand color, generous whitespace, 8px spacing grid, `Inter` (or system) typeface, subtle borders over shadows.
- **Layout anatomy** (authenticated shell): top bar (global search P2, notifications bell, profile menu) + left sidebar (permission-driven sections, collapsible) + content area (page header: title, breadcrumb, primary action button; then content).
- **Responsive strategy**: desktop-first; ≤ md breakpoints: sidebar → bottom nav (Employee role) or hamburger drawer; data tables collapse to stacked cards showing key columns; primary actions become sticky bottom buttons or sheets.
- **Dark mode**: P3 (design tokens ready via CSS variables from day 1).
- **Accessibility**: visible focus rings, WCAG AA contrast, all interactive elements keyboard reachable, table row actions in a menu (not hover-only), form errors announced (`aria-describedby`), dialogs focus-trapped.

### Brand palette (BuildOur AI)

The HRMS shares a visual identity with the rest of the BuildOur AI product family. Every value below lives as a CSS variable in `src/app/globals.css` and is consumed only through Tailwind tokens (`bg-card`, `text-brand`, `bg-accent`, …) — no screen hardcodes a colour.

| Role | Light | Token |
| --- | --- | --- |
| Brand / primary action, active state, focus ring | `#C95A12` | `--brand`, `--primary`, `--ring` |
| Soft orange — selected and active backgrounds | `#F7E9DE` | `--brand-soft`, `--accent` |
| Page background (warm off-white) | `#FCFBF9` | `--background` |
| Cards and content surfaces | `#FFFFFF` | `--card`, `--popover` |
| Borders and dividers (warm grey) | `#E7E1DB` | `--border`, `--input` |
| Primary text | `#171717` | `--foreground` |
| Secondary text (warm grey) | `#6F6A65` | `--muted-foreground` |

Radii sit at 8–12px (`--radius: 0.625rem`), shadows are warm and near-invisible (`shadow-xs`/`shadow-sm`) — borders do the separating, not elevation. Dark mode inverts onto warm brown-black paper rather than neutral black, so the warmth survives the switch.

The mark is `public/brand/buildour-mark.svg`, mirrored as `src/app/icon.svg` (favicon) and as a token-coloured inline copy in `src/components/brand/logo.tsx`. The three share one geometry; change one and change all three.

## 2. Global conventions (defined once — screens below note only deltas)

- **List screens**: toolbar (search input, filter dropdowns, sort select) → server-paginated DataTable (pageSize 20, column sort, total count) → row actions menu → bulk-select only where noted. **Empty state**: icon + one-line message + primary CTA. **Loading**: skeleton rows. **Error**: inline alert + Retry.
- **Forms**: zod-validated (same schema as API), inline field errors, submit disabled while pending, sticky footer bar (Cancel/Save) on long forms, unsaved-changes guard.
- **Detail screens**: header card (avatar/title/status badge/key facts + actions) → tabs.
- **Destructive actions**: confirm dialog naming the object; type-to-confirm for irreversible (delete employee, approve payroll).
- **Feedback**: success/error toasts; long operations show progress state on button.
- **Dates/times** render in company timezone with user-familiar format from settings.

---

## 3. Public screens

| Screen | Spec |
|---|---|
| `/login` | Centered card: logo, email, password, "Forgot password?" link, submit. Errors: invalid credentials (generic message), account locked (with retry-after), account disabled. No signup link. Mobile: full-width card. |
| `/forgot-password` | Email field → always shows "If the account exists, we sent a link" (no enumeration). |
| `/reset-password` | Token from URL (also serves invite-accept with kind param): new password + confirm, live policy checklist (length, breach check note), expired/used-token error state with "request new link" CTA. |

---

## 4. Employee screens

### `/dashboard`
Purpose: daily landing. Widgets: **Check-in card** (big In/Out button, live worked-hours timer, today's shift, late badge), **Leave balances** (per-type chips), **Upcoming holidays** (next 3), **My pending items** (corrections pending, onboarding/offboarding tasks P2, reviews due P2), **Announcements** (latest 3). Quick actions: Apply Leave, Raise Correction. Mobile: single column; check-in card first.

### `/me/profile`
Header card (photo, name, code, designation, department, manager, status badge). Tabs: **Personal** (self-editable: phone, personal email, address, photo — edit inline; rest read-only), **Job** (read-only placement/dates), **Emergency contacts** (CRUD own), **Bank** (P2; masked, read-only; "contact HR to change"). Resignation button (P2) opens offboarding dialog.

### `/me/attendance`
Today card (punches list, worked total) + **month calendar grid** (color-coded day cells by status; legend; click day → drawer: punches, computed record, "Request correction" CTA). Month picker; summary bar (present/absent/half/leave/OT totals). Corrections list tab (status chips; cancel pending). Mobile: calendar becomes weekly horizontal scroll.

### `/me/leave`
Balance cards per type (current + used/accrued). Requests table (dates, type, days, status, approver, actions: cancel). **Apply dialog**: type select (shows balance), date range, half-day toggle (single-day only), computed working days preview (live, holiday-aware), reason, attachment (if type requires). Errors surfaced inline: insufficient balance, overlap, notice period.

### `/me/documents` (P2)
Grid/list of own + company docs (name, category, expiry badge, uploaded date). Upload button (allowed categories only), download, preview for images/PDF. Filter by category. Empty state: "No documents yet."

### `/me/payslips` (P2)
Table: period, gross, net (amounts visible only here + HR), published date, Download PDF. Year filter. Empty: "Payslips appear after payroll is published."

### `/me/expenses` (P2)
Table (date, category, amount, status chips) + New expense (form: category with limit hint, amount, date, description, receipt upload). Draft rows editable/submittable; rejected show reason; totals summary cards (pending/approved/reimbursed this year).

### `/me/training` (P3)
Enrolled courses cards (progress ring, due badge) + course catalog (enroll). Course player page: lesson list sidebar, content pane, mark-complete, certificate download at 100%.

### `/me/performance` (P2)
Goals list (progress sliders, status) + add goal (pending manager approval badge). Reviews: current cycle card → self-review form (rating + comments), history list.

### `/me/notifications`
Full list (unread bold, type icon, timestamp, deep link), filters (unread/all, type), Mark all read. Pagination.

### `/me/settings`
Change password (current + new + confirm, policy checklist). Session info + "Log out everywhere". Notification preferences (P3).

---

## 5. Manager screens (scope: direct reports; visible only with `*.view_team`/approve permissions)

### `/team`
KPI row: team size, present today, on leave today, late today, pending approvals count. **Approvals inbox** (unified list: leave, corrections; P2 expenses, resignations — inline Approve/Reject with note dialog). Team list (person, status today, designation). Upcoming team leave (7-day mini calendar). Birthdays/anniversaries (day+month only).

### `/team/attendance`
Date picker (default today) → grid: rows = reports, columns = status/in/out/worked/late; month view per employee (drill into same calendar component as `/me/attendance`, read-only + approve corrections). Filters: status. Export (P2, `reports.view_team`).

### `/team/leave-approvals`
Pending queue (oldest first, SLA badge >48h) with request detail drawer (balance context: current balance, team members off same dates). Approve/Reject (note required on reject). History tab.

### `/team/performance` (P2)
Reports' goals awaiting approval; manager reviews to complete (per cycle progress bar); per-report goal/review drill-down.

### `/team/reports` (P2)
Team-scoped versions of R1–R7 report pages (see `03-modules-platform-and-reports.md` catalog) with export.

---

## 6. HR screens (permission `*.view_all` family)

### `/hr` (HR Dashboard)
Composition per `03-modules-platform-and-reports.md` Module 18: KPI cards row, charts row (headcount by dept bar, 30-day attendance line, leave-type donut), action lists (absent-no-leave today, pending approvals oldest-first, probation ends, recent joiners, upcoming holidays), quick actions. All cards deep-link to filtered module screens.

### `/hr/employees`
DataTable: photo+name, code, department, designation, location, type, status badge, join date. Filters: department, location, status, type; search name/code/email; sort any column; bulk export. Primary CTA: Add Employee (multi-step form: Personal → Job → Invite user toggle). Row actions: view, edit, deactivate. Pipeline filter chips: onboarding / on_notice (P2 views).

### `/hr/employees/[id]`
Header card + status-transition action menu. Tabs: **Overview** (personal+contacts), **Job** (placement, manager, shift assignment with history, dates), **Attendance** (embedded month view + manual entry + corrections), **Leave** (balances + adjust dialog + history), **Salary** (P2 — assignment history, revise action; `payroll.*` only), **Documents** (P2), **Onboarding/Offboarding** (P2 checklists), **History** (audit trail for this employee).

### `/hr/departments`
Two tabs: Departments (name, code, head, headcount, actions) and Designations (title, code, level). Inline create/edit dialogs. Delete guarded (409 explanation if in use).

### `/hr/attendance`
Company day view (all employees, same grid as team but full scope + manual entry) | Corrections queue (all) | **Month lock panel**: month list with lock status, Lock button (type-to-confirm; validates no pending corrections — warning list if any) | Shift settings (shift CRUD + default marker).

### `/hr/leave`
Tabs: Requests (all, filters: status/type/department/date), Balances (per-employee grid, adjust with reason), Types & Policies (CRUD forms with policy fields incl. sandwich toggle), Holidays (year view CRUD, location filter).

### `/hr/payroll` (P2)
Runs list (period, status chip, gross/net totals). **Run wizard**: 1) Create (pick month; blocked if attendance month unlocked — checklist panel) → 2) Processing (progress) → 3) Review (lines table: employee, payable days, LOP, gross, deductions, net; expand → items; edit adjustments; recalculate) → 4) Approval (summary + type-to-confirm approve) → 5) Published (payslip statuses, notify-all, mark-paid). Settings tabs: Components, Structures. Employee salary assignment lives on employee detail Salary tab.

### `/hr/documents` (P2)
All documents table (owner, name, category, expiry, status), Expiring-soon saved view (≤30d), category admin, upload-for-employee.

### `/hr/recruitment` (P2)
Jobs list → job detail with **kanban** (columns = stages, cards = candidates: name, rating avg, days-in-stage; drag between stages with guard dialogs) | Candidates table (talent pool, search) | Interviews (calendar + my-interviews list for interviewer feedback form: rating, recommendation, notes) | Offers (status list; create-offer form; record accept → "Convert to employee" CTA pre-fills Add Employee).

### `/hr/performance` (P2)
Cycles admin (create/activate/close), completion matrix (rows employees, cols self/manager/final), distribution chart, export.

### `/hr/training` (P3)
Courses admin (CRUD + lessons editor with drag order), enrollment matrix (assign by dept/individual), completion report.

### `/hr/reports`
Catalog grid (report cards by group) → report page pattern: filter bar (date preset, department, location, employee, status) + KPI strip + DataTable + Export CSV/XLSX (async >5k rows → toast "You'll be notified").

---

## 7. Admin screens

| Screen | Spec |
|---|---|
| `/admin/company` | Company profile form (name, legal, logo upload, address, contact) + org defaults (timezone, currency, date format, working days, leave-year start). |
| `/admin/roles` | Roles list (system badge) → role detail: permission matrix grouped by module with toggle grid (system roles read-only in P1/P2; custom roles P3). Users tab: assign/remove roles per user, invite status, resend invite, disable user. |
| `/admin/locations` | Locations CRUD table. |
| `/admin/settings` | Grouped tabs per settings catalog (`03-…` Module 23): General, Attendance, Leave, Security (global keys visible only to super_admin), Notifications, Payroll (P2). Each change confirmable + audited note. |
| `/admin/audit-logs` | Filter bar (date range, actor, action, entity type, entity id) + table (time, actor, action, entity, summary) → detail drawer with before/after diff viewer (JSON, changed keys highlighted). Export. |

---

## 8. Notification UX

- **Bell** (topbar): unread badge (9+ cap), dropdown of latest 10 (title, relative time, unread dot), item click = mark read + deep link; footer "View all" → `/me/notifications`; "Mark all read".
- In-app arrival: badge updates on poll (30s) — no websockets in v1.
- Announcements render as dismissible banner on `/dashboard` until read (receipt recorded).

---

## 9. Key composite screens — extra detail

**Attendance month grid** (shared component): 7-col calendar; cell = date, status color strip, worked hours; badges: late (amber dot), OT (blue dot), needs_review (red outline), locked (padlock watermark month-level). Hover/tap → punch summary popover.

**Leave approval drawer**: request facts, computed days breakdown (which days counted/skipped and why — sandwich/holiday notes), requester's balance after approval, team-absence conflict list, approve/reject buttons with note field.

**Payroll review line expand**: earnings/deductions item table + input snapshot (payable days math trace: period − LOP, proration factor) so HR can verify any number.

**Employee add form** (multi-step): validates per-step; step 3 "Invite user account now?" toggle; success screen with next actions (assign shift, start onboarding P2).

---

## Decisions made in this document

- No websockets in v1 — 30s polling for the bell keeps infra simple; revisit with push in P3.
- Employee mobile bottom-nav items: Dashboard, Attendance, Leave, Notifications, Profile.
- Global search (topbar) is P2, scoped to employees (HR) — not a v1 blocker.
- Payslip amounts and any salary figures never appear in list previews or notifications — only inside `/me/payslips`, employee Salary tab (permission-gated), and payroll screens.
- All charts use Recharts with a shared theme wrapper; empty-data charts render a friendly placeholder, never an empty axis box.
