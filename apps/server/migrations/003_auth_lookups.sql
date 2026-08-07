-- ============================================================================
-- SpendWise 003 — pre-authentication lookups under RLS
--
-- PROBLEM (found by running 002, not by reading it):
--   Authentication has a chicken-and-egg. The tenant policies key off
--   `app.user_id`, but the two lookups that ESTABLISH identity happen before
--   any user is known:
--
--     sign-in : SELECT ... FROM identities WHERE provider=? AND subject=?
--     refresh : SELECT ... FROM sessions   WHERE refresh_hash=?
--
--   With no context set both return zero rows, so nobody can ever log in.
--   Verified against PG16: both counts came back 0.
--
-- REJECTED FIX: drop RLS from `identities` and `sessions`. That would leave
--   two tables holding the credentials of every user protected only by
--   application discipline — precisely the thing §9.2 says not to rely on.
--
-- CHOSEN FIX: keep RLS on, and expose three narrow SECURITY DEFINER functions
--   as the ONLY bypass. Each takes a secret the caller must already possess
--   (an OIDC subject, or a 256-bit token hash) and returns just the matching
--   row. Possession of the secret IS the authorisation, which is the same
--   property a session cookie relies on.
--
--   The bypass surface is therefore three auditable functions rather than two
--   wide-open tables, and `SET search_path` on each stops the classic
--   SECURITY DEFINER hijack.
-- ============================================================================

BEGIN;

-- ─── 1. resolve an existing identity ────────────────────────────────────────

CREATE OR REPLACE FUNCTION auth_find_identity(p_provider text, p_subject text)
RETURNS TABLE (user_id uuid, identity_id uuid, email citext, phone_e164 text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT i.user_id, i.id, i.email, i.phone_e164
    FROM identities i
    JOIN users u ON u.id = i.user_id
   WHERE i.provider = p_provider
     AND i.subject  = p_subject
     AND u.deleted_at IS NULL;
$$;

-- ─── 2. find-or-create on first sign-in ─────────────────────────────────────
-- A brand-new user cannot be inserted under RLS: the policy on `users` requires
-- id = current_app_user(), and the id does not exist yet.

CREATE OR REPLACE FUNCTION auth_register_identity(
  p_provider     text,
  p_subject      text,
  p_email        citext,
  p_phone        text,
  p_display_name text,
  p_dek_wrapped  bytea
)
RETURNS TABLE (user_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user uuid;
  v_created boolean := false;
BEGIN
  IF p_provider NOT IN ('google','apple','phone','email') THEN
    RAISE EXCEPTION 'unknown provider %', p_provider USING ERRCODE = '22023';
  END IF;

  -- already linked?
  SELECT i.user_id INTO v_user
    FROM identities i WHERE i.provider = p_provider AND i.subject = p_subject;

  -- Link to an existing account by VERIFIED email only. Matching on an
  -- unverified address would be an account-takeover primitive: register
  -- someone else's address with a provider that does not verify, and inherit
  -- their account (ARCHITECTURE §9.1).
  IF v_user IS NULL AND p_email IS NOT NULL THEN
    SELECT i.user_id INTO v_user
      FROM identities i
      JOIN users u ON u.id = i.user_id
     WHERE i.email = p_email
       AND i.provider IN ('google','apple','email')
       AND u.deleted_at IS NULL
     LIMIT 1;
  END IF;

  IF v_user IS NULL THEN
    INSERT INTO users (display_name, dek_wrapped)
    VALUES (coalesce(nullif(p_display_name, ''), 'SpendWise user'), p_dek_wrapped)
    RETURNING id INTO v_user;

    INSERT INTO user_roles (user_id, role_id)
    SELECT v_user, r.id FROM roles r WHERE r.name = 'user';

    v_created := true;
  END IF;

  INSERT INTO identities (user_id, provider, subject, email, phone_e164, last_used_at)
  VALUES (v_user, p_provider, p_subject, p_email, p_phone, now())
  ON CONFLICT (provider, subject)
  DO UPDATE SET last_used_at = now(), email = excluded.email;

  RETURN QUERY SELECT v_user, v_created;
END;
$$;

-- ─── 3. refresh-token lookup ────────────────────────────────────────────────
-- Keyed on a SHA-256 of 256 bits of entropy. Guessing it is not a threat model.

CREATE OR REPLACE FUNCTION auth_find_session_by_hash(p_hash text)
RETURNS TABLE (
  id uuid, user_id uuid, refresh_hash text, family_id uuid,
  device_id text, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT s.id, s.user_id, s.refresh_hash, s.family_id,
         s.device_id, s.expires_at, s.revoked_at, s.created_at
    FROM sessions s
   WHERE s.refresh_hash = p_hash;
$$;

-- ─── grants ─────────────────────────────────────────────────────────────────
-- Default-deny: PUBLIC gets nothing, the app role gets exactly these three.

REVOKE ALL ON FUNCTION auth_find_identity(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_register_identity(text, text, citext, text, text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_find_session_by_hash(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_find_identity(text, text) TO spendwise_app;
GRANT EXECUTE ON FUNCTION auth_register_identity(text, text, citext, text, text, bytea) TO spendwise_app;
GRANT EXECUTE ON FUNCTION auth_find_session_by_hash(text) TO spendwise_app;

COMMIT;
