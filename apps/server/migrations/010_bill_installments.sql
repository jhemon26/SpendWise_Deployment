-- 010 — how many pay packets a bill is split across.
--
-- Additive and nullable: null means "as many as fit", which is what every
-- existing bill has been doing. Nothing changes for anyone until they choose.
--
-- Capped at 4 in the column as well as the schema. The engine caps again at
-- the paydays that actually exist in one bill period, so a monthly earner who
-- picks 4 gets 1 — but a bad value should never reach the engine to begin with.

BEGIN;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS installments smallint;

ALTER TABLE categories
  DROP CONSTRAINT IF EXISTS categories_installments_range;
ALTER TABLE categories
  ADD CONSTRAINT categories_installments_range
  CHECK (installments IS NULL OR (installments BETWEEN 1 AND 4));

COMMIT;
