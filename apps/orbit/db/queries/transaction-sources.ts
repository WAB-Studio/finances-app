import "server-only";

import { eq } from "drizzle-orm";

import { insertRow } from "@/db/insert-row";
import { transactionSources } from "@/db/schema";
import type { TransactionSource } from "@/db/schema";
import { withUserDb } from "@/db/session";
import { pgErrorCode } from "@/lib/db-error";

export type RecordTransactionSourceArgs = {
  transactionId: string;
  accountId: string;
  statementId: string | null;
  sourceRef: string | null;
  sourceSeq: number | null;
};

/**
 * Names one leg's bank reference, so a later import recognises the movement it
 * already recorded (RF-134). ONE round trip, through `insertRow`. Null when the
 * policy denied the write — `can_write_account` failed — read from the driver's
 * own refusal (`42501`) rather than thrown, the same convention `recordAccountStatement`
 * reads a denial under.
 */
export async function recordTransactionSource(
  args: RecordTransactionSourceArgs,
): Promise<{ id: string } | null> {
  try {
    return await withUserDb(async (tx) => {
      const [row] = await insertRow(
        tx,
        transactionSources,
        {
          transactionId: args.transactionId,
          accountId: args.accountId,
          statementId: args.statementId,
          sourceRef: args.sourceRef,
          sourceSeq: args.sourceSeq,
        },
        { returning: { id: transactionSources.id } },
      );

      return { id: row.id };
    });
  } catch (error) {
    if (pgErrorCode(error) === "42501") return null;
    throw error;
  }
}

/**
 * Every source row a movement carries, one per account leg. ONE round trip.
 */
export async function listSourcesForTransaction(
  transactionId: string,
): Promise<TransactionSource[]> {
  return withUserDb((tx) =>
    tx
      .select()
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, transactionId)),
  );
}
