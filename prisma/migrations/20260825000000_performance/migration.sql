-- Performance: review cycles, goals and the two-sided review
-- (docs/02-modules-talent.md §Module 13).
--
-- Goals reuse `job_tasks` rather than getting a table of their own. A job task
-- already is a goal — a titled piece of work with a weight, a progress figure
-- and a status — and a second table holding the same four columns would drift
-- from the first within a quarter.
--
-- What that costs is one carve-out, kept here rather than discovered later:
-- the monthly completion percentage counts tasks with no cycle. A half-year
-- goal sitting at 20% in March is not somebody having a bad March, and letting
-- it into that figure would quietly wreck the number it exists to give.

CREATE TYPE "performance_cycle_status" AS ENUM ('draft', 'active', 'review', 'closed');
CREATE TYPE "performance_review_status" AS ENUM ('pending_self', 'pending_manager', 'completed');

CREATE TABLE "performance_cycles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "period_start" DATE NOT NULL,
  "period_end" DATE NOT NULL,
  "review_deadline" DATE,
  "status" "performance_cycle_status" NOT NULL DEFAULT 'draft',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "performance_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "performance_reviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "cycle_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  -- Whoever the manager was when the review opened. Kept even if the
  -- reporting line moves later: the person who wrote the review is a fact
  -- about the review, not a lookup through today's org chart.
  "manager_id" UUID,
  "status" "performance_review_status" NOT NULL DEFAULT 'pending_self',
  "self_rating" SMALLINT,
  "self_comments" TEXT,
  "self_submitted_at" TIMESTAMPTZ(6),
  "manager_rating" SMALLINT,
  "manager_comments" TEXT,
  "manager_submitted_at" TIMESTAMPTZ(6),
  -- Set by HR when the cycle closes, and free to differ from the manager's:
  -- calibration across a department is the whole reason this column is not
  -- just a copy.
  "final_rating" SMALLINT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- Goals are job tasks that belong to a cycle and have been agreed.
ALTER TABLE "job_tasks" ADD COLUMN "cycle_id" UUID;
ALTER TABLE "job_tasks" ADD COLUMN "approved_by" UUID;
ALTER TABLE "job_tasks" ADD COLUMN "approved_at" TIMESTAMPTZ(6);

-- ─────────────────────────────────────────────────────────────
-- Keys
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;

ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_manager_id_fkey"
  FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL;

-- A cycle keeps its goals when it is deleted; they simply stop being goals.
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
CREATE INDEX "performance_cycles_company_status_idx"
  ON "performance_cycles"("company_id", "status");

-- One review per person per cycle. Two would mean two ratings and no answer.
CREATE UNIQUE INDEX "performance_reviews_one_per_employee_per_cycle"
  ON "performance_reviews"("cycle_id", "employee_id");

CREATE INDEX "performance_reviews_company_status_idx"
  ON "performance_reviews"("company_id", "status");
CREATE INDEX "performance_reviews_manager_idx"
  ON "performance_reviews"("manager_id", "status");

CREATE INDEX "job_tasks_cycle_idx" ON "job_tasks"("cycle_id");

-- ─────────────────────────────────────────────────────────────
-- Rules the database keeps
-- ─────────────────────────────────────────────────────────────

-- A period that ends before it starts is not a period.
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_period_ordered"
  CHECK ("period_end" >= "period_start");

-- The deadline for writing reviews cannot fall before the period they cover.
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_deadline_after_start"
  CHECK ("review_deadline" IS NULL OR "review_deadline" >= "period_start");

-- One to five, on every rating. Company-configurable labels sit on top of a
-- fixed scale, because a scale that changes shape makes last year's numbers
-- meaningless.
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_ratings_in_range"
  CHECK (
    ("self_rating" IS NULL OR "self_rating" BETWEEN 1 AND 5)
    AND ("manager_rating" IS NULL OR "manager_rating" BETWEEN 1 AND 5)
    AND ("final_rating" IS NULL OR "final_rating" BETWEEN 1 AND 5)
  );

-- Past the self stage, a self rating exists; past the manager stage, both do.
-- Submitting is what moves the status, so a status without its rating means
-- something wrote the row directly.
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_stages_have_ratings"
  CHECK (
    ("status" = 'pending_self')
    OR ("status" = 'pending_manager' AND "self_rating" IS NOT NULL)
    OR ("status" = 'completed' AND "self_rating" IS NOT NULL AND "manager_rating" IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────
-- Row-level security, the second isolation layer.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['performance_cycles', 'performance_reviews']
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
