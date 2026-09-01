/**
 * The app's own pool, counted. `db/client.ts` takes the pool off `globalThis.sql`
 * when one is already there, so planting an instrumented pool here makes every
 * statement the app runs pass through a counter — without a line of the app
 * changing, and without the harness having to read a query module and guess.
 *
 * Options are `db/client.ts`'s own, `max` included: the pool under measurement is
 * the pool a request gets, saturation and all.
 *
 * IMPORTED FOR ITS SIDE EFFECT, AND FIRST. An import evaluated after any module
 * that reaches `@/db/client` plants nothing, because the client already made its
 * own pool and drizzle holds that reference.
 */
import postgres from "postgres";

let statements = 0;

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 8,
  idle_timeout: 20,
  connect_timeout: 10,
  // Fires once for every statement the driver puts on the wire — `begin`, the
  // session settle, the query and `commit` alike. That is the round-trip count
  // AGENTS.md asks for: measured at the driver, not counted off the source.
  debug: () => {
    statements += 1;
  },
});

(globalThis as unknown as { sql: unknown }).sql = sql;

export function roundTrips(): number {
  return statements;
}
