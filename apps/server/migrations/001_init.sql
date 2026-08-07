-- ============================================================================
-- SpendWise 001 — initial schema
--
-- Implements ARCHITECTURE §5 (schema, indexing, partitioning) and §9.2 (RLS).
-- Passwordless: there is no password column anywhere. Identity lives in
-- `identities`, one row per linked provider (§9.1).
--
-- Idempotent: safe to re-run against a partially-migrated database.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── identity ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name   TEXT NOT NULL,
  base_currency  CHAR(3) NOT NULL DEFAULT 'GBP',
  locale         TEXT NOT NULL DEFAULT 'en-GB',
  dek_wrapped    BYTEA NOT NULL,
  mfa_secret     BYTEA,
  mfa_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  onboarded_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ,
  purge_after    TIMESTAMPTZ,
  CONSTRAINT users_base_currency_iso CHECK (base_currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS identities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('google','apple','phone','email')),
  subject      TEXT NOT NULL,
  email        CITEXT,
  phone_e164   TEXT,
  verified_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- provider+subject is the durable key. Apple private-relay emails change
  -- and can be revoked, so email is a hint and never an identifier (§9.1).
  CONSTRAINT identities_provider_subject_uq UNIQUE (provider, subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS identities_user_provider_uq
  ON identities (user_id, provider);

-- ─── rbac ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
  id   SMALLSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS permissions (
  id   SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id SMALLINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

INSERT INTO roles (name) VALUES ('user'), ('support'), ('admin')
  ON CONFLICT (name) DO NOTHING;

-- ─── sessions: refresh-token rotation (§9.1) ────────────────────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL,         -- SHA-256 of the token, never the token
  family_id    UUID NOT NULL,         -- rotation lineage; reuse revokes the family
  device_id    TEXT,
  user_agent   TEXT,
  ip           INET,
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_active_idx
  ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_family_idx ON sessions (family_id);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_refresh_hash_uq ON sessions (refresh_hash);

-- ─── application data ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
  local_id     UUID PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  icon         TEXT NOT NULL,
  colour       TEXT NOT NULL CHECK (colour ~ '^#[0-9a-fA-F]{6}$'),
  limit_minor  BIGINT NOT NULL DEFAULT 0 CHECK (limit_minor >= 0),
  is_fixed     BOOLEAN NOT NULL DEFAULT FALSE,
  version      INT NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL,
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS categories_user_idx
  ON categories (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS categories_user_updated_idx
  ON categories (user_id, updated_at);

CREATE TABLE IF NOT EXISTS banks (
  local_id   UUID PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  colour     TEXT NOT NULL CHECK (colour ~ '^#[0-9a-fA-F]{6}$'),
  version    INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS banks_user_idx
  ON banks (user_id) WHERE deleted_at IS NULL;

-- Partitioned by month on occurred_at (§5.3). The partition key must be part
-- of the primary key, hence (local_id, occurred_at).
CREATE TABLE IF NOT EXISTS transactions (
  local_id      UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   UUID,
  bank_id       UUID,

  amount_minor  BIGINT NOT NULL,
  currency      CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  base_minor    BIGINT,
  base_currency CHAR(3) NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  fx_rate       NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
  fx_rate_date  DATE NOT NULL,
  fx_provisional BOOLEAN NOT NULL DEFAULT FALSE,

  merchant_enc  BYTEA,
  note_enc      BYTEA,
  occurred_at   TIMESTAMPTZ NOT NULL,
  is_income     BOOLEAN NOT NULL DEFAULT FALSE,
  pending       BOOLEAN NOT NULL DEFAULT FALSE,
  version       INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL,
  deleted_at    TIMESTAMPTZ,
  PRIMARY KEY (local_id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX IF NOT EXISTS transactions_user_time_idx
  ON transactions (user_id, occurred_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS transactions_user_updated_idx
  ON transactions (user_id, updated_at);
CREATE INDEX IF NOT EXISTS transactions_user_cat_idx
  ON transactions (user_id, category_id) WHERE deleted_at IS NULL;

-- Shared reference data, not user data: no RLS on this one.
CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date DATE NOT NULL,
  base      CHAR(3) NOT NULL,
  quote     CHAR(3) NOT NULL,
  rate      NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  source    TEXT NOT NULL DEFAULT 'ecb',
  PRIMARY KEY (rate_date, base, quote)
);

-- ─── sync bookkeeping (§6.5) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_state (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL,
  last_pulled_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch',
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);

-- The anti-duplicate guarantee: a replayed push hits this primary key and the
-- stored result is returned instead of the batch being applied twice.
CREATE TABLE IF NOT EXISTS sync_operations (
  idempotency_key UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  result_hash     TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── audit + notifications ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL,
  user_id    UUID,
  actor_ip   INET,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  UUID,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX IF NOT EXISTS audit_user_time_idx ON audit_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON notifications (user_id, created_at DESC);

-- ─── partition management ───────────────────────────────────────────────────
-- pg_partman is not available on a stock install, so this does the same job
-- with plain SQL. Called by a nightly job to keep a month of runway ahead.

CREATE OR REPLACE FUNCTION ensure_month_partition(parent regclass, month_start date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  part_name text;
  next_start date := (month_start + INTERVAL '1 month')::date;
BEGIN
  part_name := format('%s_%s', parent::text, to_char(month_start, 'YYYYMM'));
  IF to_regclass(part_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
      part_name, parent::text, month_start, next_start
    );
  END IF;
END;
$$;

-- Runway: previous month through three months ahead, for both partitioned
-- tables. An insert with no matching partition fails outright, so the window
-- must always lead the clock.
DO $$
DECLARE
  m date := date_trunc('month', now())::date - INTERVAL '1 month';
  i int;
BEGIN
  FOR i IN 0..4 LOOP
    PERFORM ensure_month_partition('transactions', (m + (i || ' month')::interval)::date);
    PERFORM ensure_month_partition('audit_logs',   (m + (i || ' month')::interval)::date);
  END LOOP;
END;
$$;

COMMIT;
