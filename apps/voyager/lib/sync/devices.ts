import "server-only";

import { sql } from "drizzle-orm";

import type { Transaction } from "@/lib/session";

// One row of the device list the account screen draws (RL-25): what the
// device is called, when it last synced, and how many searches it copied.
export type DeviceRow = {
  deviceId: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
  lookups: number;
};

/**
 * Every device that has copied to this reader's account, each with its own
 * lookup count. ONE round trip: the count rides a `left join lateral`, not a
 * correlated subquery in the projection — a correlated one turns this into
 * N round trips and that never shows up reading the code (`AGENTS.md`).
 * `left join`, not `join`: a device with zero rows still has to be drawn.
 */
export async function listDevices(tx: Transaction, userId: string): Promise<DeviceRow[]> {
  const rows = await tx.execute<{
    device_id: string;
    label: string;
    // `#>>` unwraps the jsonb scalar as text: Postgres's own JSON serialisation
    // of a timestamptz is ISO 8601, unlike the driver's raw wire format, which
    // this connection reads back as `YYYY-MM-DD HH:MI:SS+00` — no `T`, not ISO.
    created_at: string;
    last_seen_at: string;
    lookups: number;
  }>(sql`
    select
      d.device_id,
      d.label,
      to_jsonb(d.created_at) #>> '{}'::text[] as created_at,
      to_jsonb(d.last_seen_at) #>> '{}'::text[] as last_seen_at,
      coalesce(l.lookups, 0) as lookups
    from devices d
    left join lateral (
      select count(*)::int as lookups
      from lookups
      where lookups.user_id = d.user_id and lookups.device_id = d.device_id
    ) l on true
    where d.user_id = ${userId}
    order by d.last_seen_at desc
  `);

  return rows.map((row) => ({
    deviceId: row.device_id,
    label: row.label,
    createdAt: new Date(row.created_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    lookups: row.lookups,
  }));
}

/**
 * How many rows would come down to a device syncing from `cursorIso` on —
 * the second figure `enableWithBothCounts` shows before the reader turns the
 * copy on (RL-23). A null cursor is a device that has never synced: every
 * row the account holds would come down, so the bound falls back to
 * `-infinity` rather than comparing against nothing. `cursorIso` is the
 * `receivedAt` half alone — `app/api/devices/route.ts` strips the
 * `pulledThroughCursor` tuple's `(deviceId, localId)` tiebreakers before
 * calling this, since a count needs no tiebreak, only the clock.
 *
 * `::text::timestamptz`, never a bare cast: `coalesce` with a `timestamptz`
 * literal makes Postgres describe the parameter itself as `timestamptz`
 * (OID 1184), and postgres.js then serialises the bound value through
 * `new Date(x).toISOString()` — dropping the stored microseconds (the same
 * trap module 10 hit in `app/api/log/sync/route.ts`). Casting from text
 * keeps the parameter's own OID at `text` (25), so the microseconds a
 * cursor minted after module 10 carries reach Postgres intact.
 */
export async function countPending(
  tx: Transaction,
  userId: string,
  cursorIso: string | null,
): Promise<number> {
  const [row] = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count
    from lookups
    where user_id = ${userId}
      and received_at > coalesce(${cursorIso}::text::timestamptz, '-infinity'::timestamptz)
  `);

  return row?.count ?? 0;
}

/**
 * Retires one device (RL-25): its copied searches leave the account and the
 * device itself stops syncing. ONE round trip, atomic by construction — the
 * `gone` CTE modifies data, so Postgres runs it whether or not the outer
 * statement's `returning` is read (`docs/TRAPS.md:463-486`), unlike a plain
 * `SELECT` CTE, which a caller could otherwise see run without the delete
 * beneath it. Retiring an already-retired device matches zero rows in
 * `devices` and answers `{ lookups: 0 }` rather than throwing: `retireDevice`
 * is a filter under RLS, not an assertion that the device still exists.
 *
 * The `where` narrows the index; the policy — `lookups_delete_self` and
 * `devices_delete_self` — is what actually keeps this off another reader's
 * rows (RNL-10).
 */
export async function retireDevice(
  tx: Transaction,
  userId: string,
  deviceId: string,
): Promise<{ lookups: number }> {
  const [row] = await tx.execute<{ lookups: number }>(sql`
    with gone as (
      delete from reading.lookups where user_id = ${userId} and device_id = ${deviceId} returning 1
    )
    delete from reading.devices where user_id = ${userId} and device_id = ${deviceId}
    returning (select count(*) from gone) as lookups
  `);

  return { lookups: row ? Number(row.lookups) : 0 };
}
