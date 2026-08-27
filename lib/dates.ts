import { TIME_ZONE } from "@/lib/locales";

// A movement date carries no time (RNF-06), so every read and every render
// goes through this file instead of through `Date`'s local-offset behaviour.

export function todayInBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(
    new Date(),
  );
}

// Rejects a shape match that names no real day, such as "2026-02-31".
export function isCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Midday UTC is the only instant a formatter is ever handed: every zone west
// of UTC+12 and east of UTC-12 still renders this as the same calendar day,
// so the naive `new Date("2026-08-27")` off-by-one-day bug cannot happen.
export function civilDateToDate(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}
