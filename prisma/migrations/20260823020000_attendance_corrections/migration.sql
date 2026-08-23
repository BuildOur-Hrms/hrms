-- CreateEnum
CREATE TYPE "correction_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "requested_in" TIMESTAMPTZ(6),
    "requested_out" TIMESTAMPTZ(6),
    "requested_status" "attendance_status",
    "reason" TEXT NOT NULL,
    "status" "correction_status" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_corrections_company_id_status_idx" ON "attendance_corrections"("company_id", "status");

-- CreateIndex
CREATE INDEX "attendance_corrections_employee_id_work_date_idx" ON "attendance_corrections"("employee_id", "work_date");

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Constraints Prisma's schema language cannot express.
-- ─────────────────────────────────────────────────────────────

-- A request that asks for nothing cannot be acted on. At least one of the
-- three fields has to carry an intention.
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_asks_for_something"
  CHECK (
    "requested_in" IS NOT NULL
    OR "requested_out" IS NOT NULL
    OR "requested_status" IS NOT NULL
  );

-- Times must be ordered when both are given.
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_in_before_out"
  CHECK (
    "requested_in" IS NULL
    OR "requested_out" IS NULL
    OR "requested_out" >= "requested_in"
  );

-- A decided request names who decided it and when; a pending one names
-- neither. Half a review is how "approved by nobody" reaches an audit.
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_review_coherent"
  CHECK (
    ("status" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" = 'cancelled')
    OR ("status" IN ('approved', 'rejected') AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  );

-- One open request per employee per day. Two pending corrections for the same
-- date would let an approver apply contradictory times in either order.
CREATE UNIQUE INDEX "attendance_corrections_one_pending_per_day"
  ON "attendance_corrections" ("employee_id", "work_date") WHERE "status" = 'pending';

-- ─────────────────────────────────────────────────────────────
-- Row-level security, matching 20260822000200_rls.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "attendance_corrections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_corrections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_corrections"
  USING (company_id = app_current_company() OR app_bypass_rls())
  WITH CHECK (company_id = app_current_company() OR app_bypass_rls());
