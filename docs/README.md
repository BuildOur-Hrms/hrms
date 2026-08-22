# HRMS Blueprint — Index

Single source of truth for building the HRMS. Read order = numeric order. Where docs disagree: `04-database.md` wins on data shapes; `00-overview-and-roles.md` wins on scope/roles; `08-api.md` wins on endpoint naming.

| Doc | Contents |
|---|---|
| [00-overview-and-roles.md](00-overview-and-roles.md) | PRD, personas, problems, goals, architecture + stack decision, feature hierarchy, role & permission model, user-role matrix |
| [01-modules-core.md](01-modules-core.md) | Modules 1–8: Auth, Employees, Company/Org, Departments/Designations, Attendance, Shifts, Leave, Holidays |
| [02-modules-talent.md](02-modules-talent.md) | Modules 9–16: Payroll, Documents, Recruitment, Onboarding, Performance, Training/LMS, Expenses, Self-Service |
| [03-modules-platform-and-reports.md](03-modules-platform-and-reports.md) | Modules 17–23: dashboards, notifications, reports catalog (R1–R16), offboarding, audit logs, settings catalog |
| [04-database.md](04-database.md) | **Canonical schema** (~55 tables), relationships, multi-tenant model (company_id + Prisma extension + RLS), seed data, migration policy |
| [05-architecture.md](05-architecture.md) | System diagram, frontend/backend structure, auth flow, storage, notification service, jobs/cron table, integration seams, logging, full folder tree |
| [06-ui-ux.md](06-ui-ux.md) | Design system, global UI conventions, every screen spec (public/employee/manager/HR/admin), composite screens, notification UX |
| [07-workflows-and-automation.md](07-workflows-and-automation.md) | State machines for onboarding/attendance/leave/payroll/offboarding/recruitment/training + notification & automation catalog |
| [08-api.md](08-api.md) | Full REST endpoint catalog per module with permissions, requests, responses, error rules |
| [09-security.md](09-security.md) | Threat model, authn/authz, RLS, file security, input handling, CSRF, rate limits, audit, privacy, backups, retention |
| [10-roadmap-testing-deployment.md](10-roadmap-testing-deployment.md) | MVP rationale, milestone roadmap, testing strategy + HR test cases, deployment/ops, checklists, **Build Order** |

## Final-deliverables map

1. Product requirements document → 00 §1–3
2. Feature hierarchy → 00 §5
3. User-role matrix → 00 §6.4
4. Complete database schema → 04 §2
5. Entity relationship explanation → 04 §3
6. Application architecture → 05 §1–9
7. Folder structure → 05 §10
8. Page/screen map → 06 §3–7
9. API map → 08
10. Workflow diagrams (text) → 07 §1
11. Security architecture → 09 (+ 04 §4)
12. MVP roadmap → 10 §1–2 (Phase 1)
13. Development roadmap → 10 §2
14. Testing checklist → 10 §3
15. Deployment checklist → 10 §4–5
16. Future enhancement roadmap → 10 §2 (Phase 2/3) + 00 §3

## Canonical quick reference

- Stack: Next.js 15 (App Router, TS strict) · Tailwind + shadcn/ui · TanStack Query/Table · react-hook-form + zod · REST `/api/v1` · PostgreSQL 16 + Prisma · Auth.js v5 (argon2id, JWT cookie) · BullMQ + Redis worker · S3-compatible storage · Resend/Mailpit · @react-pdf/renderer · Docker Compose · GitHub Actions.
- Roles: `super_admin`, `hr_admin`, `manager`, `employee`. Permissions: `module.action` with actions `view_own|view_team|view_all|create|edit|delete|approve|export|manage`.
- Tenancy: shared schema, `company_id` everywhere, tenant-scoped Prisma extension + Postgres RLS (`app.company_id` via SET LOCAL).
- Phases: P1 core HR ops (no payroll) · P2 payroll/documents/expenses/recruitment/boarding/performance/reports · P3 LMS/analytics/integrations/PWA/multi-tenant GA.
