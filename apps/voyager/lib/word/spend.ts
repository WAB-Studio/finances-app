import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Bumps today's row before the model is ever reached — never after, so a
 * crash mid-call still spends its claim and a call is never left uncounted
 * (`db/schema/model-spend.ts`). One statement: insert-or-bump, returning the
 * new total in the same round trip the caller compares against the cap.
 */
export async function claimDailyCall(): Promise<number> {
  const [row] = await db.execute<{ calls: number }>(sql`
    insert into reading.model_spend as ms (day, calls)
    values (current_date, 1)
    on conflict (day) do update set calls = ms.calls + 1
    returning ms.calls
  `);
  return row.calls;
}
