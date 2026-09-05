import type { AuthClient } from './auth/client.js';
import type { Settings } from './store.js';

/**
 * Settings over HTTP.
 *
 * Kept out of the sync engine on purpose: these are single last-write-wins
 * scalars, and pushing them through the transaction merge machinery would be
 * ceremony for values that cannot meaningfully conflict.
 *
 * Every call is best-effort. Settings are already correct on this device, so a
 * network failure must never block the UI or lose the local value — it just
 * means the other devices find out later.
 */

interface Wire {
  display_name: string;
  base_currency: string;
  day_to_day_minor: number;
  savings_target_minor: number;
  avatar_emoji: string;
  avatar_colour: string;
  monthly_income_minor: number;
  cycle_kind: 'days' | 'monthly';
  cycle_length_days: number | null;
  cycle_anchor_date: string | null;
  cycle_anchor_day: number | null;
  expected_income_minor: number;
  budget_start_date: string | null;
  opening_cash_minor: number;
}

const toWire = (s: Settings): Wire => ({
  display_name: s.displayName,
  base_currency: s.baseCurrency,
  day_to_day_minor: s.dayToDayMinor,
  savings_target_minor: s.savingsTargetMinor,
  avatar_emoji: s.avatarEmoji,
  avatar_colour: s.avatarColour,
  monthly_income_minor: s.monthlyIncomeMinor,
  cycle_kind: s.cycleKind,
  cycle_length_days: s.cycleLengthDays,
  cycle_anchor_date: s.cycleAnchorDate,
  cycle_anchor_day: s.cycleAnchorDay,
  expected_income_minor: s.expectedIncomeMinor,
  budget_start_date: s.budgetStartDate,
  opening_cash_minor: s.openingCashMinor,
});

const fromWire = (w: Wire): Settings => ({
  displayName: w.display_name,
  baseCurrency: w.base_currency,
  dayToDayMinor: w.day_to_day_minor,
  savingsTargetMinor: w.savings_target_minor,
  avatarEmoji: w.avatar_emoji,
  avatarColour: w.avatar_colour,
  monthlyIncomeMinor: w.monthly_income_minor,
  // A server that predates migration 008 sends none of these. Defaulting to
  // monthly-on-the-1st reproduces the old behaviour rather than producing a
  // cycle with no anchor, which cycleFor cannot use.
  cycleKind: w.cycle_kind ?? 'monthly',
  cycleLengthDays: w.cycle_length_days ?? null,
  cycleAnchorDate: w.cycle_anchor_date ?? null,
  cycleAnchorDay: w.cycle_anchor_day ?? 1,
  /*
   * Adopt the legacy monthly figure when the cycle one has never been set.
   *
   * This is the path that actually matters: a device pulls settings from the
   * server, and if it takes expected_income_minor at face value a real account
   * that has only ever had monthly_income_minor reports no income at all —
   * which silences every affordability signal and leaves Analytics showing
   * "In £0.00" to someone earning £2,000 a month.
   */
  expectedIncomeMinor: (w.expected_income_minor ?? 0) > 0
    ? w.expected_income_minor
    : (w.monthly_income_minor ?? 0),
  budgetStartDate: w.budget_start_date ?? null,
  openingCashMinor: Number(w.opening_cash_minor ?? 0),
});

export async function fetchSettings(
  auth: AuthClient,
  baseUrl: string,
): Promise<Settings | null> {
  try {
    const res = await auth.authedFetch(`${baseUrl}/v1/sync/settings`, { method: 'GET' });
    if (!res.ok) return null;
    const body = (await res.json()) as { settings: Wire | null };
    return body.settings ? fromWire(body.settings) : null;
  } catch {
    return null;
  }
}

export async function saveSettings(
  auth: AuthClient,
  baseUrl: string,
  s: Settings,
): Promise<void> {
  try {
    await auth.authedFetch(`${baseUrl}/v1/sync/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toWire(s)),
    });
  } catch {
    // Best effort; the local value already stands.
  }
}
