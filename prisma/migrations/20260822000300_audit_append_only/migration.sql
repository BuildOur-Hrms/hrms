-- audit_logs is append-only, enforced by the database.
-- Canonical source: docs/09-security.md §10, docs/04-database.md §2.14.
--
-- docs/09-security.md achieves this by granting the app role INSERT and
-- SELECT only. Managed Postgres gives us a single owner role, and an owner
-- can always re-grant itself. A trigger cannot be talked out of it: the only
-- way past it is DDL, which leaves its own trail.
--
-- Retention purges (Phase 2) are the one legitimate DELETE. They announce
-- themselves with a transaction-local flag rather than by disabling the
-- trigger, so the exemption is scoped to one transaction and cannot leak onto
-- a pooled connection.

CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE'
       AND coalesce(current_setting('app.audit_retention', true), 'off') = 'on' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'audit_logs is append-only; % is not permitted', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END;
  $$;

CREATE TRIGGER "audit_logs_no_mutation"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
