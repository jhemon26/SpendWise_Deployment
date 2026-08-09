-- ============================================================================
-- 006 — take-home pay
--
-- Stored as a MONTHLY figure whatever the actual cadence, because every budget
-- figure in the app is monthly and a second unit in the database would mean
-- every reader had to remember to convert. The cadence is kept alongside it
-- purely so the amount can be shown back the way the user typed it.
-- ============================================================================
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS monthly_income_minor BIGINT NOT NULL DEFAULT 0
    CHECK (monthly_income_minor >= 0),
  ADD COLUMN IF NOT EXISTS pay_frequency TEXT NOT NULL DEFAULT 'monthly'
    CHECK (pay_frequency IN ('weekly','fortnightly','four_weekly','monthly','annual'));
