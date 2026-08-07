-- ============================================================================
-- RLS cross-tenant isolation test — RELEASE GATE (ARCHITECTURE §9.2, §18)
--
-- Authenticates as user A and attempts to read, update, delete and forge
-- user B's rows. Every attempt must fail. Run as `spendwise_app`, never as a
-- superuser: superusers bypass RLS and the test would pass vacuously.
--
--   psql -U spendwise_app -d spendwise -v ON_ERROR_STOP=1 \
--        -v user_a=<uuid> -v user_b=<uuid> -f rls.test.sql
--
-- The two user ids are passed IN rather than looked up, because this role
-- cannot read the users table without a context — which is itself the
-- property under test. Any failure raises and exits non-zero.
-- ============================================================================

\set QUIET on
SET client_min_messages TO NOTICE;

-- psql does not interpolate :'vars' inside $$ dollar-quoting, so hand them to
-- the session first and read them back with current_setting.
SELECT set_config('test.user_a', :'user_a', false),
       set_config('test.user_b', :'user_b', false) \gset

DO $$
DECLARE
  a uuid := current_setting('test.user_a')::uuid;
  b uuid := current_setting('test.user_b')::uuid;
  n int;
  ok boolean;
BEGIN
  IF a IS NULL OR b IS NULL THEN
    RAISE EXCEPTION 'FIXTURE MISSING: pass -v user_a=<uuid> -v user_b=<uuid>';
  END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '1. no context set  -> must see nothing (fail closed)';
  PERFORM set_config('app.user_id', '', true);
  SELECT count(*) INTO n FROM categories;
  IF n <> 0 THEN
    RAISE EXCEPTION 'FAIL: % categories visible with no app.user_id set', n;
  END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '2. as A, unfiltered SELECT -> only A''s rows';
  PERFORM set_config('app.user_id', a::text, true);

  -- Deliberately NO where clause. This is the property under test: forgetting
  -- the filter must be harmless.
  SELECT count(*) INTO n FROM categories;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % categories, expected 1', n; END IF;

  SELECT count(*) INTO n FROM transactions;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % transactions, expected 1', n; END IF;

  SELECT count(*) INTO n FROM users;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: A sees % users, expected 1 (self)', n; END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '3. as A, targeting B''s row by id -> invisible';
  SELECT count(*) INTO n FROM categories WHERE user_id = b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: A can see B''s categories'; END IF;

  SELECT count(*) INTO n FROM users WHERE id = b;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: A can read B''s user row'; END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '4. as A, UPDATE B''s row -> zero rows affected';
  WITH upd AS (
    UPDATE categories SET name = 'HIJACKED' WHERE user_id = b RETURNING 1
  ) SELECT count(*) INTO n FROM upd;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: A updated % of B''s categories', n; END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '5. as A, DELETE B''s row -> zero rows affected';
  WITH del AS (
    DELETE FROM transactions WHERE user_id = b RETURNING 1
  ) SELECT count(*) INTO n FROM del;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: A deleted % of B''s transactions', n; END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '6. as A, INSERT attributed to B -> must be rejected';
  -- This is what WITH CHECK exists for. USING alone would allow it.
  ok := false;
  BEGIN
    INSERT INTO categories
      (local_id, user_id, name, icon, colour, limit_minor, created_at, updated_at)
    VALUES
      (gen_random_uuid(), b, 'forged', 'other', '#ffffff', 0, now(), now());
  EXCEPTION WHEN insufficient_privilege THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: A forged a category owned by B (WITH CHECK missing?)';
  END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '7. as A, re-attribute own row to B -> must be rejected';
  ok := false;
  BEGIN
    UPDATE categories SET user_id = b WHERE user_id = a;
  EXCEPTION WHEN insufficient_privilege THEN
    ok := true;
  END;
  IF NOT ok THEN
    RAISE EXCEPTION 'FAIL: A moved its own row into B''s tenant';
  END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '8. switching context to B -> sees only B''s rows';
  PERFORM set_config('app.user_id', b::text, true);
  SELECT count(*) INTO n FROM categories;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: B sees % categories, expected 1', n; END IF;
  SELECT count(*) INTO n FROM categories WHERE user_id = a;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: B can see A''s categories'; END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '9. garbage context -> fails closed, does not error';
  PERFORM set_config('app.user_id', 'not-a-uuid', true);
  SELECT count(*) INTO n FROM categories;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: garbage context exposed % rows', n; END IF;

  ------------------------------------------------------------------
  RAISE NOTICE '10. app role must not be able to bypass RLS';
  SELECT rolbypassrls INTO ok FROM pg_roles WHERE rolname = current_user;
  IF ok THEN
    RAISE EXCEPTION 'FAIL: % has BYPASSRLS — every policy above is decorative', current_user;
  END IF;
  SELECT rolsuper INTO ok FROM pg_roles WHERE rolname = current_user;
  IF ok THEN
    RAISE EXCEPTION 'FAIL: % is a superuser — RLS does not apply', current_user;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'ALL RLS ISOLATION CHECKS PASSED (as %)', current_user;
END;
$$;
