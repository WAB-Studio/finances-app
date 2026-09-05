import {
  BASE_CURRENCY,
  type CurrencyCode,
  minorUnitExponent,
} from "@/lib/currency";

// Minor units are what a person types and what the ledger stores (RNF-05): the
// peso for COP, the cent for USD. No function here knows an account's kind or a
// movement's sign: that belongs to the one SQL expression that derives them
// from the accounts involved.

// Eleven nines of the major unit is comfortably past any fund this app will
// ever hold. Carried into the minor unit, USD lands at 9.99e12, well under
// `Number.MAX_SAFE_INTEGER`.
const MAX_AMOUNT_MAJOR = 99_999_999_999;

export function maxAmountMinor(currency: CurrencyCode): number {
  return MAX_AMOUNT_MAJOR * 10 ** minorUnitExponent(currency);
}

// Strips the separators `Intl.NumberFormat` writes and the ones a person types
// by hand, so a pasted "500.000" and a typed "500000" parse the same. Bank
// messages may append zero decimals in either locale.
// Only a separator sitting where a thousands group falls — exactly three
// digits, then another separator or the end — is a group mark; anything else
// is left in place so "500.5" still reads as a decimal, not a group.
function normalizeGroupMarks(raw: string): string {
  const withoutZeroFraction = raw.trim().replace(/[.,]00$/, "");
  return withoutZeroFraction.replace(/[.,   ](?=\d{3}(?:\D|$))/g, "");
}

/**
 * A typed amount as an integer in the currency's minor unit, or `null` when it
 * is not one. Takes up to as many decimals as the currency has and not one
 * more, so "10,50" is a dollar amount and no peso amount at all, and refuses a
 * separator that could be read either way. No sign and no exponent: a negative
 * or fractional stored amount is not a value a form takes.
 */
export function parseAmount(
  raw: string,
  currency: CurrencyCode,
): number | null {
  const exponent = minorUnitExponent(currency);
  const trimmed = raw.trim();

  // A lone separator with exactly three digits behind it and nothing after is a
  // group mark and a fraction at once, and the two readings are a thousand
  // apart. A currency with decimals refuses it rather than pick one in silence.
  // A second separator settles the reading whether or not the two are alike, and
  // a currency without decimals has only the group reading, which is what
  // "500.000" has always been.
  const separators = trimmed.match(/[.,]/g)?.length ?? 0;
  if (exponent > 0 && separators === 1 && /[.,]\d{3}$/.test(trimmed)) return null;

  const match = /^(\d+)(?:[.,](\d+))?$/.exec(normalizeGroupMarks(trimmed));
  if (!match) return null;

  const [, major, fraction = ""] = match;
  if (fraction.length > exponent) return null;

  const minor =
    Number(major) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || 0);

  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * What the amount field shows for a stored figure. Writes the decimal mark
 * Spanish uses, the language the copy is written in; `parseAmount` reads either
 * mark back, so a person may still type the other one.
 */
export function amountToInput(minor: number, currency: CurrencyCode): string {
  const exponent = minorUnitExponent(currency);
  if (exponent === 0) return String(minor);

  const unit = 10 ** exponent;
  const major = Math.trunc(minor / unit);
  const fraction = String(Math.abs(minor) % unit).padStart(exponent, "0");

  return `${major},${fraction}`;
}

/**
 * The quotient of the two amounts a cross-currency movement carries (RF-122).
 * The one float in this module: it exists to be read, and it is never
 * multiplied back out into an amount that gets stored.
 */
export function deriveRate(
  amountMinor: number,
  from: CurrencyCode,
  counterMinor: number,
  to: CurrencyCode,
): number {
  const amount = amountMinor / 10 ** minorUnitExponent(from);
  const counter = counterMinor / 10 ** minorUnitExponent(to);

  return counter / amount;
}

// COP-only wrappers, marked to retire. Forty-five files still call them, from
// when every amount was a peso stored as a hundredth of itself. Each caller
// drops its own as the screen it serves starts carrying a currency (RF-121).

/** @deprecated Bound an amount with `maxAmountMinor(currency)`. */
export const MAX_AMOUNT_PESOS = MAX_AMOUNT_MAJOR;

/** @deprecated Normalising is `parseAmount`'s own business. */
export function normalizeAmountInput(raw: string): string {
  return normalizeGroupMarks(raw);
}

/** @deprecated Parse with `parseAmount(raw, currency)`. */
export function parsePesos(raw: string): number | null {
  return parseAmount(raw, BASE_CURRENCY);
}

/** @deprecated An amount is already stored in its currency's minor unit. */
export function pesosToCents(pesos: number): number {
  return pesos * 100;
}

/** @deprecated Formatting an amount is `Money`'s own business. */
export function centsToPesos(cents: number): number {
  return cents / 100;
}
