// What a code means is a call-site decision: the same Postgres code
// (23505, a unique violation) can name a duplicate account today and a
// duplicate movement tomorrow, so no mapping table lives here.
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if (!("code" in error)) return undefined;

  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}
