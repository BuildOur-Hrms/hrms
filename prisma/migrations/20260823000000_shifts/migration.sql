-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "grace_minutes" INTEGER NOT NULL DEFAULT 10,
    "half_day_threshold_minutes" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "week_off_days" INTEGER[] DEFAULT ARRAY[0, 6]::INTEGER[],
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_company_id_idx" ON "shifts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_company_id_code_key" ON "shifts"("company_id", "code");

-- CreateIndex
CREATE INDEX "employee_shifts_employee_id_effective_from_idx" ON "employee_shifts"("employee_id", "effective_from");

-- CreateIndex
CREATE INDEX "employee_shifts_company_id_idx" ON "employee_shifts"("company_id");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Constraints Prisma's schema language cannot express.
-- docs/04-database.md §2.4.
-- ─────────────────────────────────────────────────────────────

-- At most one default shift per company. Partial, so the many non-default
-- rows do not collide with each other.
CREATE UNIQUE INDEX "shifts_one_default_per_company"
  ON "shifts" ("company_id") WHERE "is_default" AND "deleted_at" IS NULL;

-- A shift that ends when it starts has no duration; one that runs past its
-- own start is overnight, which is legal.
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_times_differ"
  CHECK ("start_time" <> "end_time");

ALTER TABLE "shifts" ADD CONSTRAINT "shifts_minutes_sane"
  CHECK (
    "grace_minutes" BETWEEN 0 AND 240
    AND "break_minutes" BETWEEN 0 AND 480
    AND "half_day_threshold_minutes" BETWEEN 1 AND 1440
  );

-- 0=Sunday … 6=Saturday. An out-of-range weekday would silently never match.
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_week_off_days_valid"
  CHECK ("week_off_days" <@ ARRAY[0,1,2,3,4,5,6]);

-- An assignment that ends before it begins would make the effective-shift
-- lookup for a date ambiguous.
ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_range_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- At most one OPEN-ENDED assignment per employee. This is the overlap that
-- actually happens: two concurrent assigns both leaving effective_to NULL,
-- after which "which shift is this employee on today" has two answers. Plain
-- btree, so it holds on every Postgres including the WASM build used for
-- local development.
CREATE UNIQUE INDEX "employee_shifts_one_open"
  ON "employee_shifts" ("employee_id") WHERE "effective_to" IS NULL;

-- Full overlap protection needs btree_gist, for the `=` operator on uuid
-- inside a gist index. Supabase ships it; the PGlite build used for local
-- development does not, and a migration that hard-failed there would make the
-- project undevelopable offline. So it is applied where available and skipped
-- where not: docs/04-database.md §2.4 calls this "optional hardening", with
-- the service closing the previous range as the primary guarantee.
--
-- The EXCEPTION block matters — it rolls back to an implicit savepoint rather
-- than aborting the whole migration. daterange upper bounds are exclusive,
-- hence the +1 day; a NULL effective_to yields an unbounded upper, which is
-- exactly the open-ended case.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE "employee_shifts" ADD CONSTRAINT "employee_shifts_no_overlap"
    EXCLUDE USING gist (
      "employee_id" WITH =,
      daterange("effective_from", "effective_to" + 1, '[)') WITH &&
    );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'btree_gist unavailable; overlap protection limited to the open-ended unique index';
END
$$;

-- ─────────────────────────────────────────────────────────────
-- Row-level security, matching 20260822000200_rls.
-- A new tenant table without policies is a hole in the second isolation
-- layer, and nothing else in the system would notice.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts', 'employee_shifts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (company_id = app_current_company() OR app_bypass_rls())
         WITH CHECK (company_id = app_current_company() OR app_bypass_rls())', t);
  END LOOP;
END
$$;
