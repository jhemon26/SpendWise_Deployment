-- 007 — pay frequency removed. Income is monthly, full stop; a column nothing
-- reads is a trap for whoever finds it next and assumes it means something.
ALTER TABLE user_settings DROP COLUMN IF EXISTS pay_frequency;
