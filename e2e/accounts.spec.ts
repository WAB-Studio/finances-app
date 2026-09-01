/**
 * One revived write path, end to end through the interface. This is the whole
 * reason the slice exists: on `main` this path raised
 * `42501 permission denied for table accounts`, and no check reached it — layer 1
 * drives `createAccount` in process, but only a browser drives the form, the
 * action and the policy together.
 */
import { expect } from "@playwright/test";

import messages from "@/messages/es.json";

import { fixtureSql } from "../scripts/harness/fixtures";
import { readScope, test } from "./global-setup";

const accounts = messages.accounts;

const scope = readScope();

test("creates an account from the form and stores its opening balance signed by its kind", async ({
  page,
}) => {
  // A liability, so the sign is a decision and not the identity: an opening debt
  // is stored negative, which is what keeps net worth a plain sum (RNF-05).
  const name = `Tarjeta ${Date.now()}`;
  const owedPesos = "250000";
  const owedCents = -25000000;

  await page.goto("/es/settings/accounts");
  await page.getByRole("button", { name: accounts.add, exact: true }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("textbox", { name: accounts.nameLabel }).fill(name);
  await dialog
    .getByRole("radio", { name: accounts.kindLiability, exact: true })
    .click();
  await dialog
    .getByRole("radio", { name: accounts.subtypeTarjeta, exact: true })
    .click();
  // The amount field renames itself with the kind, so this also proves the
  // toggle above landed.
  await dialog
    .getByRole("textbox", { name: accounts.openingOwedLabel })
    .fill(owedPesos);

  await dialog.getByRole("button", { name: messages.common.save }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  const rows = await fixtureSql<
    { id: string; kind: string; subtype: string; initial_balance_cents: string }[]
  >`
    select id, kind, subtype, initial_balance_cents::text as initial_balance_cents
    from accounts
    where owner_user_id = ${scope.userId} and name = ${name}`;

  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe("liability");
  expect(rows[0].subtype).toBe("tarjeta");
  expect(rows[0].initial_balance_cents).toBe(String(owedCents));

  // Written through the interface, so it carries no fixture id: dropped here
  // rather than by the tracked cleanup.
  await fixtureSql`delete from accounts where id = ${rows[0].id}`;
});
