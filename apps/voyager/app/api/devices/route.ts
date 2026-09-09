import { z } from "zod";

import { getReader, withReaderDb } from "@/lib/session";
import { countPending, listDevices, retireDevice } from "@/lib/sync/devices";

const retireDeviceRequestSchema = z.object({
  deviceId: z.uuid(),
});

// The `receivedAt` half of the opaque `pulledThroughCursor` the account
// screen sends (`lib/log/types.ts`, `<receivedAt>|<deviceId>|<localId>`,
// minted by `app/api/log/sync/route.ts`'s own `encodeCursor`). `countPending`
// compares against the clock alone, so the tiebreakers travel for nothing —
// a cursor this route cannot parse is treated as none, the same fallback the
// sync route's own `decodeCursor` takes.
function receivedAtFromCursor(raw: string | null): string | null {
  if (!raw) return null;
  const [receivedAt] = raw.split("|");
  return receivedAt || null;
}

// `getReader` reads straight off verified claims: no session, no round trip
// at all, Postgres included. Both handlers check it before opening
// `withReaderDb`, so an unauthenticated caller never touches the database.
export async function GET(request: Request): Promise<Response> {
  const reader = await getReader();
  if (!reader) return Response.json({ error: "unauthorized" }, { status: 401 });

  const receivedAt = receivedAtFromCursor(new URL(request.url).searchParams.get("cursor"));

  // ONE transaction, two round trips: the list and the pending count never
  // depend on each other, so they fan out with `Promise.all` rather than
  // chain (`AGENTS.md`).
  const [devices, pending] = await withReaderDb((tx) =>
    Promise.all([listDevices(tx, reader.id), countPending(tx, reader.id, receivedAt)]),
  );
  return Response.json({ devices, pending }, { status: 200 });
}

// `revalidatePath` is never called here: `/cuenta` is a client component and
// redraws its list off this response, which already carries the new count.
export async function DELETE(request: Request): Promise<Response> {
  const reader = await getReader();
  if (!reader) return Response.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const parsed = retireDeviceRequestSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });

  const result = await withReaderDb((tx) => retireDevice(tx, reader.id, parsed.data.deviceId));
  return Response.json(result, { status: 200 });
}
