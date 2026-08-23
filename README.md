# HRMS

Employee lifecycle management: people, org structure, time, leave, payroll.

The blueprint in [`docs/`](docs/README.md) is the specification. This README is
only how to run what is built. Where the two disagree, the blueprint wins —
except for the deviations recorded at the bottom of this file.

**Current state:** Phase 1, milestones M0 (foundation), M1 (org & employees) and
the shifts half of M2. Attendance itself, leave and holidays are not built yet.

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

## Deploying to Vercel

The repo is connected to Vercel and builds with no configuration — Next.js is
auto-detected and `npm run build` already runs `prisma generate` first. What
does need attention is the environment, and the fact that a serverless host has
no worker process.

### 1. Run migrations first

Vercel does **not** run migrations, and it should not: a build that mutates the
production schema is a build that can half-apply one. Apply them yourself
before the first deploy, from a machine that has `DIRECT_DATABASE_URL`:

```bash
npm run db:deploy && npm run db:seed && npm run db:doctor
```

Deploying against an empty database gives a working build and a 500 on every
page, which is a confusing way to find this out.

### 2. Environment variables

Set these in **Project → Settings → Environment Variables**, for Production and
Preview, then redeploy.

The build itself does **not** need them — it imports route modules to collect
metadata, and nothing there opens a connection — so a build with an incomplete
environment succeeds and prints one warning naming what is missing. The strict
check runs on the first request instead, which is the only place it can
meaningfully run. Leaving a variable declared but blank counts as not setting
it: `""` is treated as absent so the schema default applies, rather than
failing validation on a value nobody chose.

| Variable              | Value                                         |
| --------------------- | --------------------------------------------- |
| `DATABASE_URL`        | Supabase transaction pooler, port 6543        |
| `DIRECT_DATABASE_URL` | Supabase session pooler, port 5432            |
| `AUTH_SECRET`         | 32+ random bytes, base64                      |
| `QUEUE_DRIVER`        | `inline` — see below                          |
| `EMAIL_PROVIDER`      | `resend` (and `RESEND_API_KEY`, `EMAIL_FROM`) |
| `CRON_SECRET`         | 32 random bytes, base64 — see below           |
| `SEED_DEMO`           | `false`                                       |

`APP_URL` is deliberately **not** in that list. It is derived from Vercel's own
`VERCEL_PROJECT_PRODUCTION_URL` on production and `VERCEL_URL` on previews, so
invite links in a preview deployment point at that preview rather than at
production. Set `APP_URL` explicitly only once there is a custom domain.

### 3. `QUEUE_DRIVER=inline` is required, and it is a trade-off

There is no worker process on Vercel, so BullMQ has nothing to consume a queue.
`QUEUE_DRIVER=inline` runs jobs inside the request that triggered them:

- Invite and reset emails **are** sent, and the request waits for them.
- A failed job is logged and lost. There are no retries.
- Scheduled work (the M2/M3 cron set: attendance calculation, leave accrual)
  cannot run at all this way.

That is fine for M0–M1, where the only job is transactional email. Before
attendance and leave land, either point `REDIS_URL` at a managed Redis and run
the worker somewhere with a real process, or move the cron jobs to Vercel Cron
hitting authenticated endpoints. The app refuses to fall into inline mode in
production silently — without `QUEUE_DRIVER=inline` set, enqueueing throws and
`/api/health?ready=1` reports the queue as unavailable.

### 3b. Scheduled jobs

There is no worker process on Vercel, so the nightly attendance rebuild runs as
a Vercel Cron hitting `/api/v1/cron/attendance-daily-calc`. The schedule lives
in `vercel.json` and is **UTC**: `30 19 * * *` is 01:00 in Asia/Kolkata, just
after the day it rebuilds has ended. Each company's "yesterday" is resolved in
that company's own timezone, not the server's.

The route is authenticated by `CRON_SECRET` alone — there is no session to
check. Without the variable set it refuses every request rather than defaulting
to open, because an unauthenticated endpoint that rebuilds attendance for every
employee is not a thing to fail open.

### 4. Region

Functions must run in the same region as the Supabase project. Every request
opens a transaction and does several round trips inside it, so a cross-continent
hop turns a 40 ms page into a 400 ms one.

This is pinned in `vercel.json` rather than left to the dashboard, because the
default (`iad1`, Washington) is nowhere near the database and nothing about a
slow page says why:

```json
{ "regions": ["sin1"] }
```

`sin1` is Singapore, matching the Supabase project on
`aws-0-ap-southeast-1.pooler.supabase.com`. **Move the database and this has to
move with it** — the two are a pair, and a mismatch is invisible until someone
complains that the app feels slow.

### 5. Check it

```
GET https://<deployment>/api/health           liveness
GET https://<deployment>/api/health?ready=1   database + queue readiness
```

Readiness returns 503 with a per-dependency breakdown when something is wrong,
which is what an uptime monitor should watch.

### Serverless adjustments already made

- **Connection pool** capped at 3 per instance with a 10s idle timeout. Each
  warm function instance holds its own pool; the default of 10 multiplied by
  the instance count is how a Supabase project runs out of connections.
- **Jobs are awaited** rather than detached. A serverless function is frozen the
  moment it returns a response, so a fire-and-forget promise never completes.
- **argon2 native binaries** are pinned into the function bundle via
  `outputFileTracingIncludes`. The platform-specific binary is selected by a
  runtime `require` that static tracing does not reliably follow.

---

## Commands

| Command                     | What it does                                                     |
| --------------------------- | ---------------------------------------------------------------- |
| `npm run dev`               | Development server                                               |
| `npm run build`             | Generate the Prisma client and build for production              |
| `npm run typecheck`         | `tsc --noEmit`                                                   |
| `npm run lint`              | ESLint                                                           |
| `npm run format`            | Prettier write                                                   |
| `npm test`                  | Vitest unit suite                                                |
| `npm run db:migrate`        | Create and apply a migration (development)                       |
| `npm run db:deploy`         | Apply pending migrations (CI, staging, production)               |
| `npm run db:seed`           | Idempotent seed                                                  |
| `npm run db:studio`         | Prisma Studio                                                    |
| `npm run db:doctor`         | Assert RLS, isolation and audit immutability hold                |
| `npm run db:remove-demo`    | Remove the seeded demo org (dry run without `-- --apply`)        |
| `npm run db:rename-company` | Rename the company, slug included (dry run without `-- --apply`) |

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

Phase 1 milestones M2 onward, minus shifts: attendance (punches, nightly
calculation, corrections, month locks), leave (types, policies, balances,
accruals, requests), holidays, notifications, dashboards beyond headcount, and
the integration / permission-matrix / e2e test suites. Build order is
`docs/10-roadmap-testing-deployment.md` §6.

Shift definitions and assignment history landed ahead of the rest of M2,
because attendance cannot be calculated without knowing which rules were in
force on a date. `EmployeeShift` is append-and-close rather than editable for
the same reason: recomputing a past month has to use the shift that applied
then, not the one that applies now.
