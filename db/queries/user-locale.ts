import "server-only";

import { eq, sql } from "drizzle-orm";

import { insertRow } from "@/db/insert-row";
import { appUsers } from "@/db/schema";
import { getSessionUser, withUserDb } from "@/db/session";
import type { Locale } from "@/lib/locales";

export async function getUserLocale(): Promise<Locale | null> {
  const user = await getSessionUser();
  if (!user) return null;

  return withUserDb(async (tx) => {
    const [row] = await tx
      .select({ locale: appUsers.locale })
      .from(appUsers)
      .where(eq(appUsers.id, user.id))
      .limit(1);

    return row?.locale ?? null;
  });
}

/**
 * Takes no user id on purpose: identity comes from the verified session, and
 * the access policies reject any other row anyway (RNF-04).
 */
export async function upsertUserLocale(locale: Locale): Promise<void> {
  const user = await getSessionUser();
  if (!user) throw new Error("upsertUserLocale called without a session");

  await withUserDb(async (tx) => {
    // One statement, not select-then-write: two tabs would race a check into a
    // duplicate key. `updated_at` moves only here — nothing else touches it.
    // Unlike `debt_terms`, `app_users` grants UPDATE on `updated_at` and carries
    // no timestamp trigger, so the SET is what stamps it.
    await insertRow(
      tx,
      appUsers,
      { id: user.id, locale },
      {
        onConflict: {
          target: appUsers.id,
          set: { locale, updatedAt: sql`now()` },
        },
      },
    );
  });
}
