-- Job tasks: a unit of work on somebody's month, with a weight and a progress
-- figure (docs/02-modules-talent.md §Module 13, narrowed — see the model
-- comment in schema.prisma for what differs and why).

CREATE TYPE "task_origin" AS ENUM ('assigned', 'self');
CREATE TYPE "task_status" AS ENUM ('not_started', 'in_progress', 'completed', 'cancelled');

CREATE TABLE "job_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "created_by" UUID,
  "origin" "task_origin" NOT NULL DEFAULT 'assigned',
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "status" "task_status" NOT NULL DEFAULT 'not_started',
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "due_date" DATE,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "job_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_tasks_company_id_year_month_idx" ON "job_tasks" ("company_id", "year", "month");
CREATE INDEX "job_tasks_employee_id_year_month_idx" ON "job_tasks" ("employee_id", "year", "month");
CREATE INDEX "job_tasks_company_id_employee_id_status_idx"
  ON "job_tasks" ("company_id", "employee_id", "status");

ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- The ranges the completion maths depends on.
--
-- A weighted average is only meaningful if every part is inside its range. A
-- progress of 150 or a weight of 0 would not fail anywhere obvious; it would
-- just quietly make one person's number wrong.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_progress_range"
  CHECK ("progress" BETWEEN 0 AND 100);
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_weight_range"
  CHECK ("weight" BETWEEN 1 AND 100);
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_month_range"
  CHECK ("month" BETWEEN 1 AND 12);
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_year_range"
  CHECK ("year" BETWEEN 2000 AND 2100);

-- A completed task is finished. Letting one sit at 40% and `completed` would
-- mean the list and the percentage disagree about the same row.
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_completed_is_complete"
  CHECK ("status" <> 'completed' OR ("progress" = 100 AND "completed_at" IS NOT NULL));

ALTER TABLE "job_tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_tasks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "job_tasks"
  USING ("company_id" = app_current_company() OR app_bypass_rls())
  WITH CHECK ("company_id" = app_current_company() OR app_bypass_rls());
