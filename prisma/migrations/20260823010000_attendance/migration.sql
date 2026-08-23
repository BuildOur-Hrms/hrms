-- CreateEnum
CREATE TYPE "punch_direction" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "attendance_source" AS ENUM ('web', 'mobile', 'biometric', 'manual');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'absent', 'half_day', 'on_leave', 'holiday', 'week_off');

-- CreateTable
CREATE TABLE "attendance_punches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "punched_at" TIMESTAMPTZ(6) NOT NULL,
    "direction" "punch_direction" NOT NULL,
    "source" "attendance_source" NOT NULL DEFAULT 'web',
    "note" VARCHAR(255),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "status" "attendance_status" NOT NULL,
    "source" "attendance_source" NOT NULL DEFAULT 'web',
    "first_in" TIMESTAMPTZ(6),
    "last_out" TIMESTAMPTZ(6),
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_approved" BOOLEAN NOT NULL DEFAULT false,
    "overtime_approved_by" UUID,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_punches_company_id_employee_id_punched_at_idx" ON "attendance_punches"("company_id", "employee_id", "punched_at");

-- CreateIndex
CREATE INDEX "attendance_records_company_id_work_date_idx" ON "attendance_records"("company_id", "work_date");

-- CreateIndex
CREATE INDEX "attendance_records_company_id_work_date_status_idx" ON "attendance_records"("company_id", "work_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_company_id_employee_id_work_date_key" ON "attendance_records"("company_id", "employee_id", "work_date");

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_overtime_approved_by_fkey" FOREIGN KEY ("overtime_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Constraints Prisma's schema language cannot express.
-- docs/04-database.md §2.4.
-- ─────────────────────────────────────────────────────────────

-- Computed minute counts are never negative. A negative worked_minutes has
-- only ever meant an overnight shift subtracted the wrong way round, and it
-- reaches payroll if nothing stops it here.
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_minutes_non_negative"
  CHECK (
    "worked_minutes" >= 0
    AND "late_minutes" >= 0
    AND "overtime_minutes" >= 0
  );

-- A day cannot record more than 24 hours of work.
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_worked_within_a_day"
  CHECK ("worked_minutes" <= 1440);

-- Check-out cannot precede check-in on the same record. Both null (absent,
-- week-off, holiday) is legitimate.
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_in_before_out"
  CHECK ("first_in" IS NULL OR "last_out" IS NULL OR "last_out" >= "first_in");

-- Approved overtime must name an approver, and an approver without approval
-- is a half-written row.
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_overtime_approval_coherent"
  CHECK (
    ("overtime_approved" = false AND "overtime_approved_by" IS NULL)
    OR ("overtime_approved" = true AND "overtime_approved_by" IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────
-- Row-level security, matching 20260822000200_rls.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_punches', 'attendance_records']
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

-- ─────────────────────────────────────────────────────────────
-- Punches are append-only, like audit_logs. The correction flow supersedes a
-- bad punch with a new record rather than rewriting history, and payroll
-- disputes are settled by what was actually pressed — so the database refuses
-- the rewrite rather than trusting every future caller not to try.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION attendance_punches_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance_punches is append-only (attempted %)', TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER attendance_punches_no_update
  BEFORE UPDATE OR DELETE ON "attendance_punches"
  FOR EACH ROW EXECUTE FUNCTION attendance_punches_append_only();
