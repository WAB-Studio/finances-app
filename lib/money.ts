import {
  BASE_CURRENCY,
  type CurrencyCode,
  minorUnitExponent,
} from "@/lib/currency";
import { FORMAT_LOCALE, type Locale } from "@/lib/locales";

// Two scales live here, and they are not the same one (RNF-05).
//
// The stored scale is hundredths of the major unit, for every currency alike.
// The ledger was written when the peso was the only currency and every amount
// column has held hundredths of a peso since the first row: 350.000 pesos is
// the integer 35000000. The scale belongs to the column, not to the code the
// row carries, so nothing has to be rewritten to let a second currency in.
//
// The written exponent is how many decimals a person types and reads, and that
// one does come from the currency: `Intl` says the peso has no circulating
// coin below itself, so a peso amount is written without decimals, while a
// dollar amount is written with two. Reading the stored scale off `Intl` is
// what would write an amount a hundred times too small.
const STORAGE_EXPONENT = 2;
const STORAGE_UNIT = 10 ** STORAGE_EXPONENT;

type AmountScale = {
  // The divisor between the integer the column keeps and the amount it stands
  // for. The same for every currency, and asked of the currency anyway, so the
  // two scales are read side by side and neither is taken for the other.
  stored: number;
  // Decimals a person types and a figure draws. Never finer than the column
  // keeps: a digit the row cannot hold is one a field must not accept.
  written: number;
};

function amountScale(currency: CurrencyCode): AmountScale {
  return {
    stored: STORAGE_UNIT,
    written: Math.min(minorUnitExponent(currency), STORAGE_EXPONENT),
  };
}

// Eleven nines of the major unit is comfortably past any fund this app will
// ever hold. Carried into the stored scale it lands at 9.9999999999e12, three
// decimal orders under `Number.MAX_SAFE_INTEGER`.
const MAX_AMOUNT_MAJOR = 99_999_999_999;

export function maxAmountMinor(currency: CurrencyCode): number {
  return MAX_AMOUNT_MAJOR * amountScale(currency).stored;
}

// Strips the separators `Intl.NumberFormat` writes and the ones a person types
// by hand, so a pasted "500.000" and a typed "500000" parse the same. Bank
// messages may append zero decimals in either locale.
// Only a separator sitting where a thousands group falls — exactly three
// digits, then another separator or the end — is a group mark; anything else
// is left in place so "500.5" still reads as a decimal, not a group.
function normalizeGroupMarks(raw: string): string {
  const withoutZeroFraction = raw.trim().replace(/[.,]00$/, "");
  return withoutZeroFraction.replace(/[.,   ](?=\d{3}(?:\D|$))/g, "");
}

// Reads a written figure and hands back an integer scaled by `exponent`. The
// two scales enter separately on purpose: `written` bounds the decimals the
// text may carry, `exponent` decides what the integer counts.
function parseWritten(
  raw: string,
  written: number,
  exponent: number,
): number | null {
  const trimmed = raw.trim();

  // A lone separator with exactly three digits behind it and nothing after is a
  // group mark and a fraction at once, and the two readings are a thousand
  // apart. A currency with decimals refuses it rather than pick one in silence.
  // A second separator settles the reading whether or not the two are alike, and
  // a currency without decimals has only the group reading, which is what
  // "500.000" has always been.
  const separators = trimmed.match(/[.,]/g)?.length ?? 0;
  if (written > 0 && separators === 1 && /[.,]\d{3}$/.test(trimmed)) return null;

  const match = /^(\d+)(?:[.,](\d+))?$/.exec(normalizeGroupMarks(trimmed));
  if (!match) return null;

  const [, major, fraction = ""] = match;
  if (fraction.length > written) return null;

  // Integers throughout: no digit of a written amount ever sits in the
  // fractional part of a `number` on its way to a column.
  const value =
    Number(major) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || 0);

  return Number.isSafeInteger(value) ? value : null;
}

/**
 * A typed amount as the integer the ledger stores, or `null` when it is not
 * one. Takes up to as many decimals as the currency is written with and not one
 * more, so "10,50" is a dollar amount and no peso amount at all, and refuses a
 * separator that could be read either way. No sign and no exponent: a negative
 * or fractional stored amount is not a value a form takes.
 *
 * The result is in the stored scale, not in the currency's own minor unit:
 * "1000" pesos comes back as 100000, the same integer the column already holds
 * for a thousand pesos.
 */
export function parseAmount(
  raw: string,
  currency: CurrencyCode,
): number | null {
  return parseWritten(raw, amountScale(currency).written, STORAGE_EXPONENT);
}

/**
 * What the amount field shows for a stored figure. Writes the decimal mark
 * Spanish uses, the language the copy is written in; `parseAmount` reads either
 * mark back, so a person may still type the other one.
 */
export function amountToInput(minor: number, currency: CurrencyCode): string {
  const { stored, written } = amountScale(currency);
  const major = Math.trunc(minor / stored);
  if (written === 0) return String(major);

  // How many stored units one written decimal is worth: one, wherever the two
  // scales meet.
  const step = stored / 10 ** written;
  const fraction = Math.trunc(Math.abs(minor) / step) % 10 ** written;

  return `${major},${String(fraction).padStart(written, "0")}`;
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
  const amount = amountMinor / amountScale(from).stored;
  const counter = counterMinor / amountScale(to).stored;

  return counter / amount;
}

// Built per language and per currency, and kept: a screen draws fifty figures,
// and constructing a formatter costs more than the figure it writes.
const FORMATTERS = new Map<string, Intl.NumberFormat>();

/**
 * The magnitude of an amount, drawn in its currency and in the region the
 * language belongs to (RF-125). The one path from a stored integer to a figure:
 * `Money` composes over this and adds the sign, the tone and the estimate mark,
 * which only the primitive knows about. A message that interpolates an amount
 * calls it directly, since JSX cannot travel through `t()`.
 *
 * Takes a magnitude on purpose, applying `Math.abs` itself, so no sign can
 * leave here: `Intl` writes a hyphen-minus, and the only minus this app draws
 * is the primitive's U+2212 (SPEC-A3).
 *
 * The locale is a parameter, not a hook: half the callers are not components.
 */
export function formatMoney(
  minor: number,
  currency: CurrencyCode,
  locale: Locale,
): string {
  const { stored, written } = amountScale(currency);
  const key = `${locale}:${currency}`;
  let formatter = FORMATTERS.get(key);

  if (!formatter) {
    // Not a next-intl named format: one carries no locale, and a figure is
    // drawn for the region a language belongs to, not for the bare language.
    formatter = new Intl.NumberFormat(FORMAT_LOCALE[locale], {
      style: "currency",
      currency,
      minimumFractionDigits: written,
      maximumFractionDigits: written,
    });
    FORMATTERS.set(key, formatter);
  }

  // Presentation, and the only division here: the stored integer stays whole
  // everywhere else, and the formatter takes the amount it stands for.
  return formatter.format(Math.abs(minor) / stored);
}

// COP-only wrappers, marked to retire. Forty-five files still call them, from
// when every amount was a peso stored as a hundredth of itself. Each caller
// drops its own as the screen it serves starts carrying a currency (RF-121).
// They count whole pesos, which is a third scale and the reason they go: only
// `pesosToCents` bridges them to the integer a column holds.

/** @deprecated Bound an amount with `maxAmountMinor(currency)`. */
export const MAX_AMOUNT_PESOS = MAX_AMOUNT_MAJOR;

/** @deprecated Normalising is `parseAmount`'s own business. */
export function normalizeAmountInput(raw: string): string {
  return normalizeGroupMarks(raw);
}

/** @deprecated Parse with `parseAmount(raw, currency)`, which stores the result. */
export function parsePesos(raw: string): number | null {
  return parseWritten(raw, amountScale(BASE_CURRENCY).written, 0);
}

/** @deprecated An amount is already stored in the scale a column keeps. */
export function pesosToCents(pesos: number): number {
  return pesos * 100;
}

/** @deprecated Formatting an amount is `Money`'s own business. */
export function centsToPesos(cents: number): number {
  return cents / 100;
}
