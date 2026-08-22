-- Constraints Prisma's datamodel cannot express.
-- Canonical source: docs/04-database.md §2, §6.

-- ─────────────────────────────────────────────────────────────
-- Login has no company context: the form asks for an email and a
-- password, nothing more. So an address must identify exactly one
-- account platform-wide, case-insensitively.
-- Consequence (accepted in docs/04-database.md): the same person cannot
-- hold accounts in two companies under one address.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "users_lower_email_key" ON "users" (lower("email"));

-- ─────────────────────────────────────────────────────────────
-- system_settings.company_id IS NULL marks a platform-wide default.
-- Postgres treats NULLs as distinct, so the (company_id, key) unique
-- index does not stop two rows both claiming to be the global default
-- for one key. This partial index does.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "system_settings_global_key_key"
  ON "system_settings" ("key")
  WHERE "company_id" IS NULL;

-- ─────────────────────────────────────────────────────────────
-- An employee cannot manage themselves; a self-loop would make the
-- team-scope query recurse and every "my manager" lookup lie.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_manager_not_self"
  CHECK ("manager_id" IS NULL OR "manager_id" <> "id");

-- ─────────────────────────────────────────────────────────────
-- Lifecycle dates must be ordered. These are cheap guards against a
-- bad import or an API caller that skipped the service layer.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_exit_after_join"
  CHECK ("exit_date" IS NULL OR "exit_date" >= "join_date");

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_probation_after_join"
  CHECK ("probation_end_date" IS NULL OR "probation_end_date" >= "join_date");

-- ─────────────────────────────────────────────────────────────
-- Exactly one primary emergency contact per employee.
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "emergency_contacts_one_primary"
  ON "emergency_contacts" ("employee_id")
  WHERE "is_primary" AND "deleted_at" IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Soft-deleted rows must not block a code being reused. Replace the
-- plain unique keys with partial ones that only consider live rows.
-- ─────────────────────────────────────────────────────────────
DROP INDEX "locations_company_id_code_key";
CREATE UNIQUE INDEX "locations_company_id_code_key"
  ON "locations" ("company_id", "code") WHERE "deleted_at" IS NULL;

DROP INDEX "departments_company_id_code_key";
CREATE UNIQUE INDEX "departments_company_id_code_key"
  ON "departments" ("company_id", "code") WHERE "deleted_at" IS NULL;

DROP INDEX "designations_company_id_code_key";
CREATE UNIQUE INDEX "designations_company_id_code_key"
  ON "designations" ("company_id", "code") WHERE "deleted_at" IS NULL;

DROP INDEX "employees_company_id_employee_code_key";
CREATE UNIQUE INDEX "employees_company_id_employee_code_key"
  ON "employees" ("company_id", "employee_code") WHERE "deleted_at" IS NULL;
