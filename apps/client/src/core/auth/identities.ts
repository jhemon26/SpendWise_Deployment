import type { AuthClient } from './client.js';

/**
 * Who this account belongs to.
 *
 * Shown in Profile because nothing else told people which account they were in
 * — someone signing in on a second device with a different Google account got a
 * fresh, empty SpendWise and no way to see why. That is correct behaviour
 * (different account, different data) but it looked like data loss.
 */
export interface Identity {
  provider: string;
  email: string | null;
  phone_e164: string | null;
}

/** Best-effort: this is a label, never a reason to block the app. */
export async function fetchIdentities(auth: AuthClient, baseUrl: string): Promise<Identity[]> {
  try {
    const res = await auth.authedFetch(`${baseUrl}/v1/auth/identities`, { method: 'GET' });
    if (!res.ok) return [];
    const body = (await res.json()) as { identities?: Identity[] };
    return body.identities ?? [];
  } catch {
    return [];
  }
}

/** What to show: the email, else the phone, else the provider's name. */
export function labelFor(i: Identity): string {
  return i.email ?? i.phone_e164 ?? i.provider;
}

export const PROVIDER_NAME: Record<string, string> = {
  google: 'Google',
  apple: 'Apple',
  phone: 'Phone',
  email: 'Email',
};
