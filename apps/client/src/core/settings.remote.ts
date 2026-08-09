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
}

const toWire = (s: Settings): Wire => ({
  display_name: s.displayName,
  base_currency: s.baseCurrency,
  day_to_day_minor: s.dayToDayMinor,
  savings_target_minor: s.savingsTargetMinor,
  avatar_emoji: s.avatarEmoji,
  avatar_colour: s.avatarColour,
});

const fromWire = (w: Wire): Settings => ({
  displayName: w.display_name,
  baseCurrency: w.base_currency,
  dayToDayMinor: w.day_to_day_minor,
  savingsTargetMinor: w.savings_target_minor,
  avatarEmoji: w.avatar_emoji,
  avatarColour: w.avatar_colour,
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
