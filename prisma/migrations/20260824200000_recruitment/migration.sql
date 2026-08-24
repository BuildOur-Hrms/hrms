-- Recruitment: job postings through to an accepted offer becoming an employee
-- (docs/02-modules-talent.md §Module 11).

CREATE TYPE "job_status" AS ENUM ('draft', 'open', 'on_hold', 'closed');
CREATE TYPE "candidate_source" AS ENUM ('referral', 'portal', 'agency', 'direct');
CREATE TYPE "application_stage" AS ENUM ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected');
CREATE TYPE "interview_mode" AS ENUM ('onsite', 'video', 'phone');
CREATE TYPE "interview_recommendation" AS ENUM ('strong_yes', 'yes', 'no', 'strong_no');
CREATE TYPE "offer_status" AS ENUM ('draft', 'sent', 'accepted', 'declined', 'withdrawn');

CREATE TABLE "job_postings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "department_id" UUID NOT NULL,
  "designation_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "employment_type" "employment_type" NOT NULL,
  "openings" INTEGER NOT NULL DEFAULT 1,
  "description" TEXT,
  "salary_min" BIGINT,
  "salary_max" BIGINT,
  "status" "job_status" NOT NULL DEFAULT 'draft',
  "closed_at" TIMESTAMPTZ(6),
  "created_by" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "first_name" VARCHAR(80) NOT NULL,
  "last_name" VARCHAR(80),
  "email" VARCHAR(160) NOT NULL,
  "phone" VARCHAR(30),
  "source" "candidate_source" NOT NULL DEFAULT 'direct',
  "resume_key" VARCHAR(255),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "applications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "job_posting_id" UUID NOT NULL,
  "stage" "application_stage" NOT NULL DEFAULT 'applied',
  "rejection_reason" TEXT,
  "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hired_employee_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "interviews" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "round_name" VARCHAR(80) NOT NULL,
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
  "interviewer_id" UUID NOT NULL,
  "mode" "interview_mode" NOT NULL DEFAULT 'video',
  "feedback" TEXT,
  "rating" INTEGER,
  "recommendation" "interview_recommendation",
  "submitted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "interviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "offers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "designation_id" UUID NOT NULL,
  "ctc" BIGINT NOT NULL,
  "joining_date" DATE NOT NULL,
  "expiry_date" DATE,
  "status" "offer_status" NOT NULL DEFAULT 'draft',
  "approved_by" UUID,
  "approved_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "responded_at" TIMESTAMPTZ(6),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────
-- Keys and indexes.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "candidates_company_id_email_key" ON "candidates" ("company_id", "email");
CREATE INDEX "candidates_company_id_idx" ON "candidates" ("company_id");
CREATE INDEX "job_postings_company_id_status_idx" ON "job_postings" ("company_id", "status");

-- One application per person per job. A second is not a second chance, it is
-- a duplicate that splits the history of the same conversation in two.
CREATE UNIQUE INDEX "applications_candidate_id_job_posting_id_key"
  ON "applications" ("candidate_id", "job_posting_id");
CREATE UNIQUE INDEX "applications_hired_employee_id_key"
  ON "applications" ("hired_employee_id");
CREATE INDEX "applications_company_id_stage_idx" ON "applications" ("company_id", "stage");

CREATE INDEX "interviews_company_id_scheduled_at_idx" ON "interviews" ("company_id", "scheduled_at");
CREATE INDEX "interviews_interviewer_id_scheduled_at_idx"
  ON "interviews" ("interviewer_id", "scheduled_at");
CREATE INDEX "offers_company_id_status_idx" ON "offers" ("company_id", "status");

ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidates" ADD CONSTRAINT "candidates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_posting_id_fkey" FOREIGN KEY ("job_posting_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "applications" ADD CONSTRAINT "applications_hired_employee_id_fkey" FOREIGN KEY ("hired_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "interviews" ADD CONSTRAINT "interviews_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_interviewer_id_fkey" FOREIGN KEY ("interviewer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offers" ADD CONSTRAINT "offers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT "offers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- The rules the pipeline would otherwise only remember in code.
-- ─────────────────────────────────────────────────────────────

-- A rejection without a reason is the row somebody needs six months later and
-- cannot reconstruct.
ALTER TABLE "applications" ADD CONSTRAINT "applications_rejection_has_reason"
  CHECK ("stage" <> 'rejected' OR ("rejection_reason" IS NOT NULL AND length(btrim("rejection_reason")) > 0));

-- Hired means there is somebody on the payroll to point at.
ALTER TABLE "applications" ADD CONSTRAINT "applications_hired_has_employee"
  CHECK ("stage" <> 'hired' OR "hired_employee_id" IS NOT NULL);

ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_openings_positive"
  CHECK ("openings" > 0);

-- A band that runs backwards is a typo, and it would silently make every
-- offer inside it look out of range.
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_salary_band_ordered"
  CHECK ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_min" <= "salary_max");

ALTER TABLE "interviews" ADD CONSTRAINT "interviews_rating_range"
  CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);

-- Feedback is a rating, a recommendation and words together, or none of them.
-- Half-submitted feedback is the kind a panel argues about afterwards.
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_feedback_complete"
  CHECK (
    "submitted_at" IS NULL
    OR ("rating" IS NOT NULL AND "recommendation" IS NOT NULL)
  );

ALTER TABLE "offers" ADD CONSTRAINT "offers_ctc_positive" CHECK ("ctc" > 0);

-- The approval gate, in the database rather than only in the service: an
-- offer past draft has been signed off by somebody, and the row says who.
ALTER TABLE "offers" ADD CONSTRAINT "offers_sent_requires_approval"
  CHECK ("status" = 'draft' OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));

ALTER TABLE "offers" ADD CONSTRAINT "offers_expiry_after_joining_sanity"
  CHECK ("expiry_date" IS NULL OR "expiry_date" <= "joining_date");

-- ─────────────────────────────────────────────────────────────
-- Row-level security, the second isolation layer.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['job_postings', 'candidates', 'applications', 'interviews', 'offers']
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
