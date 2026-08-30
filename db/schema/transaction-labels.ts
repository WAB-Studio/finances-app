import { index, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";

import { labels } from "./labels";
import { transactions } from "./transactions";

// The join that attaches labels to a movement (RF-70); a movement's labels share its scope.
export const transactionLabels = pgTable(
  "transaction_labels",
  {
    transactionId: uuid()
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    labelId: uuid()
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.transactionId, table.labelId] }),
    index("transaction_labels_label_id_idx").on(table.labelId),
  ],
);

export type TransactionLabel = typeof transactionLabels.$inferSelect;
export type NewTransactionLabel = typeof transactionLabels.$inferInsert;
