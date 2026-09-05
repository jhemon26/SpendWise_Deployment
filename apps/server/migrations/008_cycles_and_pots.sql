-- Cycles and pots.
--
-- The app assumed one budgeting period — the calendar month — and welded it
-- into the arithmetic. That is false for anyone paid weekly, fortnightly or
-- four-weekly: their money arrives in lumps, so a straight-line month is noise.
--
-- Two clocks now. SPENDING runs on the user's own cycle; COMMITMENTS stay on
-- the calendar, because rent does not care what day you are paid. The bridge is
-- accrual, held in the client (derived from transactions), not stored here.
--
-- Nothing is dropped. is_fixed stays until the screens stop reading it, so this
-- migration is safe to apply to a running client. 009 removes it.

BEGIN;

-- ── the spending clock ───────────────────────────────────────────────────
ALTER TABLE user_settings
  -- 'days' covers weekly/fortnightly/four-weekly; 'monthly' covers "paid on
  -- the 25th". Defaulting to monthly keeps every existing row behaving exactly
  -- as it does today.
  ADD COLUMN IF NOT EXISTS cycle_kind TEXT NOT NULL DEFAULT 'monthly'
    CHECK (cycle_kind IN ('days', 'monthly')),
  ADD COLUMN IF NOT EXISTS cycle_length_days SMALLINT
    CHECK (cycle_length_days IS NULL OR cycle_length_days IN (7, 14, 28)),
  -- Any real payday. Boundaries are counted from here in both directions.
  ADD COLUMN IF NOT EXISTS cycle_anchor_date DATE,
  ADD COLUMN IF NOT EXISTS cycle_anchor_day SMALLINT
    CHECK (cycle_anchor_day IS NULL OR (cycle_anchor_day BETWEEN 1 AND 31)),
  -- Per CYCLE, not per month. monthly_income_minor stays for now and is
  -- migrated below; 009 drops it.
  ADD COLUMN IF NOT EXISTS expected_income_minor BIGINT NOT NULL DEFAULT 0
    CHECK (expected_income_minor >= 0),
  -- Accruals are replayed from this date. Without it a new account would be
  -- asked to fund every bill from the day the account was created.
  ADD COLUMN IF NOT EXISTS budget_start_date DATE;

-- A days-cycle needs a length and an anchor; a monthly one needs a day. Enforce
-- it here so a half-configured row cannot reach the client and divide by zero.
ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_cycle_shape;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_cycle_shape CHECK (
    (cycle_kind = 'days'
       AND cycle_length_days IS NOT NULL AND cycle_anchor_date IS NOT NULL)
    OR
    (cycle_kind = 'monthly')
  );

-- Existing rows are monthly earners; carry their income across unchanged.
UPDATE user_settings
   SET expected_income_minor = monthly_income_minor
 WHERE expected_income_minor = 0 AND monthly_income_minor > 0;

UPDATE user_settings SET cycle_anchor_day = 1 WHERE cycle_anchor_day IS NULL;

-- ── flows and pots ───────────────────────────────────────────────────────
ALTER TABLE categories
  -- A flow refills each cycle (groceries). A pot fills up until something
  -- empties it (rent, savings, a goal). One shape covers three features.
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'flow'
    CHECK (kind IN ('flow', 'pot')),
  ADD COLUMN IF NOT EXISTS pot_kind TEXT
    CHECK (pot_kind IS NULL OR pot_kind IN ('bill', 'saving', 'goal')),
  -- due_day (1-31) could only ever express a monthly bill. Quarterly water and
  -- annual insurance had nowhere to live.
  ADD COLUMN IF NOT EXISTS recurrence TEXT
    CHECK (recurrence IS NULL OR recurrence IN
      ('weekly', 'fortnightly', 'four_weekly', 'monthly', 'quarterly', 'annual')),
  -- A real date this fell due. Later dates are stepped from it, which is what
  -- makes quarterly and annual work at all.
  ADD COLUMN IF NOT EXISTS anchor_date DATE,
  -- Goals only: when the money is wanted by. Null means no deadline, which the
  -- engine reads as "no implied rate".
  ADD COLUMN IF NOT EXISTS target_date DATE,
  -- What was already put by before budgeting started. Without it, someone who
  -- signs up on the 25th is asked to fund a full month's rent in six days.
  ADD COLUMN IF NOT EXISTS opening_minor BIGINT NOT NULL DEFAULT 0
    CHECK (opening_minor >= 0);

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_pot_shape;
ALTER TABLE categories
  ADD CONSTRAINT categories_pot_shape CHECK (
    (kind = 'flow' AND pot_kind IS NULL)
    OR
    -- A bill without a recurrence and an anchor has no next due date, so it can
    -- never be accrued for. Savings smooth and goals use target_date, so
    -- neither needs one.
    (kind = 'pot' AND pot_kind = 'bill' AND recurrence IS NOT NULL AND anchor_date IS NOT NULL)
    OR
    (kind = 'pot' AND pot_kind IN ('saving', 'goal'))
  );

-- ── migrate what is already there ────────────────────────────────────────
-- Every existing fixed cost is a monthly bill. due_day becomes a real anchor
-- date in the current month, clamped, so stepping forward from it is exact.
UPDATE categories
   SET kind        = 'pot',
       pot_kind    = 'bill',
       recurrence  = 'monthly',
       anchor_date = make_date(
                       EXTRACT(YEAR  FROM CURRENT_DATE)::int,
                       EXTRACT(MONTH FROM CURRENT_DATE)::int,
                       LEAST(COALESCE(due_day, 1),
                             EXTRACT(DAY FROM (date_trunc('month', CURRENT_DATE)
                                               + INTERVAL '1 month - 1 day'))::int))
 WHERE is_fixed = true AND kind = 'flow';

COMMIT;
