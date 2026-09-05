-- 009 — money you actually hold, and moving it between your own pockets.
--
-- Two additions, both additive. Nothing is dropped here: 010 removes is_fixed
-- and monthly_income_minor once no client reads them.
--
-- WHY
--
-- The app budgeted from an assumed pay packet. It back-dated to the last
-- payday, took expected_income_minor on faith and divided that up, so someone
-- joining mid-cycle with £200 left was planned around a full £500 that had
-- already been spent. Nothing ever asked what they had.
--
-- opening_cash_minor is that missing figure: the balance the ledger opens on.
-- Every later cycle opens on the previous one's close, so a good week carries
-- forward and an overspent one carries as debt.
--
-- is_transfer marks money moving between the user's own pockets — setting cash
-- aside for rent, or taking it back. It is neither income nor spending, and it
-- must never count as money leaving: saving £90 toward rent and then paying
-- the £650 rent would otherwise charge £740 for a £650 bill.

BEGIN;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS opening_cash_minor bigint NOT NULL DEFAULT 0;

-- Partitioned parent: the column propagates to every partition.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false;

-- A row cannot be both money arriving and money moving sideways.
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_income_xor_transfer;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_income_xor_transfer
  CHECK (NOT (is_income AND is_transfer));

-- A transfer is always into or out of a specific pot, so it must name one.
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_transfer_has_category;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_transfer_has_category
  CHECK (NOT is_transfer OR category_id IS NOT NULL);

COMMIT;
