/**
 * Normalize phone input to the E.164 form the API expects.
 *
 * Users often paste numbers with spaces or separators; stripping those keeps
 * the Send code button usable without relaxing the backend contract.
 */
export function normalizePhoneE164(input: string): string {
  return input.trim().replace(/[()\s-]/g, '');
}

export function isValidPhoneE164(input: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(normalizePhoneE164(input));
}