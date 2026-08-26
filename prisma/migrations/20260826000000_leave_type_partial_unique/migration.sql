-- ─────────────────────────────────────────────────────────────
-- A retired leave code must not block that code being used again.
--
-- `leave_types` landed after 20260822000100_constraints converted the other
-- soft-deleted tables, and never got the same treatment. The effect was that
-- archiving a type and re-creating it failed on the raw constraint: the
-- duplicate check in the service cannot see archived rows (the tenant client
-- filters them out), so the clash surfaced as a bare 409 naming a row no
-- screen in the app displays, with no way back through the UI.
-- ─────────────────────────────────────────────────────────────
DROP INDEX "leave_types_company_id_code_key";
CREATE UNIQUE INDEX "leave_types_company_id_code_key"
  ON "leave_types" ("company_id", "code") WHERE "deleted_at" IS NULL;
