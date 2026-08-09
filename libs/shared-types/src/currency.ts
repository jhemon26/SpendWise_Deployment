/**
 * ISO-4217 currency handling.
 *
 * The entire app stores money as integer MINOR UNITS — never floats, and never
 * a hardcoded /100. The exponent varies by currency:
 *
 *   JPY  ¥1000    -> 1000 minor units  (0 decimal places)
 *   GBP  £10.00   -> 1000 minor units  (2 decimal places)
 *   KWD  KD1.000  -> 1000 minor units  (3 decimal places)
 *
 * All three are "1000" in the database and mean completely different amounts.
 * Getting this wrong is a 100x error on a Tokyo lunch, so every parse and
 * format in the codebase goes through this module.
 */

export type CurrencyCode = string;

/** Currencies whose exponent is not the default 2. Everything else is 2. */
const MINOR_UNIT_EXCEPTIONS: Readonly<Record<string, number>> = Object.freeze({
  // zero decimal places
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // three decimal places
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  // four decimal places
  CLF: 4, UYW: 4,
});

export const DEFAULT_MINOR_UNITS = 2;

/** Largest minor-unit value we accept, keeping us inside IEEE-754 safe integers. */
export const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export class CurrencyError extends Error {}

const CODE_RE = /^[A-Z]{3}$/;

export function assertCurrencyCode(code: string): asserts code is CurrencyCode {
  if (!CODE_RE.test(code)) {
    throw new CurrencyError(`Invalid ISO-4217 code: ${JSON.stringify(code)}`);
  }
}

/** Decimal places for a currency. Unknown codes default to 2. */
export function minorUnits(code: CurrencyCode): number {
  assertCurrencyCode(code);
  return MINOR_UNIT_EXCEPTIONS[code] ?? DEFAULT_MINOR_UNITS;
}

/**
 * Parse a human decimal string (or number) into integer minor units.
 *
 * Parsing is done on the STRING, never by multiplying a float:
 * `19.99 * 100` is 1998.9999999999998 in IEEE-754, which floors to 1998 and
 * loses a penny. Concatenating the digits and parsing once is exact.
 *
 * Extra precision beyond the currency's exponent is rounded half-up
 * (away from zero for negatives), which matches how people expect cash to
 * round. Rejecting instead would break paste-from-spreadsheet.
 */
export function toMinor(input: string | number, code: CurrencyCode): number {
  const exp = minorUnits(code);

  const raw =
    typeof input === 'number'
      ? Number.isFinite(input)
        ? // toFixed with one extra digit so the rounding below, not the float
          // formatter, decides the final unit
          input.toFixed(Math.min(exp + 1, 20))
        : (() => {
            throw new CurrencyError(`Amount is not finite: ${input}`);
          })()
      : input.trim();

  const m = /^([+-])?(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!m) throw new CurrencyError(`Cannot parse amount: ${JSON.stringify(raw)}`);

  const sign = m[1] === '-' ? -1 : 1;
  const whole = m[2] ?? '0';
  const frac = m[3] ?? '';

  // one digit past the exponent tells us how to round
  const padded = frac.padEnd(exp + 1, '0');
  const keep = padded.slice(0, exp);
  const nextDigit = Number(padded[exp] ?? '0');

  const digits = whole + keep;
  if (digits.length > 16) {
    throw new CurrencyError(`Amount exceeds safe integer range: ${raw}`);
  }

  let minor = Number(digits);
  if (nextDigit >= 5) minor += 1;

  if (minor > MAX_MINOR) {
    throw new CurrencyError(`Amount exceeds safe integer range: ${raw}`);
  }
  return sign * minor;
}

/** Minor units back to a plain decimal number. Display only — never for maths. */
export function fromMinor(minor: number, code: CurrencyCode): number {
  const exp = minorUnits(code);
  return minor / 10 ** exp;
}

/** Exact decimal string for minor units. Safe for display and for re-parsing. */
export function toDecimalString(minor: number, code: CurrencyCode): string {
  if (!Number.isInteger(minor)) {
    throw new CurrencyError(`Minor units must be an integer, got ${minor}`);
  }
  const exp = minorUnits(code);
  const neg = minor < 0;
  const digits = Math.abs(minor).toString().padStart(exp + 1, '0');
  const whole = digits.slice(0, digits.length - exp) || '0';
  const frac = exp > 0 ? '.' + digits.slice(digits.length - exp) : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
}

/** Localised currency string, e.g. "£24.00" / "¥1,000" / "KD1.000". */
export function formatMoney(
  minor: number,
  code: CurrencyCode,
  locale = 'en-GB',
): string {
  const exp = minorUnits(code);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(fromMinor(minor, code));
}

/**
 * Format a signed amount for display.
 *
 * formatMoney delegates to Intl.NumberFormat, which emits its OWN minus sign
 * for negatives. Prefixing another one by hand yields "−-£167.29" — U+2212
 * followed by U+002D, two different dash characters — which is what shipped on
 * the home hero and on every spending day in Activity. Format the MAGNITUDE and
 * let this add the sign, so there is one place that decides.
 *
 * Zero gets no sign: "+£0.00" and "−£0.00" both read as mistakes.
 */
export function formatSignedMoney(
  minor: number,
  code: CurrencyCode,
  locale = 'en-GB',
): string {
  const sign = minor > 0 ? '+' : minor < 0 ? '\u2212' : '';
  return sign + formatMoney(Math.abs(minor), code, locale);
}

/**
 * Convert between currencies at a given rate, returning minor units in the
 * target currency. Rounds half-up on the target's exponent.
 *
 * Rates are stored as NUMERIC(18,8) server-side; the multiplication happens in
 * float here, which is fine because the result is immediately rounded to a
 * minor unit and the inputs are far inside the safe range.
 */
export function convertMinor(
  minor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: number,
): number {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new CurrencyError(`FX rate must be positive and finite, got ${rate}`);
  }
  const fromExp = minorUnits(from);
  const toExp = minorUnits(to);
  const major = minor / 10 ** fromExp;
  const converted = major * rate * 10 ** toExp;
  // round half away from zero, matching toMinor
  return converted < 0 ? -Math.round(-converted) : Math.round(converted);
}

/* ── pay frequency ─────────────────────────────────────────────────────── */

export type PayFrequency = 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'annual';

export const PAY_FREQUENCIES: PayFrequency[] =
  ['weekly', 'fortnightly', 'four_weekly', 'monthly', 'annual'];

export const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Every 2 weeks',
  four_weekly: 'Every 4 weeks',
  monthly: 'Monthly',
  annual: 'Yearly',
};

/**
 * Weeks in a year, averaged over the leap cycle.
 *
 * NOT 52, and emphatically not "4 weeks to a month". A year is 52.1775 weeks,
 * so weekly pay is 4.348 monthly, not 4. Using 4 would understate someone's
 * income by about 8% — which then understates their suggested budgets and
 * their savings target, so the app would quietly tell them they can afford
 * less than they can. The error compounds through every derived figure.
 */
const WEEKS_PER_YEAR = 365.25 / 7;

/** Convert pay at any cadence to the monthly figure the app budgets in. */
export function toMonthlyMinor(amountMinor: number, freq: PayFrequency): number {
  switch (freq) {
    case 'monthly': return Math.round(amountMinor);
    case 'annual': return Math.round(amountMinor / 12);
    case 'weekly': return Math.round((amountMinor * WEEKS_PER_YEAR) / 12);
    case 'fortnightly': return Math.round((amountMinor * (WEEKS_PER_YEAR / 2)) / 12);
    case 'four_weekly': return Math.round((amountMinor * (WEEKS_PER_YEAR / 4)) / 12);
  }
}

/**
 * The inverse, so the amount can be shown back in the user's own terms.
 *
 * Round-tripping is lossy by a penny or two — that is inherent to storing one
 * monthly number, not a bug to chase.
 */
export function fromMonthlyMinor(monthlyMinor: number, freq: PayFrequency): number {
  switch (freq) {
    case 'monthly': return Math.round(monthlyMinor);
    case 'annual': return Math.round(monthlyMinor * 12);
    case 'weekly': return Math.round((monthlyMinor * 12) / WEEKS_PER_YEAR);
    case 'fortnightly': return Math.round((monthlyMinor * 12) / (WEEKS_PER_YEAR / 2));
    case 'four_weekly': return Math.round((monthlyMinor * 12) / (WEEKS_PER_YEAR / 4));
  }
}

export const isPayFrequency = (v: unknown): v is PayFrequency =>
  typeof v === 'string' && (PAY_FREQUENCIES as string[]).includes(v);
