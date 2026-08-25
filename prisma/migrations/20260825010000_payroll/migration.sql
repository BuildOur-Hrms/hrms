-- Payroll, deliberately small (docs/02-modules-talent.md §Module 9).
--
-- A finance system will do the paying. What this owes it is the one thing an
-- HRMS knows and finance does not: who was actually at work, and therefore
-- what each person is owed this month. So there is no bank detail here, no
-- payment file and no statutory engine — a company that needs provident fund
-- writes it as a percentage deduction and the arithmetic falls out.
--
-- Money is stored in integer minor units throughout. Floating point money is
-- how payslips end up a rupee out and nobody can say why.

CREATE TYPE "salary_component_kind" AS ENUM ('earning', 'deduction');
CREATE TYPE "salary_calc_type" AS ENUM ('fixed', 'percentage');
CREATE TYPE "payroll_run_status" AS ENUM ('draft', 'approved', 'paid');

CREATE TABLE "salary_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "kind" "salary_component_kind" NOT NULL,
  "calc_type" "salary_calc_type" NOT NULL DEFAULT 'fixed',
  -- For a percentage component: the component it is a percentage of, which in
  -- practice is nearly always BASIC.
  "base_component_id" UUID,
  -- Whether loss of pay shrinks it. A fixed monthly reimbursement usually
  -- should not, which is the only reason this is a column and not a rule.
  "prorates" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_salaries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "effective_from" DATE NOT NULL,
  -- Closed when the next revision starts. Null means "still in force".
  "effective_to" DATE,
  "note" TEXT,
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_salary_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "salary_id" UUID NOT NULL,
  "component_id" UUID NOT NULL,
  -- One or the other, decided by the component's calc type.
  "amount_minor" BIGINT,
  "percent" NUMERIC(6, 3),
  CONSTRAINT "employee_salary_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "status" "payroll_run_status" NOT NULL DEFAULT 'draft',
  "note" TEXT,
  "approved_by" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "paid_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payslips" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "period_days" NUMERIC(5, 2) NOT NULL,
  "lop_days" NUMERIC(5, 2) NOT NULL DEFAULT 0,
  "payable_days" NUMERIC(5, 2) NOT NULL,
  "gross_minor" BIGINT NOT NULL DEFAULT 0,
  "deductions_minor" BIGINT NOT NULL DEFAULT 0,
  -- Free to be negative: a recovery larger than the month's pay is a real
  -- situation, and a payroll that clamps it to zero hides money owed.
  "net_minor" BIGINT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payslip_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "payslip_id" UUID NOT NULL,
  -- The component as it was, not as it is. Renaming "Special Allowance" next
  -- year must not rewrite what last year's payslip says it paid.
  "component_id" UUID,
  "code" VARCHAR(20) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "kind" "salary_component_kind" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "payslip_items_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────
-- Keys
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_base_component_id_fkey"
  FOREIGN KEY ("base_component_id") REFERENCES "salary_components"("id") ON DELETE SET NULL;

ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;

ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_salary_id_fkey"
  FOREIGN KEY ("salary_id") REFERENCES "employee_salaries"("id") ON DELETE CASCADE;
ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_component_id_fkey"
  FOREIGN KEY ("component_id") REFERENCES "salary_components"("id") ON DELETE RESTRICT;

ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;

ALTER TABLE "payslips" ADD CONSTRAINT "payslips_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE;
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT;

ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_payslip_id_fkey"
  FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE;
ALTER TABLE "payslip_items" ADD CONSTRAINT "payslip_items_component_id_fkey"
  FOREIGN KEY ("component_id") REFERENCES "salary_components"("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "salary_components_code_unique"
  ON "salary_components"("company_id", "code") WHERE "deleted_at" IS NULL;

CREATE INDEX "employee_salaries_employee_idx"
  ON "employee_salaries"("employee_id", "effective_from" DESC);

-- One salary in force per person at a time. A second open-ended revision
-- would make "what are they paid" a question with two answers.
CREATE UNIQUE INDEX "employee_salaries_one_current"
  ON "employee_salaries"("employee_id") WHERE "effective_to" IS NULL;

CREATE UNIQUE INDEX "employee_salary_items_one_per_component"
  ON "employee_salary_items"("salary_id", "component_id");

-- One run per company per month.
CREATE UNIQUE INDEX "payroll_runs_one_per_month"
  ON "payroll_runs"("company_id", "year", "month");

CREATE UNIQUE INDEX "payslips_one_per_employee_per_run"
  ON "payslips"("run_id", "employee_id");
CREATE INDEX "payslips_employee_idx" ON "payslips"("employee_id");
CREATE INDEX "payslip_items_payslip_idx" ON "payslip_items"("payslip_id", "sort_order");

-- ─────────────────────────────────────────────────────────────
-- Rules the database keeps
-- ─────────────────────────────────────────────────────────────

-- A percentage component is a percentage of something.
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_percentage_has_base"
  CHECK ("calc_type" <> 'percentage' OR "base_component_id" IS NOT NULL);

-- A component is never a percentage of itself.
ALTER TABLE "salary_components" ADD CONSTRAINT "salary_components_base_is_not_self"
  CHECK ("base_component_id" IS NULL OR "base_component_id" <> "id");

-- Exactly one of the two ways of saying how much.
ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_amount_xor_percent"
  CHECK (("amount_minor" IS NULL) <> ("percent" IS NULL));

ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_amount_not_negative"
  CHECK ("amount_minor" IS NULL OR "amount_minor" >= 0);

ALTER TABLE "employee_salary_items" ADD CONSTRAINT "employee_salary_items_percent_in_range"
  CHECK ("percent" IS NULL OR ("percent" >= 0 AND "percent" <= 100));

-- A revision that ends before it begins is not a revision.
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_month_in_range"
  CHECK ("month" BETWEEN 1 AND 12);

-- Approval is what makes a run real, and it records who and when together.
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_is_stamped"
  CHECK (
    "status" = 'draft'
    OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
  );

-- Days cannot be negative, and nobody is paid for more days than the month had.
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_days_are_sane"
  CHECK (
    "period_days" > 0
    AND "lop_days" >= 0
    AND "payable_days" >= 0
    AND "payable_days" <= "period_days"
  );

-- ─────────────────────────────────────────────────────────────
-- Row-level security, the second isolation layer.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'salary_components', 'employee_salaries', 'employee_salary_items',
    'payroll_runs', 'payslips', 'payslip_items'
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
