// Pesos are what a person types and cents are what the ledger stores. No
// function here knows an account's kind or a movement's sign: that belongs
// to the one SQL expression that derives them from the accounts involved.

// COP has no coin smaller than the peso, so this bounds what a person can
// type: eleven nines is comfortably past any fund this app will ever hold.
export const MAX_AMOUNT_PESOS = 99_999_999_999;

// Strips the separators `Intl.NumberFormat` writes and the ones a person
// types by hand, so a pasted "500.000" and a typed "500000" parse the same.
// Only a separator sitting where a thousands group falls — exactly three
// digits, then another separator or the end — is a group mark; anything
// else is left in place so "500.5" still reads as a decimal, not a peso.
export function normalizeAmountInput(raw: string): string {
  return raw.replace(/[.,   ](?=\d{3}(?:\D|$))/g, "");
}

// `null` on anything but a plain run of digits: no sign, no decimal, no
// exponent. A negative or fractional peso is not a value this form accepts.
export function parsePesos(raw: string): number | null {
  const normalized = normalizeAmountInput(raw);
  if (!/^\d+$/.test(normalized)) return null;

  return Number(normalized);
}

export function pesosToCents(pesos: number): number {
  return pesos * 100;
}

// Presentation only: a cent total that is not a multiple of 100 cannot occur
// in COP, so this never rounds and never feeds back into a stored amount.
export function centsToPesos(cents: number): number {
  return cents / 100;
}
