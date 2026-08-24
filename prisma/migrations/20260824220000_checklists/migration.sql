-- Onboarding and offboarding, sharing one checklist mechanism
-- (docs/02-modules-talent.md §Module 12, docs/03-modules-platform-and-reports.md §Module 21).
--
-- One template mechanism, flagged by kind, because the blueprint asks for it
-- and because the two are the same shape: a named list of tasks, each owed by
-- somebody, each due a fixed number of days either side of a date that moves —
-- the join date on the way in, the last working day on the way out.
--
-- Instances live in one table for the same reason. A task is a task; what
-- differs is which date it counts from and whether an exit request owns it.

CREATE TYPE "checklist_kind" AS ENUM ('onboarding', 'offboarding');
CREATE TYPE "checklist_assignee" AS ENUM ('hr', 'it', 'manager', 'employee');
CREATE TYPE "checklist_task_status" AS ENUM ('pending', 'completed', 'skipped');
CREATE TYPE "offboarding_status" AS ENUM (
  'initiated', 'in_progress', 'cleared', 'settled', 'completed', 'cancelled'
);

CREATE TABLE "checklist_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "kind" "checklist_kind" NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  -- The one applied when nobody chooses. At most one per kind, below.
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "checklist_template_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "template_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "assignee" "checklist_assignee" NOT NULL,
  -- Days from the anchor date. Negative is before it, which is the normal
  -- case on the way out: hand the laptop back before the last day, not after.
  "due_offset_days" INTEGER NOT NULL DEFAULT 0,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "checklist_template_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "offboarding_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "requested_last_working_day" DATE NOT NULL,
  -- Set by HR at confirmation, from the notice period. Until then the
  -- requested day is a request, not a fact.
  "last_working_day" DATE,
  "status" "offboarding_status" NOT NULL DEFAULT 'initiated',
  "submitted_by" UUID,
  "approved_by" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "confirmed_by" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "cleared_at" TIMESTAMPTZ(6),
  "settled_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "cancellation_reason" TEXT,
  -- Settlement inputs, handed to payroll when it exists.
  "leave_encashment_days" NUMERIC(6, 2),
  "settlement_notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "offboarding_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "checklist_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "kind" "checklist_kind" NOT NULL,
  "employee_id" UUID NOT NULL,
  -- Set for offboarding tasks only; onboarding hangs off the employee alone.
  "offboarding_request_id" UUID,
  "template_id" UUID,
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "assignee" "checklist_assignee" NOT NULL,
  -- Resolved at instantiation. Null where nobody fills the role — an employee
  -- with no manager, say — which is why the task still names its assignee.
  "assigned_to_employee_id" UUID,
  "due_date" DATE,
  "is_required" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "status" "checklist_task_status" NOT NULL DEFAULT 'pending',
  "completed_by" UUID,
  "completed_at" TIMESTAMPTZ(6),
  "skip_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "checklist_tasks_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────
-- Keys
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;

ALTER TABLE "checklist_template_tasks" ADD CONSTRAINT "checklist_template_tasks_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "checklist_template_tasks" ADD CONSTRAINT "checklist_template_tasks_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE CASCADE;

ALTER TABLE "offboarding_requests" ADD CONSTRAINT "offboarding_requests_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "offboarding_requests" ADD CONSTRAINT "offboarding_requests_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT;

ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_offboarding_request_id_fkey"
  FOREIGN KEY ("offboarding_request_id") REFERENCES "offboarding_requests"("id") ON DELETE CASCADE;
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_template_id_fkey"
  FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE SET NULL;
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_assigned_to_employee_id_fkey"
  FOREIGN KEY ("assigned_to_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
CREATE INDEX "checklist_templates_company_kind_idx"
  ON "checklist_templates"("company_id", "kind") WHERE "deleted_at" IS NULL;

-- One default per kind. Partial, so archived templates do not hold the slot.
CREATE UNIQUE INDEX "checklist_templates_one_default_per_kind"
  ON "checklist_templates"("company_id", "kind")
  WHERE "is_default" AND "deleted_at" IS NULL;

CREATE INDEX "checklist_template_tasks_template_idx"
  ON "checklist_template_tasks"("template_id", "sort_order");

CREATE INDEX "offboarding_requests_company_status_idx"
  ON "offboarding_requests"("company_id", "status");

-- One live exit at a time. Somebody who resigned, withdrew, and resigned
-- again has two rows, and only the second is open.
CREATE UNIQUE INDEX "offboarding_requests_one_open_per_employee"
  ON "offboarding_requests"("employee_id")
  WHERE "status" NOT IN ('completed', 'cancelled');

CREATE INDEX "checklist_tasks_employee_idx" ON "checklist_tasks"("employee_id", "kind");
CREATE INDEX "checklist_tasks_assignee_idx"
  ON "checklist_tasks"("company_id", "assigned_to_employee_id", "status");
CREATE INDEX "checklist_tasks_due_idx"
  ON "checklist_tasks"("company_id", "status", "due_date");

-- ─────────────────────────────────────────────────────────────
-- Rules the database keeps, so no code path can forget them
-- ─────────────────────────────────────────────────────────────

-- A skipped task says why. Skipping quietly is how a checklist becomes theatre.
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_skip_has_reason"
  CHECK ("status" <> 'skipped' OR ("skip_reason" IS NOT NULL AND length(btrim("skip_reason")) > 0));

-- Completion records when, so "done" is never a claim without a date.
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_completion_is_stamped"
  CHECK ("status" <> 'completed' OR "completed_at" IS NOT NULL);

-- An offboarding task belongs to an exit; an onboarding task does not.
ALTER TABLE "checklist_tasks" ADD CONSTRAINT "checklist_tasks_request_matches_kind"
  CHECK (
    ("kind" = 'offboarding' AND "offboarding_request_id" IS NOT NULL)
    OR ("kind" = 'onboarding' AND "offboarding_request_id" IS NULL)
  );

-- Past initiated, a last working day exists. Every later step counts from it.
ALTER TABLE "offboarding_requests" ADD CONSTRAINT "offboarding_requests_confirmed_has_last_day"
  CHECK ("status" IN ('initiated', 'cancelled') OR "last_working_day" IS NOT NULL);

-- Cancelling says why, for the same reason skipping does.
ALTER TABLE "offboarding_requests" ADD CONSTRAINT "offboarding_requests_cancel_has_reason"
  CHECK (
    "status" <> 'cancelled'
    OR ("cancellation_reason" IS NOT NULL AND length(btrim("cancellation_reason")) > 0)
  );

-- ─────────────────────────────────────────────────────────────
-- Row-level security, the second isolation layer.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'checklist_templates', 'checklist_template_tasks', 'offboarding_requests', 'checklist_tasks'
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
