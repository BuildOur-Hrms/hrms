-- CreateTable
CREATE TABLE "attendance_month_locks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "locked_by" UUID NOT NULL,
    "locked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "employeeId" UUID,

    CONSTRAINT "attendance_month_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_month_locks_company_id_year_month_key" ON "attendance_month_locks"("company_id", "year", "month");

-- AddForeignKey
ALTER TABLE "attendance_month_locks" ADD CONSTRAINT "attendance_month_locks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_month_locks" ADD CONSTRAINT "attendance_month_locks_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_month_locks" ADD CONSTRAINT "attendance_month_locks_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Constraints and RLS.
-- ─────────────────────────────────────────────────────────────

-- A month outside 1..12 would silently never match a record.
ALTER TABLE "attendance_month_locks" ADD CONSTRAINT "attendance_month_locks_month_valid"
  CHECK ("month" BETWEEN 1 AND 12);

ALTER TABLE "attendance_month_locks" ADD CONSTRAINT "attendance_month_locks_year_valid"
  CHECK ("year" BETWEEN 2000 AND 2100);

ALTER TABLE "attendance_month_locks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_month_locks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "attendance_month_locks"
  USING (company_id = app_current_company() OR app_bypass_rls())
  WITH CHECK (company_id = app_current_company() OR app_bypass_rls());
