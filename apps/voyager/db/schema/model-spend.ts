import { sql } from "drizzle-orm";
import { check, date, integer } from "drizzle-orm/pg-core";

import { reading } from "./_schema";

// The one row per calendar day the daily caps of RL-36, RL-41 and RL-42 read
// and bump in a single `on conflict do update`, before either route ever
// calls a paid provider — never after. Counted in calls, never in dollars.
export const modelSpend = reading.table(
  "model_spend",
  {
    day: date().primaryKey(),
    calls: integer().notNull().default(0),
    photos: integer().notNull().default(0),
  },
  (t) => [
    check("model_spend_calls_non_negative", sql`${t.calls} >= 0`),
    check("model_spend_photos_non_negative", sql`${t.photos} >= 0`),
  ],
);

export type ModelSpendRow = typeof modelSpend.$inferSelect;
export type NewModelSpendRow = typeof modelSpend.$inferInsert;
