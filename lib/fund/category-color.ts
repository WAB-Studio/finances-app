// Lifted from SEED_CATEGORIES (lib/fund/seed.ts), in the order they appear there.
export const CATEGORY_COLORS = [
  "#E11D48",
  "#F97316",
  "#F59E0B",
  "#10B981",
  "#06B6D4",
  "#8B5CF6",
  "#EC4899",
  "#A16207",
  "#64748B",
  "#78716C",
  "#475569",
  "#16A34A",
  "#0EA5E9",
  "#14B8A6",
  "#6366F1",
] as const;

// The first unused colour, or a deterministic wrap once every colour is taken.
// `color` is an unconstrained `text()` column, so a stored value may differ
// from the palette only in case; the comparison ignores it, the return never does.
export function nextCategoryColor(used: readonly string[]): string {
  const usedUpper = used.map((color) => color.toUpperCase());
  const free = CATEGORY_COLORS.find((color) => !usedUpper.includes(color));
  return free ?? CATEGORY_COLORS[used.length % CATEGORY_COLORS.length];
}
