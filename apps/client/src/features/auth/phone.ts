/**
 * Normalize phone input to the E.164 form the API expects.
 *
 * Users often paste numbers with spaces or separators; stripping those keeps
 * the Send code button usable without relaxing the backend contract.
 */

/**
 * Countries whose subscriber numbers legitimately begin with 0, so the leading
 * zero must NOT be treated as a trunk prefix.
 *
 * Italy is the well-known case: Rome landlines really are +39 06…, and the 0 is
 * part of the number. Everywhere else in common use (UK, IE, FR, DE, NL, AU,
 * NZ, IN, BD…) the 0 is a national-dialling prefix that is dropped in E.164.
 */
const KEEPS_LEADING_ZERO = ['+39'];

/**
 * Calling codes we recognise, longest first so +353 wins over +35 and +1.
 *
 * An explicit list is necessary, not fussiness: a regex cannot tell where a
 * calling code ends. `\+\d{1,3}` reads "+447024976510" as code "+447" and then
 * eats the subscriber's own leading zero, turning a valid number into a
 * different one. Anything not on this list is left untouched — a number we
 * cannot parse confidently is safer unmodified than mangled.
 */
const CALLING_CODES = [
  '+353', '+351', '+352', '+354', '+358', '+372', '+380', '+420', '+421', '+880', '+971',
  '+30', '+31', '+32', '+33', '+34', '+36', '+39', '+40', '+41', '+43', '+44', '+45',
  '+46', '+47', '+48', '+49', '+61', '+64', '+65', '+81', '+82', '+84', '+86', '+90', '+91', '+92',
  '+1', '+7',
].sort((a, b) => b.length - a.length);

/**
 * Strip the national trunk prefix.
 *
 * "+44 07424 976510" and "+44 7424 976510" are the same phone, but as strings
 * they differ — and since the phone number IS the account identifier, leaving
 * both forms alive silently gives one person two accounts, each holding half
 * their data. This is the one place that can be prevented.
 */
function stripTrunkZero(e164: string): string {
  const code = CALLING_CODES.find((cc) => e164.startsWith(cc));
  if (!code) return e164;
  if (KEEPS_LEADING_ZERO.includes(code)) return e164;

  const rest = e164.slice(code.length);
  const trimmed = rest.replace(/^0+/, '');
  // All zeros would leave nothing behind; that is not a trunk prefix, it is a
  // broken number, and isValidPhoneE164 should be the one to reject it.
  return trimmed ? code + trimmed : e164;
}

export function normalizePhoneE164(input: string): string {
  return stripTrunkZero(input.trim().replace(/[()\s.–—-]/g, ''));
}

export function isValidPhoneE164(input: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(normalizePhoneE164(input));
}
