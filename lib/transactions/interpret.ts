import { normalizeAmountInput } from "@/lib/money";

// Quick entry reads one text field and proposes an editable movement (RF-22).
// Everything it returns is a proposal the form may overwrite; a field is null
// when nothing matched. It is pure: no DB, no async, no side effect.

// The first run of digits, optionally carrying the thousands separators a
// person types by hand; `normalizeAmountInput` strips those to a peso string.
const AMOUNT_PATTERN = /\d[\d.,]*\d|\d/;

interface InterpretContext {
  categories: { id: string; name: string; kind: string }[];
  accounts: { id: string; name: string }[];
  defaultAccountId: string | null;
}

interface QuickEntryProposal {
  amountPesos: string | null;
  categoryId: string | null;
  description: string;
  accountId: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function interpretQuickEntry(
  text: string,
  ctx: InterpretContext,
): QuickEntryProposal {
  const lower = text.toLowerCase();

  const amountMatch = AMOUNT_PATTERN.exec(text);
  const amountPesos = amountMatch
    ? normalizeAmountInput(amountMatch[0])
    : null;

  // The first category whose name reads as a substring of the text; the token
  // it matched drops out of the description below.
  const matchedCategory =
    ctx.categories.find((category) => {
      const name = category.name.trim().toLowerCase();
      return name.length > 0 && lower.includes(name);
    }) ?? null;

  // What is left once the amount and any matched category token are removed.
  let description = text;
  if (amountMatch) {
    description = description.replace(amountMatch[0], " ");
  }
  if (matchedCategory) {
    const pattern = new RegExp(escapeRegExp(matchedCategory.name.trim()), "i");
    description = description.replace(pattern, " ");
  }
  description = description.replace(/\s+/g, " ").trim();

  return {
    amountPesos,
    categoryId: matchedCategory?.id ?? null,
    description,
    // The default account is the last one that person used (RF-22).
    accountId: ctx.defaultAccountId,
  };
}
