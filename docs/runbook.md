# Runbook — operating this system

> Companion to `10-roadmap-testing-deployment.md`. That document says what the
> policy is; this one says what to type. Everything here is meant to be run by
> a person on a bad day, so each procedure states what it changes and what it
> costs before the commands.

---

## 1. Commands

| Command | What it does |
|---|---|
| `npm run db:local` | A real PostgreSQL on `localhost:5432` with nothing to install (PGlite). Leave it running. |
| `npm run db:deploy` | Apply migrations. The only way schema changes reach any database. |
| `npm run db:role` | Create `app_user` — the non-superuser role the app connects as. **Run once per database.** |
| `npm run db:doctor` | Check the live database: RLS enabled and forced, policies present, isolation probe. |
| `npm run db:seed` | Permission catalog, roles, settings, the pilot company, two invited admins. Idempotent. No passwords. |
| `npm run db:seed-load` | The 500-employee performance fixture. Never in production. |
| `npm run db:seed-e2e` | Accounts with known passwords, for the browser tests. Never in production. |
| `npm run matrix` | Regenerate `docs/permission-matrix.md` from the routes. |
| `npm run bench` | Time the heavy reads against the load fixture. |
| `npm test` | Unit suites. |
| `npm run test:integration` | Isolation, permission matrix and workflow guards, against a real database. |
| `npm run test:e2e` | Browser journeys against a production build. |

> **On the local database.** `npm run db:local` runs PGlite — PostgreSQL
> compiled to WebAssembly — which serialises every query through one thread.
> It is enough for development and for the application half of the integration
> suite, and it will drop connections under a sustained run. Two consequences:
> set `DB_POOL_MAX=2` when pointing a server at it (the test configs already
> do), and expect the row-level-security tests to skip, because PGlite always
> connects as `postgres` and a superuser bypasses every policy. CI runs both
> suites against real Postgres, which is where those assertions actually
> execute.

---

## 2. The one thing people get wrong

**The application must not connect as the database owner.**

Row-level security is the second isolation layer, and it is switched off for a
superuser — `FORCE ROW LEVEL SECURITY` subjects a table's *owner* to its
policies, but a superuser skips them entirely. Connect the app as the owner and
every policy is decoration: `db:doctor` still reports them enabled, the app
still works, and the layer that exists for the day the application layer is
wrong is not there.

```bash
npm run db:role                 # as the owner, once per database
```

Then `DATABASE_URL` points at `app_user`, and `DIRECT_DATABASE_URL` stays the
owner because migrations need DDL. `npm run db:doctor` flips its isolation
probe from FAIL to PASS, and the integration suite refuses to run at all
against a connection that can bypass policies.

---

## 3. Deploying

Order matters: migrate first, then roll out. Releases are backward-compatible
by policy, so the old image runs fine against the new schema for the minutes
between the two.

```bash
npx prisma migrate deploy       # CI step, before the app rollout
```

**Every deploy:** CI green including the isolation and permission-matrix
suites · staging migration rehearsed · smoke passed · Sentry release created ·
previous image still present and known-good.

**Rolling back:** redeploy the previous image. Database migrations are
roll-forward only in production — there are no down migrations. A migration
that turns out to be wrong is fixed by another migration. Risky Phase 2
modules ship behind flags, so for those, rollback is a flag.

---

## 4. Backups and the restore drill

Nightly `pg_dump` in custom format, plus WAL archiving for point-in-time
recovery where the host supports it. Retention: 30 daily, 12 weekly, 12
monthly, encrypted, with credentials separate from the application's.

### The drill — monthly, calendar-tracked

A backup that has not been restored does not exist. Run this against
**staging**, never production, and record the date and the row counts.

```bash
# 1. Take the most recent nightly backup.
aws s3 cp "s3://$BACKUP_BUCKET/$(date -d yesterday +%Y-%m-%d)/hrms.dump" ./restore.dump

# 2. A scratch database to restore into.
createdb -h "$STAGING_HOST" -U "$OWNER" hrms_restore_drill

# 3. Restore. `--no-owner` because the drill database has a different owner;
#    `--clean` so a re-run starts from the same place.
pg_restore --no-owner --clean --if-exists \
  -h "$STAGING_HOST" -U "$OWNER" -d hrms_restore_drill ./restore.dump

# 4. Prove it is a working database, not just a set of files.
psql -h "$STAGING_HOST" -U "$OWNER" -d hrms_restore_drill -c \
  "SELECT (SELECT count(*) FROM employees) AS employees,
          (SELECT count(*) FROM attendance_records) AS attendance,
          (SELECT count(*) FROM audit_logs) AS audit,
          (SELECT max(created_at) FROM audit_logs) AS newest_audit_row"

# 5. Prove the isolation layers came back with it — a restore that dropped
#    the policies would look completely healthy until the day it mattered.
DATABASE_URL="postgresql://$OWNER@$STAGING_HOST/hrms_restore_drill" npm run db:doctor

# 6. Tear it down.
dropdb -h "$STAGING_HOST" -U "$OWNER" hrms_restore_drill
```

**Record after each drill:** the date, the backup's date, the four counts from
step 4, the `db:doctor` result, and how long the whole thing took. The elapsed
time is the number that matters — it is the recovery time objective, measured
rather than assumed.

| Date | Backup from | Employees | Attendance | Audit rows | doctor | Elapsed |
|---|---|---|---|---|---|---|
| _not yet run_ | | | | | | |

> The drill has not been executed against real infrastructure. It is the one
> go-live item that cannot be completed from a development machine, and it
> must be done and recorded above before the pilot company is onboarded.

---

## 5. Go-live checklist (pilot)

Nothing here is optional, and the last two are the ones people skip.

- [ ] Production environment variables set, every secret rotated off its default
- [ ] `npm run db:deploy` run against production
- [ ] `npm run db:role` run, and `DATABASE_URL` pointed at `app_user`
- [ ] `npm run db:doctor` passes, including the isolation probe
- [ ] `npm run db:seed` run — permissions, roles, company, settings, shifts, leave types
- [ ] Admin and HR users invited, and both have signed in
- [ ] Email domain verified (SPF and DKIM), and a real invite delivered to a real inbox
- [ ] Rate limits enabled (Redis reachable, or the in-process fallback understood)
- [ ] `CRON_SECRET` set, and each scheduled endpoint returns 401 without it
- [ ] Scheduled jobs firing: nightly attendance calc, monthly accrual, daily notices
- [ ] Audit logging verified end to end — sign in, then find that row in `/admin/audit-logs`
- [ ] Backups running **and one restore tested** (§4)
- [ ] Uptime check on `/api/health?ready=1`, alerting to a human
- [ ] Dead-man alert on the nightly attendance job — silence is the failure mode

---

## 6. Monitoring

Watch `/api/health?ready=1`: it checks the database and the queue, and returns
non-200 when either is down. The bare `/api/health` is a liveness probe and
stays cheap on purpose — a load balancer restarting the process over a slow
query is worse than the slow query.

Alert on: p95 latency, 5xx rate, job failure count, queue depth over threshold,
and a **missed nightly attendance calculation**. That last one is a dead-man
switch: the job failing is loud, but the job never running is silent, and the
first anyone hears of it is a month of attendance that was never calculated.

---

## 7. When something is wrong

**"A user can see another company's data."** Stop and treat it as an incident.
Check `npm run db:doctor` first — if the isolation probe fails, the app is
connected as a role that bypasses RLS (§2), and that is the whole explanation.

**"The nightly attendance job did not run."** It is idempotent and takes a
date, so re-running it is safe:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$APP_URL/api/v1/cron/attendance-daily-calc"
```

Recomputing a locked month is refused by design. Reopen the month, recompute,
lock it again — and expect the reopen and the re-lock to both be in the audit
log, because they both change what payroll may pay.

**"Emails are not arriving."** `EMAIL_PROVIDER=console` writes them to the log
instead of sending; the app warns once on the first send in production. Check
that before suspecting the provider.

**"Someone is locked out."** Five failed attempts locks an account for a
period. It clears on its own; a password reset clears it immediately and also
bumps `session_version`, which kills every session already open — which is what
makes a reset an actual remedy rather than a formality.
