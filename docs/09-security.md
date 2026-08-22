# HRMS Blueprint — Security, Privacy & Data Protection

> Document 09 of 11. HR data is among the most sensitive a company holds (identity, salary, health-adjacent leave data, bank details). Security is a first-class requirement, not a hardening phase.

---

## 1. Threat model summary

**Assets**: employee PII (IDs, DOB, addresses), salary & bank data, documents (contracts, ID proofs), leave/health hints, credentials, audit trails.
**Adversaries & scenarios**:
- Cross-tenant leakage (future SaaS): tenant A reads tenant B → mitigated by dual-layer tenancy (§4).
- Privilege escalation: employee → manager/HR data (IDOR, mass assignment) → object-level checks, DTO allowlists, permission middleware.
- Credential attacks: stuffing/brute force → argon2id, lockout, rate limits.
- Injected content: XSS via names/announcements, SQL injection → output encoding, sanitization, parameterized queries.
- Insider misuse: HR exporting everything quietly → export auditing, least-privilege permissions, four-eyes payroll.
- Infrastructure: stolen backups, leaked buckets → encryption at rest, private buckets, presigned-only access.

---

## 2. Authentication

- **Hashing**: argon2id (memory 64 MB, iterations 3, parallelism 1 — tune to ~100ms server budget). No MD5/SHA/bcrypt-cost-shortcuts.
- **Password policy**: min length 10 (configurable `security.password_min_length`), no arbitrary complexity rules; reject top-breached passwords (embedded top-100k list; HIBP k-anonymity check P3). Policy enforced in shared zod schema.
- **Lockout**: 5 failed attempts (configurable) → 15-min lock, progressive doubling; lockout events audited + notify user by email. Login errors stay generic (no user/password distinction).
- **Tokens (invite/reset)**: 32-byte random, stored SHA-256 hashed, single-use (`used_at`), TTL invite 7d / reset 1h; all active tokens invalidated on password change.
- **Sessions**: JWT in httpOnly Secure SameSite=Lax cookie; claims `{userId, companyId, sessionVersion}`; sliding 12h expiry; `session_version` bump = global logout (password change, disable, offboarding completion). No tokens in localStorage, ever.

## 3. Authorization

- All checks **server-side** in the `withApi` pipeline; UI checks are cosmetic only.
- Permission-based (`module.action`) — never role-name conditionals (see `00-overview-and-roles.md` §6).
- **Scope tiers** enforced in services: own (`employee_id = ctx.employeeId`), team (`manager_id = ctx.employeeId`), company (tenant scope + `view_all`), platform (super_admin via `adminDb`, every use audited).
- **Object-level guards** (beyond scope): approver ≠ requester; manager actions verify target's `manager_id`; user cannot disable self; last-`hr_admin` protection.
- **Mass-assignment defense**: zod schemas whitelist fields per endpoint; self-service employee edits restricted to the allowlisted field set.
- **Response filtering**: DTO mappers strip salary/bank/ID fields unless caller is self or holds payroll/document permissions — enforced in one mapper per module, not per call-site.
- Permission/role changes audited with before/after grant sets.

## 4. Row-Level Security & tenancy

Model detailed in `04-database.md` §4: tenant-scoped Prisma extension (primary) + Postgres RLS with `SET LOCAL app.company_id` (defense-in-depth), app DB role without `BYPASSRLS`.
**What RLS does not cover** — and the app layer must: own/team tier filtering, field-level exposure, object-level workflow guards, rate limiting, business rules. RLS is the isolation floor, not the authorization system.
CI runs tenant-isolation tests with two seeded companies asserting zero cross-reads through both the API and raw-SQL paths (`10-roadmap-testing-deployment.md` §3).

## 5. Secure file access

- Buckets private; zero public ACLs; bucket policy denies non-presigned access.
- Presigned PUT TTL 10 min (content-type + max-size conditions signed in); presigned GET TTL 5 min; every GET preceded by object-level permission check; sensitive-category downloads audited.
- Filename sanitized (stored name is display metadata; key is server-generated `{companyId}/{module}/{entityId}/{uuid}`) — path traversal impossible by construction.
- Mime allowlist per document category; magic-byte sniff on confirm for executables masquerading as PDFs; size caps (10 MB default).
- EXIF stripped from profile photos on ingest. Virus-scan job hook (ClamAV) P3.

## 6. Input handling

- zod validation on **every** endpoint (body, query, params) — shared schemas with the frontend.
- SQL injection: Prisma parameterization everywhere; the report module's raw SQL uses bound parameters only, and report names resolve against a closed registry (no dynamic SQL from input).
- XSS: React auto-escaping; `dangerouslySetInnerHTML` allowed **only** for announcement bodies, which are sanitized server-side at write time (allowlist tags via sanitize-html) — render path never re-trusts input.
- CSV export cells prefixed to neutralize formula injection (`=`, `+`, `-`, `@`).
- File upload validation per §5.

## 7. CSRF

SameSite=Lax cookie blocks cross-site POSTs from foreign origins; belt-and-braces Origin/Referer verification on all mutating methods (403 on mismatch). No CORS allowances for `/api/v1` beyond same origin. This combination is sufficient because auth lives only in the cookie and all mutations are non-GET.

## 8. Rate limiting

Redis token buckets: per-IP `/auth/*` 10/min; per-user mutations 60/min; exports/reports 10/min per user; presign 30/min. 429 with `Retry-After`. Lockout (§2) is separate and account-based.

## 9. Secrets & configuration

- All secrets via env vars (catalog in `10-roadmap-testing-deployment.md` §4); `.env` git-ignored; `.env.example` documents every key with dummy values.
- CI: secret scanning (gitleaks) + dependency audit (npm audit / osv-scanner) gating merges.
- DB users: `app_user` (RLS-bound, INSERT-only on audit_logs, no DDL), `migrate_user` (DDL, CI only), `worker_user` (as app). No superuser at runtime.
- JWT secret rotation supported via keyid + dual-accept window.

## 10. Audit logging

Catalog and shape in `03-modules-platform-and-reports.md` Module 22. Security-relevant guarantees: append-only (no UPDATE/DELETE grants), actor + IP + user-agent captured, before/after diffs for sensitive fields (bank/salary diffs store masked values), **exports and sensitive downloads are themselves logged**, system jobs log under a system actor. Viewer restricted to `audit.view_all`.

## 11. Data protection & privacy

- **Field exposure rules** (canonical): salary/payslips → self + `payroll.*` holders only; bank account numbers → masked for self, full only to `payroll.manage` (and audited); identity documents → self + `documents.view_all`; DOB year hidden in team widgets; managers see work data only.
- TLS everywhere (HSTS); Postgres disk encryption; **column-level encryption** (AES-256-GCM, app-managed key) for `employee_bank_accounts.account_number_enc`.
- PII minimization: collect only fields with an HR purpose; candidate data purged per retention (§13).
- Backups encrypted (age/KMS) at rest and in transit.
- Access-on-request: employee sees own data through ESS by design; data export for a person (GDPR-style) = HR export of the employee profile (P3 automation).

## 12. Backup strategy

- Nightly `pg_dump` (custom format) to object storage + WAL archiving for PITR where the host supports it.
- Retention: 30 daily, 12 weekly, 12 monthly; encrypted; separate credentials from app.
- **Restore drill**: monthly scripted restore to staging + smoke test — a backup that hasn't been restored doesn't exist.
- Object storage: S3 versioning on the documents bucket; lifecycle to archive class at 90 days for soft-deleted keys.

## 13. Data retention (defaults; configurable `retention.*` settings)

| Entity | Retention | After expiry |
|---|---|---|
| payslips / payroll_runs | 7 years after fiscal year | archive export, then purge |
| attendance (punches+records) | 3 years | aggregate to monthly summaries, purge detail |
| leave_requests / balances | 3 years after year close | purge detail |
| candidates / applications (not hired) | 1 year after last activity | purge PII, keep anonymized funnel stats |
| documents (exited employees) | per category (contracts 7y, ID proofs 1y post-exit) | purge files + rows |
| audit_logs | 2 years | purge (export option first) |
| notifications | 6 months | purge |
| exited employee core record | retained (soft-deleted state) for reporting; PII fields nullable-scrub at 7y | scrub |

Retention jobs run weekly (worker), log what they purge, and never touch legal-hold-flagged rows (`legal_hold bool` — add to employees/documents when first needed, P3).

## 14. Security testing hooks (feeds `10-roadmap-testing-deployment.md`)

Must-have automated suites: permission matrix (every endpoint × role), tenant isolation (two companies), object-level (approve-own-request forbidden, manager-of-other-team forbidden, IDOR probes with foreign ids → 404), auth (lockout, token reuse, expired token, session-version logout), file access (foreign-tenant document id, presign tampering), rate-limit smoke, CSV-injection, sanitization snapshots. CI additionally runs dependency + secret scans. Annual external pentest before multi-tenant GA (P3 gate).

---

## Decisions made in this document

- Argon2id parameters pinned above; revisit only with measured server budgets.
- Breach-password checking ships with an embedded top-100k list in P1 (offline, no third-party call); HIBP API is P3.
- Column-level encryption limited to bank account numbers in P1/P2 — broader field encryption deferred until a compliance driver exists (cost/benefit).
- No CAPTCHA: lockout + rate limiting + invite-only accounts make it unnecessary; revisit if public careers portal (P3) adds public forms.
- Monthly restore drills are a hard operational requirement, tracked in the go-live checklist.
