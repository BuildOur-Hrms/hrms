-- CreateEnum
CREATE TYPE "accrual_frequency" AS ENUM ('monthly', 'yearly', 'none');

-- CreateEnum
CREATE TYPE "half_day_part" AS ENUM ('none', 'first_half', 'second_half');

-- CreateEnum
CREATE TYPE "leave_request_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "location_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "holiday_date" DATE NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "color" VARCHAR(9),
    "requires_attachment" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "accrual_frequency" "accrual_frequency" NOT NULL DEFAULT 'none',
    "accrual_amount" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "max_carry_forward" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "max_negative" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "min_notice_days" INTEGER NOT NULL DEFAULT 0,
    "max_consecutive_days" INTEGER,
    "applicable_after_probation" BOOLEAN NOT NULL DEFAULT false,
    "sandwich_rule" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "opening" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "accrued" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "used" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "carried_forward" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "adjusted" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "half_day" "half_day_part" NOT NULL DEFAULT 'none',
    "days" DECIMAL(4,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "attachment_key" VARCHAR(255),
    "status" "leave_request_status" NOT NULL DEFAULT 'pending',
    "approver_id" UUID,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holidays_company_id_holiday_date_idx" ON "holidays"("company_id", "holiday_date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_company_id_location_id_holiday_date_name_key" ON "holidays"("company_id", "location_id", "holiday_date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_company_id_code_key" ON "leave_types"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policies_leave_type_id_key" ON "leave_policies"("leave_type_id");

-- CreateIndex
CREATE INDEX "leave_balances_employee_id_year_idx" ON "leave_balances"("employee_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_company_id_employee_id_leave_type_id_year_key" ON "leave_balances"("company_id", "employee_id", "leave_type_id", "year");

-- CreateIndex
CREATE INDEX "leave_requests_company_id_status_idx" ON "leave_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_employee_id_start_date_idx" ON "leave_requests"("employee_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_requests_approver_id_status_idx" ON "leave_requests"("approver_id", "status");

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Constraints Prisma's schema language cannot express.
-- ─────────────────────────────────────────────────────────────

-- A leave span has to run forwards.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_dates_ordered"
  CHECK ("end_date" >= "start_date");

-- Half a day is only meaningful when the request is one day long. A
-- multi-day request with a half-day flag has no defensible day count.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_half_day_single"
  CHECK ("half_day" = 'none' OR "start_date" = "end_date");

-- Zero-day requests waste an approver's time; the day count is computed by
-- the server, so a zero here means the span was entirely holidays.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_days_positive"
  CHECK ("days" > 0);

-- A decided request names who decided it and when; a pending one names
-- neither. Half a review is how "approved by nobody" reaches an audit.
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_review_coherent"
  CHECK (
    ("status" = 'pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
    OR ("status" = 'cancelled')
    OR ("status" IN ('approved', 'rejected') AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  );

-- Balance components are never negative in themselves. `used` exceeding the
-- rest is what produces a negative balance, and the policy decides how far
-- that may go — the components themselves going negative is always a bug.
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_components_non_negative"
  CHECK (
    "opening" >= 0 AND "accrued" >= 0 AND "used" >= 0 AND "carried_forward" >= 0
  );

ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_year_valid"
  CHECK ("year" BETWEEN 2000 AND 2100);

-- An accruing policy that accrues nothing is a misconfiguration that shows up
-- months later as an empty balance.
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_accrual_coherent"
  CHECK (
    ("accrual_frequency" = 'none') OR ("accrual_amount" > 0)
  );

ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_amounts_non_negative"
  CHECK (
    "accrual_amount" >= 0
    AND "max_carry_forward" >= 0
    AND "max_negative" >= 0
    AND "min_notice_days" >= 0
    AND ("max_consecutive_days" IS NULL OR "max_consecutive_days" > 0)
  );

-- Two holidays on the same date for the same scope are one holiday entered
-- twice. The Prisma unique index treats NULL location as distinct, which
-- would let the company-wide case duplicate, so it is handled explicitly.
CREATE UNIQUE INDEX "holidays_company_wide_unique"
  ON "holidays" ("company_id", "holiday_date", "name") WHERE "location_id" IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Row-level security, matching 20260822000200_rls.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'holidays',
    'leave_types',
    'leave_policies',
    'leave_balances',
    'leave_requests'
  ]
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
