-- Row-level security: the second, independent tenant-isolation layer.
-- Canonical source: docs/04-database.md §4.3, docs/09-security.md §4.
--
-- The application already injects `company_id` into every query through a
-- Prisma client extension. This layer assumes that code will one day be
-- wrong. If a query ever escapes the extension, these policies make it
-- return zero rows instead of another company's payroll.
--
-- Deviation from the blueprint, noted deliberately:
-- docs/09-security.md §9 calls for a dedicated `app_user` role without
-- BYPASSRLS. Managed Postgres (Neon, Supabase) hands you one owner role, and
-- a table owner is exempt from RLS unless the table FORCEs it. Every table
-- below is therefore FORCE'd, which subjects the owner to the same policies.
-- When a separate role is available, grant it and drop nothing: FORCE stays
-- correct either way.

-- ─────────────────────────────────────────────────────────────
-- Session-variable accessors.
--
-- `current_setting(..., true)` returns NULL rather than raising when the
-- variable was never set, so an unscoped connection resolves to NULL and
-- every `company_id = NULL` comparison is false. Failing closed is the
-- entire point.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_current_company() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(current_setting('app.bypass_rls', true), 'off') = 'on'
        OR coalesce(current_setting('app.is_super_admin', true), 'off') = 'on'
  $$;

-- ─────────────────────────────────────────────────────────────
-- The tenant root is matched on its own primary key.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "companies"
  USING ("id" = app_current_company() OR app_bypass_rls())
  WITH CHECK ("id" = app_current_company() OR app_bypass_rls());

-- ─────────────────────────────────────────────────────────────
-- Tables carrying company_id directly.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'locations',
    'departments',
    'designations',
    'users',
    'roles',
    'employees',
    'emergency_contacts'
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

-- ─────────────────────────────────────────────────────────────
-- system_settings: a NULL company_id row is a platform default that every
-- tenant may READ but none may WRITE.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "system_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON "system_settings" FOR SELECT
  USING ("company_id" = app_current_company() OR "company_id" IS NULL OR app_bypass_rls());

CREATE POLICY "tenant_write" ON "system_settings" FOR INSERT
  WITH CHECK ("company_id" = app_current_company() OR app_bypass_rls());

CREATE POLICY "tenant_update" ON "system_settings" FOR UPDATE
  USING ("company_id" = app_current_company() OR app_bypass_rls())
  WITH CHECK ("company_id" = app_current_company() OR app_bypass_rls());

CREATE POLICY "tenant_delete" ON "system_settings" FOR DELETE
  USING ("company_id" = app_current_company() OR app_bypass_rls());

-- ─────────────────────────────────────────────────────────────
-- Join tables have no company_id of their own; they inherit tenancy from
-- the row they hang off.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "role_permissions"
  USING (
    app_bypass_rls() OR EXISTS (
      SELECT 1 FROM "roles" r
      WHERE r."id" = "role_permissions"."role_id" AND r."company_id" = app_current_company()
    )
  )
  WITH CHECK (
    app_bypass_rls() OR EXISTS (
      SELECT 1 FROM "roles" r
      WHERE r."id" = "role_permissions"."role_id" AND r."company_id" = app_current_company()
    )
  );

ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "user_roles"
  USING (
    app_bypass_rls() OR EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."id" = "user_roles"."user_id" AND u."company_id" = app_current_company()
    )
  )
  WITH CHECK (
    app_bypass_rls() OR EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."id" = "user_roles"."user_id" AND u."company_id" = app_current_company()
    )
  );

-- Password-reset and invite tokens are consumed before any tenant is known,
-- so those code paths run under app_bypass_rls() by design.
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_tokens" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "password_reset_tokens"
  USING (
    app_bypass_rls() OR EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."id" = "password_reset_tokens"."user_id" AND u."company_id" = app_current_company()
    )
  )
  WITH CHECK (
    app_bypass_rls() OR EXISTS (
      SELECT 1 FROM "users" u
      WHERE u."id" = "password_reset_tokens"."user_id" AND u."company_id" = app_current_company()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- permissions is a platform-owned catalog: readable by everyone,
-- writable only by the seed / platform code.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "catalog_read" ON "permissions" FOR SELECT USING (true);
CREATE POLICY "catalog_write" ON "permissions" FOR ALL
  USING (app_bypass_rls())
  WITH CHECK (app_bypass_rls());

-- ─────────────────────────────────────────────────────────────
-- audit_logs: readable within the tenant, insertable within the tenant.
-- UPDATE and DELETE are blocked outright by the trigger in the next
-- migration, not merely unpoliced here.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_read" ON "audit_logs" FOR SELECT
  USING ("company_id" = app_current_company() OR app_bypass_rls());

CREATE POLICY "tenant_insert" ON "audit_logs" FOR INSERT
  WITH CHECK ("company_id" = app_current_company() OR app_bypass_rls());
