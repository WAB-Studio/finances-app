import { z } from "zod";

import { accounts } from "@/db/schema/accounts";
import { categories } from "@/db/schema/categories";
import { groupMembers } from "@/db/schema/group-members";
import { recurringRules } from "@/db/schema/recurring-rules";
import { transactions } from "@/db/schema/transactions";
import { centsToPesos, pesosToCents } from "@/lib/money";
import { createAccountSchema } from "@/lib/validation/account";
import { createCategorySchema } from "@/lib/validation/category";
import { createMemberSchema } from "@/lib/validation/member";
import { createRecurringRuleSchema } from "@/lib/validation/recurring-rule";
import { createTransactionSchema } from "@/lib/validation/transaction";

// The five entities export (RF-50) writes and import (RF-51/52) reads, in one
// declared shape so both sides agree on the columns, their order and the rule
// each cell obeys. No database access lives here: this is types and schemas.
export const SHEET_ENTITIES = [
  "accounts",
  "members",
  "categories",
  "recurringRules",
  "transactions",
] as const;

export type SheetEntity = (typeof SHEET_ENTITIES)[number];

// The model carries integer cents (RNF-05); the sheet shows a decimal COP
// value. The float exists only at this presentation boundary — `toSheet` on the
// way out, `fromSheet` on the way back in — never in the model or its types.
type MoneyBoundary = {
  readonly toSheet: (cents: number) => number;
  readonly fromSheet: (pesos: number) => number;
};

const moneyBoundary: MoneyBoundary = {
  toSheet: centsToPesos,
  fromSheet: pesosToCents,
};

// One flat column of a sheet. `key` is the English header, the next-intl key a
// later UI module translates, and the field name on a parsed row; `field` is
// the `$inferSelect` column the export reads and the import writes back.
type SheetColumn<Model> = {
  readonly key: string;
  readonly field: keyof Model & string;
  readonly money?: MoneyBoundary;
};

// A row's stable reference (`refField`) names the column an import matches on to
// update instead of duplicate (RF-52). `rowSchema` validates one parsed sheet
// row with the same rules the form and server use (RNF-10).
type SheetDescriptor<Model, Schema extends z.ZodType> = {
  readonly entity: SheetEntity;
  readonly refField: string;
  readonly columns: readonly SheetColumn<Model>[];
  readonly rowSchema: Schema;
};

// Model row types come straight from the migrations (RNF-11), never hand-copied.
type AccountModel = typeof accounts.$inferSelect;
type MemberModel = typeof groupMembers.$inferSelect;
type CategoryModel = typeof categories.$inferSelect;
type RecurringRuleModel = typeof recurringRules.$inferSelect;
type TransactionModel = typeof transactions.$inferSelect;

// The four non-transaction entities carry no `external_ref` column today, so
// their reference for this PR is the row's own `id` (RF-52 idempotency still
// holds: an existing id updates in place). A future import PR may repoint them
// to a dedicated key without touching the export side.
const idRef = { id: z.uuid() };

export const accountRowSchema = createAccountSchema.extend(idRef);
export type AccountRow = z.infer<typeof accountRowSchema>;

export const memberRowSchema = createMemberSchema.extend(idRef);
export type MemberRow = z.infer<typeof memberRowSchema>;

export const categoryRowSchema = createCategorySchema.extend(idRef);
export type CategoryRow = z.infer<typeof categoryRowSchema>;

export const recurringRuleRowSchema = createRecurringRuleSchema.extend(idRef);
export type RecurringRuleRow = z.infer<typeof recurringRuleRowSchema>;

// A transaction already owns `external_ref`, the reference importing was built
// around from day one, so its row schema is the create schema unchanged.
export const transactionRowSchema = createTransactionSchema;
export type TransactionRow = z.infer<typeof transactionRowSchema>;

// `placement` has no single column of its own: the export derives personal vs
// group from whether `ownerUserId` is set, and the import resolves the owner or
// group back from it.
export const accountSheetDescriptor = {
  entity: "accounts",
  refField: "id",
  columns: [
    { key: "id", field: "id" },
    { key: "name", field: "name" },
    { key: "kind", field: "kind" },
    { key: "subtype", field: "subtype" },
    { key: "placement", field: "ownerUserId" },
    { key: "institution", field: "institution" },
    { key: "amount", field: "initialBalanceCents", money: moneyBoundary },
    { key: "balanceOn", field: "initialBalanceOn" },
  ],
  rowSchema: accountRowSchema,
} satisfies SheetDescriptor<AccountModel, typeof accountRowSchema>;

export const memberSheetDescriptor = {
  entity: "members",
  refField: "id",
  columns: [
    { key: "id", field: "id" },
    { key: "name", field: "name" },
    { key: "email", field: "inviteEmail" },
  ],
  rowSchema: memberRowSchema,
} satisfies SheetDescriptor<MemberModel, typeof memberRowSchema>;

export const categorySheetDescriptor = {
  entity: "categories",
  refField: "id",
  columns: [
    { key: "id", field: "id" },
    { key: "name", field: "name" },
    { key: "kind", field: "kind" },
    { key: "parentId", field: "parentId" },
    { key: "color", field: "color" },
  ],
  rowSchema: categoryRowSchema,
} satisfies SheetDescriptor<CategoryModel, typeof categoryRowSchema>;

export const recurringRuleSheetDescriptor = {
  entity: "recurringRules",
  refField: "id",
  columns: [
    { key: "id", field: "id" },
    { key: "fromAccountId", field: "fromAccountId" },
    { key: "toAccountId", field: "toAccountId" },
    { key: "amount", field: "amountCents", money: moneyBoundary },
    { key: "categoryId", field: "categoryId" },
    { key: "description", field: "description" },
    { key: "frequency", field: "frequency" },
    { key: "intervalN", field: "intervalN" },
    { key: "dayOfMonth", field: "dayOfMonth" },
    { key: "nextRunOn", field: "nextRunOn" },
    { key: "endsOn", field: "endsOn" },
  ],
  rowSchema: recurringRuleRowSchema,
} satisfies SheetDescriptor<RecurringRuleModel, typeof recurringRuleRowSchema>;

// Splits and labels are nested, not flat cells: a later import module bridges
// them, so they stay in `rowSchema` without a column here.
export const transactionSheetDescriptor = {
  entity: "transactions",
  refField: "externalRef",
  columns: [
    { key: "externalRef", field: "externalRef" },
    { key: "fromAccountId", field: "fromAccountId" },
    { key: "toAccountId", field: "toAccountId" },
    { key: "amount", field: "amountCents", money: moneyBoundary },
    { key: "occurredAt", field: "occurredAt" },
    { key: "description", field: "description" },
  ],
  rowSchema: transactionRowSchema,
} satisfies SheetDescriptor<TransactionModel, typeof transactionRowSchema>;

// The one map both sides iterate, in the fixed entity order.
export const sheetDescriptors = {
  accounts: accountSheetDescriptor,
  members: memberSheetDescriptor,
  categories: categorySheetDescriptor,
  recurringRules: recurringRuleSheetDescriptor,
  transactions: transactionSheetDescriptor,
} as const;
