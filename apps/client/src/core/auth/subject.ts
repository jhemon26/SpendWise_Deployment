/**
 * The signed-in user's id, read from the access token.
 *
 * Used only to decide whether the data already on this device belongs to the
 * person signing in. It is NOT a security check — the token is not verified
 * here, and nothing is authorised on the strength of it. The server enforces
 * tenancy through RLS; this just stops one person's rows being shown to the
 * next person who signs in on the same phone.
 */
export function subjectOf(accessToken: string): string | null {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url -> base64, then pad. atob rejects the url-safe alphabet.
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(
      decodeURIComponent(
        atob(padded).split('').map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
      ),
    ) as { sub?: unknown };
    return typeof json.sub === 'string' && json.sub ? json.sub : null;
  } catch {
    return null;
  }
}
