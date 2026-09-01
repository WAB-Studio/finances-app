/**
 * One pass over the six settings screens, none of which any check had opened.
 * The HTTP layer already proves each route answers 200; what it cannot prove is
 * that the data reached the screen — the whole next-intl catalogue ships in the
 * page payload, so a title matches even when nothing rendered. Every assertion
 * here is therefore a seeded value or an interpolated message carrying one.
 */
import { createHash, randomUUID } from "node:crypto";

import { expect } from "@playwright/test";

import messages from "@/messages/es.json";

import { fixtureSql } from "../scripts/harness/fixtures";
import { asHarnessUser, readScope, test } from "./global-setup";

const scope = readScope();
const stamp = randomUUID().slice(0, 8);

// The `other` branch of an ICU plural with `#` filled, which is what a count
// renders as on screen once it leaves the catalogue.
function atCount(message: string, count: number): string {
  const branch = /other \{([^}]*)\}/.exec(message)?.[1] ?? message;
  return branch.replace("#", String(count));
}

test("the categories screen renders the categories it read", async ({ page }) => {
  await page.goto("/es/settings/categories");

  await expect(page.getByText(scope.categoryName, { exact: true })).toBeVisible();
  // The count comes from the row's own children, so it only reads at all once
  // the category behind it loaded.
  await expect(
    page.getByText(atCount(messages.categories.subcategoryCount, 0), {
      exact: true,
    }),
  ).toBeVisible();
});

test("the labels screen renders a label with its usage counts", async ({
  page,
}) => {
  const labelId = randomUUID();
  const name = `Etiqueta ajustes ${stamp}`;

  await asHarnessUser(async (tx) => {
    await tx`
      insert into labels (id, owner_user_id, name, color)
      values (${labelId}, ${scope.userId}, ${name}, '#4C8C4A')`;
  });

  await page.goto("/es/settings/labels");

  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(
    page.getByText(atCount(messages.labels.usageCount, 0), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(atCount(messages.labels.budgetCount, 0), { exact: true }),
  ).toBeVisible();

  await fixtureSql`delete from labels where id = ${labelId}`;
});

test("the audit screen lists the record a write just left", async ({ page }) => {
  const categoryId = randomUUID();

  // The trail answers only to its triggers (RF-44), so a write is the only way
  // to put a row on this screen; the id it stamps is what the table shows.
  await asHarnessUser(async (tx) => {
    await tx`
      insert into categories (id, owner_user_id, name, kind, color)
      values (${categoryId}, ${scope.userId}, ${`Auditoría ${stamp}`}, 'expense', '#4C8C4A')`;
  });

  await page.goto("/es/settings/audit");

  // Newest first, so the row this test wrote is on the first page.
  await expect(page.getByRole("cell", { name: categoryId })).toBeVisible();

  await fixtureSql`delete from categories where id = ${categoryId}`;
});

test("the data screen carries every exportable entity into its download link", async ({
  page,
}) => {
  await page.goto("/es/settings/data");

  // The entity list is a server constant: the href is where it lands, and an
  // empty one would silently export everything instead. `URLSearchParams` writes
  // the separators percent-encoded, which is what the route reads back.
  const link = page.getByRole("link", {
    name: messages.data.screen.download,
    exact: true,
  });
  await expect(link).toHaveAttribute(
    "href",
    "/es/settings/data/export?entities=accounts%2Cmembers%2Ccategories%2CrecurringRules%2Ctransactions",
  );
});

test("the webhooks screen renders a credential with its own rate limit", async ({
  page,
}) => {
  const credentialId = randomUUID();
  const name = `Credencial ajustes ${stamp}`;
  const rateLimit = 37;

  await asHarnessUser(async (tx) => {
    await tx`
      insert into webhook_credentials (
        id, owner_user_id, name, token_hash, rate_limit_per_min)
      values (
        ${credentialId}, ${scope.userId}, ${name},
        ${createHash("sha256").update(credentialId).digest("hex")}, ${rateLimit})`;
  });

  await page.goto("/es/settings/webhooks");

  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(
    page.getByText(atCount(messages.webhooks.rateLimit, rateLimit), {
      exact: true,
    }),
  ).toBeVisible();

  await fixtureSql`delete from webhook_credentials where id = ${credentialId}`;
});

test.describe("the members screen", () => {
  const groupId = randomUUID();
  const leaderId = randomUUID();
  const memberId = randomUUID();
  const leaderName = "Harness leader";
  const memberName = `Miembro ajustes ${stamp}`;

  // A personal-only caller has no roster to read, so this screen needs a fund.
  // The hooks own it on both ends: a group left behind would move every other
  // screen's scope from personal to group.
  test.beforeEach(async () => {
    await asHarnessUser(async (tx) => {
      await tx`
        insert into groups (id, name, cash_mode)
        values (${groupId}, ${`Fondo ajustes ${stamp}`}, 'per_member')`;
      await tx`
        insert into group_members (id, group_id, user_id, name, role)
        values (${leaderId}, ${groupId}, ${scope.userId}, ${leaderName}, 'leader')`;
      await tx`
        insert into group_members (id, group_id, name, role)
        values (${memberId}, ${groupId}, ${memberName}, 'member')`;
    });
  });

  test.afterEach(async () => {
    await fixtureSql`delete from groups where id = ${groupId}`;
    await fixtureSql`delete from group_members where group_id = ${groupId}`;
  });

  test("renders the roster of the caller's fund", async ({ page }) => {
    await page.goto("/es/settings/members");

    await expect(page.getByText(memberName, { exact: true })).toBeVisible();
    await expect(page.getByText(leaderName, { exact: true })).toBeVisible();
    // The invited member has claimed no login yet, which the row says out loud.
    await expect(
      page.getByText(messages.members.noLoginBadge, { exact: true }),
    ).toBeVisible();
  });
});
