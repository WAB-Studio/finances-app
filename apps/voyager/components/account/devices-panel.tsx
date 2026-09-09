"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { z } from "zod";

import { readSyncState, writeSyncState } from "@/lib/log/record";
import { Button, Flex, Grid, Heading, MetaLabel, Separator, Spinner, Text } from "@/components/ui";

// A client-side reparse of `lib/sync/devices.ts`'s `DeviceRow`, not an import
// of it: that module opens `import "server-only"`, so a type from it would
// have to be erased perfectly to ship in this bundle. Redeclaring it here
// keeps that boundary a build error can never quietly cross.
const deviceRowSchema = z.object({
  deviceId: z.uuid(),
  label: z.string(),
  lastSeenAt: z.string(),
  lookups: z.number(),
});
const deviceListSchema = z.array(deviceRowSchema);
type DeviceRow = z.infer<typeof deviceRowSchema>;
// Module 15 widens the route to `{ devices, pending }` so the account
// screen's enable button can read the second figure RL-23 asks for; `pending`
// is that call's own concern, dropped here on arrival.
const devicesGetResponseSchema = z.object({ devices: deviceListSchema, pending: z.number() });

const DEVICES_ENDPOINT = "/api/devices";

type PanelState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "empty" }
  | { kind: "ready"; rows: DeviceRow[] };

// One device's own row is either doing nothing, asking the reader to say the
// two halves back, mid-retire, or stuck — never the panel's own state, so
// one row's failure never hides the other's list.
type RowStatus =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "retiring" }
  | { kind: "failed" };

function DeviceRowItem({
  row,
  isThisDevice,
  status,
  onRetireClick,
  onCancel,
  onConfirm,
  onRetry,
}: {
  row: DeviceRow;
  isThisDevice: boolean;
  status: RowStatus;
  onRetireClick: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("account.devices");
  const format = useFormatter();
  const seenDate = new Date(row.lastSeenAt);
  const seenValid = !Number.isNaN(seenDate.getTime());

  return (
    <Flex direction="column" gap="2">
      {/* `1fr auto`: the label's own width is fixed, so the track beside it is
          what has to clamp (docs/voyager/DESIGN.md "What the data forces"). */}
      <Grid columns="1fr auto" gap="3" align="center">
        <Text weight="medium" truncate>
          {row.label}
        </Text>
        {isThisDevice && <MetaLabel>{t("thisDevice")}</MetaLabel>}
      </Grid>

      <Text size="2" muted>
        {seenValid
          ? // A `now` passed explicitly: the provider sets none globally, and
            // without one `relativeTime` warns on every render (next-intl's
            // `ENVIRONMENT_FALLBACK`) even though the fallback is this same value.
            t("lastSeen", { date: format.relativeTime(seenDate, new Date()) })
          : t("neverSeen")}
      </Text>
      <Text size="2" muted>
        {t("lookups", { count: row.lookups })}
      </Text>

      {status.kind === "idle" && (
        <Flex>
          <Button size="2" tap onClick={onRetireClick}>
            {t("retire")}
          </Button>
        </Flex>
      )}

      {status.kind === "confirming" && (
        <Flex direction="column" gap="2" align="start">
          <Text size="2">{t("confirmBody")}</Text>
          {isThisDevice && <Text size="2">{t("confirmBodyOwn")}</Text>}
          <Flex gap="2">
            <Button size="2" tap variant="soft" color="gray" onClick={onCancel}>
              {t("cancel")}
            </Button>
            <Button size="2" tap onClick={onConfirm}>
              {t("confirm")}
            </Button>
          </Flex>
        </Flex>
      )}

      {status.kind === "retiring" && (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" muted>
            {t("retiring")}
          </Text>
        </Flex>
      )}

      {status.kind === "failed" && (
        // No red in this palette (docs/voyager/DESIGN.md "Failure"): a hairline
        // sets the break off, full-weight ink says it, the accent lives in retry.
        <Flex direction="column" gap="3" align="start">
          <Separator size="4" />
          <Text size="2" weight="bold">
            {t("retireFailed")}
          </Text>
          <Button size="2" tap onClick={onRetry}>
            {t("retry")}
          </Button>
        </Flex>
      )}
    </Flex>
  );
}

/**
 * The devices the reader's account has copied to (RL-25). Fetches
 * `/api/devices` on mount, never before — this panel only draws inside the
 * account screen, which only mounts with a session. `title` is drawn here,
 * not by the caller: `account-panel.tsx` (module 15) mounts this alongside
 * other sections that carry their own headings too.
 */
export function DevicesPanel() {
  const t = useTranslations("account.devices");
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  // Bumped by the panel-level retry, since the fetch runs in an effect and a
  // click cannot call it directly.
  const [attempt, setAttempt] = useState(0);
  // `null` means the local `sync` store has not answered yet: no row reads
  // as "this device" until it has, rather than guessing.
  const [localDeviceId, setLocalDeviceId] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [response, syncState] = await Promise.all([fetch(DEVICES_ENDPOINT), readSyncState()]);
        if (!response.ok) throw new Error(`devices route answered ${response.status}`);
        const { devices: rows } = devicesGetResponseSchema.parse(await response.json());
        if (cancelled) return;
        setLocalDeviceId(syncState.deviceId);
        setState(rows.length === 0 ? { kind: "empty" } : { kind: "ready", rows });
      } catch {
        if (!cancelled) setState({ kind: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function updateRowStatus(deviceId: string, status: RowStatus): void {
    setRowStatus((current) => ({ ...current, [deviceId]: status }));
  }

  function removeRow(deviceId: string): void {
    setState((current) => {
      if (current.kind !== "ready") return current;
      const rows = current.rows.filter((row) => row.deviceId !== deviceId);
      return rows.length === 0 ? { kind: "empty" } : { kind: "ready", rows };
    });
    setRowStatus((current) => {
      const next = { ...current };
      delete next[deviceId];
      return next;
    });
  }

  // Retiring the device in hand turns its own copy off and rewinds its push
  // cursor to 0 in the same call: without that reset, turning the copy back
  // on would push nothing and the screen would claim a copy that is not
  // there (RL-24).
  async function retire(deviceId: string): Promise<void> {
    updateRowStatus(deviceId, { kind: "retiring" });
    try {
      const response = await fetch(DEVICES_ENDPOINT, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      if (!response.ok) throw new Error(`devices route answered ${response.status}`);
      if (deviceId === localDeviceId) {
        await writeSyncState({ enabled: false, pushedThroughLocalId: 0 });
      }
      removeRow(deviceId);
    } catch {
      updateRowStatus(deviceId, { kind: "failed" });
    }
  }

  if (state.kind === "loading") {
    return (
      <Flex direction="column" gap="4">
        <Heading size="5">{t("title")}</Heading>
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" muted>
            {t("loading")}
          </Text>
        </Flex>
      </Flex>
    );
  }

  if (state.kind === "failed") {
    return (
      <Flex direction="column" gap="4">
        <Heading size="5">{t("title")}</Heading>
        <Flex direction="column" gap="3" align="start">
          <Separator size="4" />
          <Text size="2" weight="bold">
            {t("retireFailed")}
          </Text>
          <Button
            size="2"
            tap
            onClick={() => {
              setState({ kind: "loading" });
              setAttempt((current) => current + 1);
            }}
          >
            {t("retry")}
          </Button>
        </Flex>
      </Flex>
    );
  }

  if (state.kind === "empty") {
    return (
      <Flex direction="column" gap="4">
        <Heading size="5">{t("title")}</Heading>
        <Text size="2" muted>
          {t("empty")}
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="4">
      <Heading size="5">{t("title")}</Heading>
      <Flex direction="column" gap="4">
        {state.rows.map((row, index) => (
          <Flex direction="column" gap="4" key={row.deviceId}>
            {index > 0 && <Separator size="4" />}
            <DeviceRowItem
              row={row}
              isThisDevice={row.deviceId === localDeviceId}
              status={rowStatus[row.deviceId] ?? { kind: "idle" }}
              onRetireClick={() => updateRowStatus(row.deviceId, { kind: "confirming" })}
              onCancel={() => updateRowStatus(row.deviceId, { kind: "idle" })}
              onConfirm={() => void retire(row.deviceId)}
              onRetry={() => void retire(row.deviceId)}
            />
          </Flex>
        ))}
      </Flex>
    </Flex>
  );
}
