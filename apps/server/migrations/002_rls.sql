-- ============================================================================
-- SpendWise 002 — Row-Level Security
--
-- ARCHITECTURE §9.2. Application-layer `WHERE user_id = ...` is one forgotten
-- clause away from a cross-account leak; at 10k users that bug is a reportable
-- breach. These policies make isolation a property of the database, so a query
-- that forgets its filter returns ZERO ROWS rather than someone else's data.
--
-- The API connects as `spendwise_app`, which:
--   * is NOT the table owner  — owners bypass RLS unless FORCE is set
--   * does NOT have BYPASSRLS
--   * has no DDL rights
--
-- Request context is set per transaction with
--     SET LOCAL app.user_id = '<uuid>';
-- SET LOCAL is scoped to the transaction, so a pooled connection cannot leak
-- one user's context into the next request.
-- ============================================================================

BEGIN;

-- ─── application role ───────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spendwise_app') THEN
    CREATE ROLE spendwise_app LOGIN PASSWORD 'change-me-in-production';
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO spendwise_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO spendwise_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO spendwise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spendwise_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO spendwise_app;

-- Belt and braces: make sure nobody hands the app role a bypass.
ALTER ROLE spendwise_app NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- ─── helper ─────────────────────────────────────────────────────────────────
-- Returns the request's user, or NULL when unset. NULL makes every policy
-- fail closed: with no context, no rows are visible.

CREATE OR REPLACE FUNCTION current_app_user() RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
  v := current_setting('app.user_id', true);
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN v::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;

-- ─── policies ───────────────────────────────────────────────────────────────
-- USING      filters what you can read.
-- WITH CHECK constrains what you may write.
--
-- Postgres reuses USING as the write check when WITH CHECK is omitted, so for
-- plain tenant isolation the two are equivalent and omitting it is NOT a
-- vulnerability (verified against PG16). We state both anyway: it documents
-- intent, and it is the only way to express a read rule that differs from the
-- write rule, which is exactly when the implicit fallback would bite.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories','banks','transactions','sync_state',
    'sync_operations','notifications'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING      (user_id = current_app_user())
        WITH CHECK (user_id = current_app_user())
    $f$, t);
  END LOOP;
END;
$$;

-- users: a person may see and edit only their own row
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_only ON users;
CREATE POLICY self_only ON users
  USING      (id = current_app_user())
  WITH CHECK (id = current_app_user());

-- identities and sessions are keyed by user_id
ALTER TABLE identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE identities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON identities;
CREATE POLICY tenant_isolation ON identities
  USING      (user_id = current_app_user())
  WITH CHECK (user_id = current_app_user());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sessions;
CREATE POLICY tenant_isolation ON sessions
  USING      (user_id = current_app_user())
  WITH CHECK (user_id = current_app_user());

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON user_roles;
CREATE POLICY tenant_isolation ON user_roles
  USING (user_id = current_app_user());

-- ─── deliberately NOT under RLS ─────────────────────────────────────────────
-- fx_rates, roles, permissions, role_permissions are shared reference data.
-- audit_logs is append-only and read by operators, not by users; it is never
-- exposed through a user-facing endpoint.
GRANT SELECT ON fx_rates, roles, permissions, role_permissions TO spendwise_app;
-- Append-only for the application: it may write history and read it back for
-- incident response, but must not be able to rewrite or erase it.
REVOKE UPDATE, DELETE ON audit_logs FROM spendwise_app;
GRANT INSERT, SELECT ON audit_logs TO spendwise_app;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO spendwise_app;

COMMIT;
