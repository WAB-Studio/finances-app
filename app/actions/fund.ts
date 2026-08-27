"use server";

import { getLocale } from "next-intl/server";

import { createFund } from "@/db/queries/create-fund";
import { getFundForUser } from "@/db/queries/funds";
import { redirect } from "@/i18n/navigation";
import { writeLastFundId } from "@/lib/fund/last-fund";
import { ActionError } from "@/lib/errors";
import { authActionClient } from "@/lib/safe-action";
import { createFundSchema, switchFundSchema } from "@/lib/validation/fund";

/**
 * Creates a fund and its owner (RF-25). The locale comes from the request,
 * never from the form: it decides the language the starter categories seed in.
 */
export const createFundAction = authActionClient
  .inputSchema(createFundSchema)
  .action(async ({ parsedInput }) => {
    const locale = await getLocale();
    const { fundId } = await createFund({ ...parsedInput, locale });

    await writeLastFundId(fundId);
    redirect({ href: `/f/${fundId}`, locale });
  });

/**
 * Switches the active fund. The cookie is a landing hint only — the read here
 * re-checks membership, and the row-level policies check it again.
 */
export const switchFundAction = authActionClient
  .inputSchema(switchFundSchema)
  .action(async ({ parsedInput: { fundId } }) => {
    const fund = await getFundForUser(fundId);
    if (!fund) throw new ActionError("errors.fundNotFound");

    await writeLastFundId(fundId);
    redirect({ href: `/f/${fundId}`, locale: await getLocale() });
  });
