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

// Reads the midday-UTC instant back as its own calendar day, never a shifted one.
function dateToCivilDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

// Shifts a `YYYY-MM-01` start by whole months, staying on day 1 so a rollover
// past December carries the year without touching JS local time.
function shiftMonthStart(monthStart: string, months: number): string {
  const date = civilDateToDate(monthStart);
  date.setUTCMonth(date.getUTCMonth() + months);
  date.setUTCDate(1);
  return dateToCivilDate(date);
}

// The current Bogotá day snapped back to its month's first day.
function currentMonthStart(): string {
  return `${todayInBogota().slice(0, 7)}-01`;
}

// Half-open `[first day, next month's first day)` for the current Bogotá month.
export function currentMonthRange(): { start: string; endExclusive: string } {
  return monthRange(currentMonthStart());
}

// Half-open `[monthStart, next month's first day)` for any `YYYY-MM-01`.
export function monthRange(monthStart: string): {
  start: string;
  endExclusive: string;
} {
  return { start: monthStart, endExclusive: shiftMonthStart(monthStart, 1) };
}

// Six `YYYY-MM-01` starts, oldest first, ending in the current Bogotá month.
export function lastSixMonthStarts(): string[] {
  const current = currentMonthStart();
  return [5, 4, 3, 2, 1, 0].map((back) => shiftMonthStart(current, -back));
}

// Half-open `[Monday, next Monday)` for the Bogotá week around `reference`. The
// day-of-week is read from the midday-UTC instant, so no local offset shifts it.
export function weekRange(reference: string): {
  start: string;
  endExclusive: string;
} {
  const monday = civilDateToDate(reference);
  // `getUTCDay` is 0 for Sunday; `+ 6 mod 7` counts the days back to Monday.
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const start = dateToCivilDate(monday);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return { start, endExclusive: dateToCivilDate(monday) };
}

// Half-open `[Jan 01 of that year, next Jan 01)` for the year `reference` sits in.
export function yearRange(reference: string): {
  start: string;
  endExclusive: string;
} {
  const jan = civilDateToDate(reference);
  jan.setUTCMonth(0);
  jan.setUTCDate(1);
  const start = dateToCivilDate(jan);
  jan.setUTCFullYear(jan.getUTCFullYear() + 1);
  return { start, endExclusive: dateToCivilDate(jan) };
}

// The half-open window a budget's period spans around `reference` (RF-72).
export function periodRange(
  period: "monthly" | "weekly" | "yearly",
  reference: string,
): { start: string; endExclusive: string } {
  switch (period) {
    case "weekly":
      return weekRange(reference);
    case "yearly":
      return yearRange(reference);
    default:
      // The month `reference` sits in, snapped to its first day.
      return monthRange(`${reference.slice(0, 7)}-01`);
  }
}
