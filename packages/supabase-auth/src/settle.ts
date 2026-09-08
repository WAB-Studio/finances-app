import { sql, type SQL } from "drizzle-orm";

/**
 * The statement that asserts a verified session onto a Postgres connection so
 * its RLS policies see `auth.uid()`. One statement, not four: a round trip to
 * the pooler costs more than the query it precedes, and no statement runs
 * between the claims and the role landing.
 *
 * Returns the SQL, it does not run it: the caller is already inside its own
 * transaction and owns the round trip.
 */
export function settleSessionSql(args: {
  claims: string;
  searchPath: string;
  statementTimeoutMs?: number;
}): SQL {
  const { claims, searchPath, statementTimeoutMs = 8000 } = args;

  // `true` is `is_local`: the pooler hands this connection on at commit.
  return sql`select
    set_config('request.jwt.claims', ${claims}, true),
    set_config('statement_timeout', ${String(statementTimeoutMs)}, true),
    set_config('search_path', ${searchPath}, true),
    set_config('role', 'authenticated', true)`;
}
