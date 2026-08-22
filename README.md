# HRMS

Employee lifecycle management: people, org structure, time, leave, payroll.

The blueprint in [`docs/`](docs/README.md) is the specification. This README is
only how to run what is built. Where the two disagree, the blueprint wins —
except for the deviations recorded at the bottom of this file.

**Current state:** Phase 1, milestones M0 (foundation) and M1 (org & employees).
Attendance, leave and holidays are M2–M3 and not built yet.

---

## Stack

| Layer     | Choice                                                          |
| --------- | --------------------------------------------------------------- |
| Framework | Next.js 15 (App Router, TypeScript strict)                      |
| UI        | Tailwind v4 + shadcn/ui (Base UI), lucide-react                 |
| Data      | TanStack Query + Table, react-hook-form + zod                   |
| API       | REST route handlers under `/api/v1`                             |
| Database  | PostgreSQL (Supabase) + Prisma 7 (`@prisma/adapter-pg`)         |
| Auth      | Auth.js v5 JWE session cookie, argon2id passwords               |
| AuthZ     | Permission RBAC + tenant-scoped Prisma extension + Postgres RLS |
| Jobs      | BullMQ + Redis (inline fallback driver in development)          |
| Mail      | Console / SMTP / Resend behind one interface                    |

---

## Getting started

### 1. Configure the environment

```bash
cp .env.example .env
```

Fill in at minimum `DATABASE_URL`, `DIRECT_DATABASE_URL` and `AUTH_SECRET`.
Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Supabase connection strings** (dashboard → Connect). Both are needed, and
they differ only by port:

| Variable              | Supavisor mode | Port | Why                                                                |
| --------------------- | -------------- | ---- | ------------------------------------------------------------------ |
| `DATABASE_URL`        | transaction    | 6543 | App runtime. Every query we issue is inside a transaction already. |
| `DIRECT_DATABASE_URL` | session        | 5432 | `prisma migrate` needs advisory locks and session state.           |

The direct endpoint (`db.<ref>.supabase.co:5432`) works too, but it is IPv6-only
without the IPv4 add-on, which breaks migrations from most laptops and from
GitHub Actions runners. Session mode is IPv4 and sidesteps that.

### 2. Or run everything locally with Docker

```bash
docker compose up -d
```

Brings up Postgres, Redis, MinIO and Mailpit. Then point `DATABASE_URL` and
`DIRECT_DATABASE_URL` at `postgresql://hrms:hrms@localhost:5432/hrms`, set
`REDIS_URL=redis://localhost:6379`, and `EMAIL_PROVIDER=smtp` with
`SMTP_URL=smtp://localhost:1025`. Mailpit's inbox is at http://localhost:8025.

### 3. Migrate, seed, verify

```bash
npm run db:deploy && npm run db:seed && npm run db:doctor
```

The seed is idempotent. It writes the permission catalog, the pilot company,
the four system roles with their grants, the settings defaults, and two
**invited** administrator accounts — then prints their invite links. No
password is ever seeded.

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000, follow an invite link from the seed output, set a
password, and sign in.

---

## Commands

| Command              | What it does                                        |
| -------------------- | --------------------------------------------------- |
| `npm run dev`        | Development server                                  |
| `npm run build`      | Generate the Prisma client and build for production |
| `npm run typecheck`  | `tsc --noEmit`                                      |
| `npm run lint`       | ESLint                                              |
| `npm run format`     | Prettier write                                      |
| `npm test`           | Vitest unit suite                                   |
| `npm run db:migrate` | Create and apply a migration (development)          |
| `npm run db:deploy`  | Apply pending migrations (CI, staging, production)  |
| `npm run db:seed`    | Idempotent seed                                     |
| `npm run db:studio`  | Prisma Studio                                       |
| `npm run db:doctor`  | Assert RLS, isolation and audit immutability hold   |

---

## How the code is organised

```
prisma/           schema, migrations (incl. hand-written RLS + constraints), seed
src/
  app/
    (auth)/       login, forgot-password, reset-password
    (app)/        authenticated shell — dashboard, me, team, hr, admin
    api/v1/       REST route handlers, one folder per resource
  modules/        DOMAIN LOGIC — auth, org, employees, rbac, settings, audit
  lib/            db, api pipeline, permissions, session, events, queue, mail
  components/     ui/ (shadcn), shared/, app-shell/
tests/            unit (integration and e2e land with M5)
```

**The rule that keeps this maintainable:** a module's tables are touched only by
that module's service functions. Cross-module needs call the other module's
exported service, never its tables. Route handlers are thin adapters — every one
of them is `withApi({ permission, schema }, ({ ctx, body }) => service(...))`.

### Request pipeline

Every `/api/v1` request goes through `withApi` in this order:

1. request id + logger
2. CSRF origin check on mutating methods
3. rate limit
4. authenticate — decode the session cookie, load the user, verify `session_version`
5. tenant resolve — open a transaction, set the RLS session variables
6. `requirePermission` — the permission the route declared
7. zod validation of body, query and path params
8. the service call

### Tenant isolation

Two independent layers, either of which is sufficient:

- **App layer** — a Prisma client extension injects `company_id` into every
  model operation, so business code cannot forget it.
- **Database layer** — RLS policies re-check the same thing against
  `app.company_id`, a transaction-local session variable.

Anything needing to escape both (login, which has no tenant context yet) goes
through the explicit `withPlatform()` helper.

### Permissions

`module.action` strings, defined once in `src/lib/permissions.ts` and seeded into
the database. The role matrix lives there as data, the seed writes it, and
`tests/unit/permissions.test.ts` asserts it — so drift between the docs and the
running system fails CI. Feature code never branches on a role name.

---

## Deviations from the blueprint

Each of these was a forced choice, not a preference:

1. **Auth.js v5 JWT primitives instead of the full NextAuth handler.**
   `docs/08-api.md` specifies `POST /api/v1/auth/login` with a defined error
   envelope, including distinct 422s for locked and disabled accounts. NextAuth's
   Credentials provider deliberately masks those distinctions. We use
   `@auth/core/jwt` for the session token and cookie — the same format, so SSO
   providers drop in later — and implement the documented endpoints ourselves.

2. **`FORCE ROW LEVEL SECURITY` instead of a separate `app_user` role.**
   `docs/09-security.md` §9 calls for a non-owner database role without
   `BYPASSRLS`. Managed Postgres hands you a single owner role, and an owner is
   exempt from RLS unless the table forces it. Every tenant table is `FORCE`d,
   which subjects the owner to the same policies. When a separate role is
   available, grant it — `FORCE` stays correct either way.

   **`FORCE` is not sufficient on its own.** A role holding the `BYPASSRLS`
   attribute ignores policies even on a forced table, and managed providers
   sometimes grant it to the role they give you. `npm run db:doctor` checks
   for exactly this and says so loudly. If it warns, create a dedicated role
   without `BYPASSRLS` and point `DATABASE_URL` at it before the system holds
   real employee data — until then the app-layer extension is the only thing
   enforcing tenancy.

3. **`audit_logs` immutability by trigger instead of by grant.**
   Same reason: with one owner role, a grant can be re-granted. A trigger
   rejects `UPDATE` and `DELETE` outright, with a transaction-local escape for
   the Phase 2 retention job.

4. **Prisma 7 rather than the Prisma 5/6 the blueprint assumed.**
   Driver-adapter based (`@prisma/adapter-pg`). Client extensions, interactive
   transactions and `$executeRawUnsafe` all work as the blueprint's tenancy
   design requires.

5. **`employees.candidate_id` is not in the schema yet.**
   It references `candidates`, a Phase 2 recruitment table. It lands with that
   migration set rather than as a dangling column.

6. **The queue has an inline fallback driver.**
   Without `REDIS_URL`, jobs run in-process after the response — no retries.
   It refuses to start in production. This exists so the whole flow can be
   exercised with only Postgres running.

---

## What is not built yet

Phase 1 milestones M2 onward: shifts, attendance (punches, nightly calculation,
corrections, month locks), leave (types, policies, balances, accruals,
requests), holidays, notifications, dashboards beyond headcount, and the
integration / permission-matrix / e2e test suites. Build order is
`docs/10-roadmap-testing-deployment.md` §6.
