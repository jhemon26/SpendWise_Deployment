-- ============================================================================
-- 005 — account erasure
--
-- Deleting the users row cascades to identities, sessions, categories, banks,
-- transactions, sync_state, sync_operations, notifications and user_settings:
-- every one of them declares ON DELETE CASCADE. Once identities is gone, the
-- same Google account signing in again resolves to nobody and a brand-new user
-- is created — which is the "completely fresh" behaviour we want.
--
-- audit_logs is the exception. It has NO foreign key to users, deliberately:
-- a security trail that disappears with the account it describes is not a
-- security trail. But it holds actor_ip and user_id, both personal data, so
-- erasure has to scrub them while leaving the events themselves intact.
--
-- The app role has only SELECT and INSERT on audit_logs, and widening that to
-- UPDATE would let any request rewrite history. SECURITY DEFINER keeps the
-- privilege inside this one function instead.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_delete_account(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
-- Empty search_path: a SECURITY DEFINER function that resolves names through a
-- caller-controlled path is a privilege-escalation primitive.
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Keep the event, drop the identifiers. The row stays as evidence that an
  -- action happened at a time; it no longer says by whom or from where.
  UPDATE public.audit_logs
     SET user_id = NULL, actor_ip = NULL
   WHERE user_id = p_user_id;

  -- Everything else goes with the user.
  DELETE FROM public.users WHERE id = p_user_id;
END;
$$;

-- The function trusts its argument, so the ONLY safe caller is one that passes
-- the id from a verified access token. The controller does; nothing else may.
REVOKE ALL ON FUNCTION app_delete_account(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_delete_account(UUID) TO spendwise_app;
