import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";

export const LAST_FUND_COOKIE = "last_fund";

const LAST_FUND_MAX_AGE = 60 * 60 * 24 * 365;

// A landing hint only: the caller still owes every read a membership check.
export async function readLastFundId(): Promise<string | null> {
  const cookieStore = await cookies();
  const { success, data } = z.uuid().safeParse(cookieStore.get(LAST_FUND_COOKIE)?.value);
  return success ? data : null;
}

// Callable only from a Server Action or a Route Handler: a Server Component cannot set cookies.
export async function writeLastFundId(fundId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LAST_FUND_COOKIE, fundId, {
    path: "/",
    maxAge: LAST_FUND_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
  });
}
