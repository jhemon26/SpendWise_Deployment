-- ============================================================================
-- 004 — make categories, banks and settings durable
--
-- The tables for categories and banks existed from 001, but nothing ever wrote
-- to them: push ignored both and pull returned empty arrays. Everything a user
-- set up lived only in that browser's IndexedDB.
--
-- That is a data-loss bug, not a missing feature. Sign out, clear the browser,
-- or open the app on a second device and the categories are gone — while the
-- transactions come back from the server still pointing at category ids that no
-- longer exist, so every row reads "Uncategorised" and every budget is empty.
--
-- Settings (name, budgets, avatar) had no table at all.
-- ============================================================================

-- Fixed costs need the day they fall due; the client has carried this field
-- since the bills work, with nowhere to store it.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS due_day SMALLINT
  CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31));

-- One row per user. Not a sync entity: these are last-write-wins scalars, so
-- the conflict machinery the transactions need would be noise here.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name         TEXT        NOT NULL DEFAULT '',
  base_currency        TEXT        NOT NULL DEFAULT 'GBP',
  day_to_day_minor     BIGINT      NOT NULL DEFAULT 0 CHECK (day_to_day_minor >= 0),
  savings_target_minor BIGINT      NOT NULL DEFAULT 0 CHECK (savings_target_minor >= 0),
  -- Either an emoji or an "svg:" avatar id; empty means fall back to initials.
  avatar_emoji         TEXT        NOT NULL DEFAULT '',
  avatar_colour        TEXT        NOT NULL DEFAULT '#6366F1'
                       CHECK (avatar_colour ~ '^#[0-9a-fA-F]{6}$'),
  updated_at           TIMESTAMPTZ NOT NULL
);

-- Same tenancy rule as every other table: a row is visible only to its owner.
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_settings_isolation ON user_settings;
CREATE POLICY user_settings_isolation ON user_settings
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- Pull is "everything changed since T", so both tables need that index.
CREATE INDEX IF NOT EXISTS categories_user_updated_idx2
  ON categories (user_id, updated_at, local_id);
CREATE INDEX IF NOT EXISTS banks_user_updated_idx
  ON banks (user_id, updated_at, local_id);
