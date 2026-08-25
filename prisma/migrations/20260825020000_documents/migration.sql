-- Employee and company documents (docs/02-modules-talent.md §Module 10).
--
-- The interesting column in here is `manager_visible` on the category. A
-- manager may see a report's training certificate and may not see their
-- passport, and the difference is a property of the kind of document rather
-- than of the document — so it is set once per category instead of being
-- remembered every time somebody uploads.
--
-- Files themselves live in object storage. What is stored here is the key and
-- enough about the file to answer questions without fetching it.

CREATE TYPE "document_status" AS ENUM ('pending', 'active', 'expired', 'archived');

CREATE TABLE "document_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "code" VARCHAR(30) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  -- Whether a person may put one of these in themselves. False for anything
  -- HR issues — a contract somebody uploaded for themselves is not a contract.
  "employee_uploadable" BOOLEAN NOT NULL DEFAULT false,
  -- Whether a manager may see their reports' documents of this kind. Off by
  -- default, because the safe answer for a category nobody has thought about
  -- is no.
  "manager_visible" BOOLEAN NOT NULL DEFAULT false,
  -- Whether an expiry date must be given. A visa with no expiry is a visa
  -- nobody will chase.
  "expiry_required" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "document_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  -- Null for a company document — the handbook, a policy — which everybody
  -- can read.
  "employee_id" UUID,
  "category_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "file_key" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL DEFAULT 0,
  "expiry_date" DATE,
  "status" "document_status" NOT NULL DEFAULT 'pending',
  "uploaded_by" UUID,
  -- Informational only. That HR has eyeballed a certificate is worth
  -- recording; it gates nothing.
  "verified_by" UUID,
  "verified_at" TIMESTAMPTZ(6),
  -- Versioning by replacement: the new row points at the one it supersedes,
  -- and that one is archived rather than deleted.
  "replaces_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────
-- Keys
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "document_categories" ADD CONSTRAINT "document_categories_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;

ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT;
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "document_categories"("id") ON DELETE RESTRICT;
ALTER TABLE "documents" ADD CONSTRAINT "documents_replaces_id_fkey"
  FOREIGN KEY ("replaces_id") REFERENCES "documents"("id") ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "document_categories_code_unique"
  ON "document_categories"("company_id", "code") WHERE "deleted_at" IS NULL;

CREATE INDEX "documents_employee_idx" ON "documents"("employee_id", "status");
CREATE INDEX "documents_company_status_idx" ON "documents"("company_id", "status");

-- The expiry sweep reads exactly this: live documents with a date on them.
CREATE INDEX "documents_expiry_idx"
  ON "documents"("company_id", "expiry_date")
  WHERE "status" = 'active' AND "expiry_date" IS NOT NULL;

-- One row per stored object. A key reused by two rows means deleting one
-- pulls the file out from under the other.
CREATE UNIQUE INDEX "documents_file_key_unique" ON "documents"("file_key");

-- ─────────────────────────────────────────────────────────────
-- Rules the database keeps
-- ─────────────────────────────────────────────────────────────

-- Verification records who and when, together or not at all.
ALTER TABLE "documents" ADD CONSTRAINT "documents_verification_is_complete"
  CHECK (("verified_by" IS NULL) = ("verified_at" IS NULL));

ALTER TABLE "documents" ADD CONSTRAINT "documents_size_not_negative"
  CHECK ("size_bytes" >= 0);

-- A document never supersedes itself.
ALTER TABLE "documents" ADD CONSTRAINT "documents_replaces_is_not_self"
  CHECK ("replaces_id" IS NULL OR "replaces_id" <> "id");

-- ─────────────────────────────────────────────────────────────
-- Row-level security, the second isolation layer.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['document_categories', 'documents']
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
