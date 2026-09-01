/**
 * RF-100 on screen, under both roles. The database half is proved by layer 1
 * (assertions 184-189); nothing until now rendered the roster, and the row menu
 * is only reachable here — Radix mounts a menu's items when it opens and never
 * puts them on the wire.
 *
 * Rows are ordered by name, so a menu is named by its position rather than by
 * the DOM around it, and the edit dialog it opens carries the row's own name,
 * which is what says whose row the menu belonged to.
 */
import { expect, type Locator, type Page } from "@playwright/test";

import messages from "@/messages/es.json";

import {
  LEADER_MEMBER_NAME,
  MEMBER_STORAGE_STATE,
  PLAIN_MEMBER_NAME,
  clearGroup,
  seedGroup,
  test,
} from "./global-setup";

const members = messages.members;
const common = messages.common;

test.beforeAll(async () => {
  await seedGroup();
});

test.afterAll(async () => {
  await clearGroup();
});

function rowMenus(page: Page): Locator {
  return page.getByRole("button", { name: common.actions, exact: true });
}

async function expectRosterRendered(page: Page): Promise<void> {
  await expect(page.getByText(LEADER_MEMBER_NAME, { exact: true })).toBeVisible();
  await expect(page.getByText(PLAIN_MEMBER_NAME, { exact: true })).toBeVisible();
}

// Whose row an open menu belonged to: the name its rename arrives prefilled with.
async function expectRenameSubject(page: Page, name: string): Promise<void> {
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: common.edit, exact: true })
    .click();

  await expect(
    page.getByRole("dialog").getByRole("textbox", { name: members.nameLabel }),
  ).toHaveValue(name);
}

test.describe("the members roster under its leader", () => {
  test("offers the add control and a menu over another member's row", async ({
    page,
  }) => {
    await page.goto("/es/settings/members");
    await expectRosterRendered(page);

    await expect(
      page.getByRole("button", { name: members.add, exact: true }),
    ).toBeVisible();

    await expect(rowMenus(page)).toHaveCount(2);

    // The second row by name is the plain member's, which is not the leader's own.
    await rowMenus(page).nth(1).click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
      common.edit,
      common.archive,
      common.delete,
    ]);

    await expectRenameSubject(page, PLAIN_MEMBER_NAME);
  });
});

test.describe("the members roster under a plain member", () => {
  test.use({ storageState: MEMBER_STORAGE_STATE });

  test("renders the roster and offers no add control", async ({ page }) => {
    await page.goto("/es/settings/members");
    await expectRosterRendered(page);

    await expect(
      page.getByRole("button", { name: members.add, exact: true }),
    ).toHaveCount(0);
  });

  test("offers one menu, over their own row, and it renames and nothing else", async ({
    page,
  }) => {
    await page.goto("/es/settings/members");
    await expectRosterRendered(page);

    // Two rows, one menu: the other member's row carries none.
    await expect(rowMenus(page)).toHaveCount(1);

    await rowMenus(page).click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText([
      common.edit,
    ]);

    await expectRenameSubject(page, PLAIN_MEMBER_NAME);
  });
});
