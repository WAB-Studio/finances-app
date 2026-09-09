"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { z } from "zod";

import { sendSignInLink, signOut } from "@/app/actions/account";
import { countRecords, readSyncState, writeSyncState } from "@/lib/log/record";
import { syncNow } from "@/lib/sync/driver";
import type { SyncState } from "@/lib/log/types";
import { Button, Flex, Separator, Spinner, Text, TextField } from "@/components/ui";
import { DevicesPanel } from "./devices-panel";

const DEVICES_ENDPOINT = "/api/devices";

// Only the figure this screen needs before the reader says yes (RL-23): the
// full device list is `DevicesPanel`'s own fetch, made once the copy is on.
const pendingResponseSchema = z.object({ pending: z.number() });

async function fetchPending(cursor: string | null): Promise<number> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`${DEVICES_ENDPOINT}${query}`);
  if (!response.ok) throw new Error(`devices route answered ${response.status}`);
  return pendingResponseSchema.parse(await response.json()).pending;
}

type EmailFormState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; error: "emailInvalid" | "sendFailed" };

// State 1 (RNL-09): no reader yet, so nothing here ever reaches the network
// beyond the sign-in request the reader themself asks for.
function SignedOutForm() {
  const t = useTranslations("account");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<EmailFormState>({ kind: "idle" });

  async function handleSend(): Promise<void> {
    setState({ kind: "sending" });
    const result = await sendSignInLink(email);
    setState(result.ok ? { kind: "sent" } : { kind: "failed", error: result.error });
  }

  return (
    <Flex direction="column" gap="4">
      <Text size="2" muted>
        {t("signedOutLead")}
      </Text>

      {state.kind === "sent" ? (
        <Text size="2">{t("sent")}</Text>
      ) : (
        <Flex direction="column" gap="3">
          <TextField.Root
            type="email"
            size="3"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("emailLabel")}
            aria-label={t("emailLabel")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <Button size="2" tap onClick={() => void handleSend()} disabled={state.kind === "sending"}>
            {state.kind === "sending" ? t("sending") : t("send")}
          </Button>

          {state.kind === "failed" && (
            // No red in this palette (docs/voyager/DESIGN.md "Failure"): a
            // hairline sets the break off, full-weight ink says it.
            <Flex direction="column" gap="3" align="start">
              <Separator size="4" />
              <Text size="2" weight="bold">
                {t(`errors.${state.error}`)}
              </Text>
            </Flex>
          )}
        </Flex>
      )}
    </Flex>
  );
}

type CountsState =
  | { kind: "loading" }
  | { kind: "ready"; local: number; remote: number }
  | { kind: "failed" };

// State 2: signed in, the copy still off. RL-23's own request — the first
// and only one issued before the reader turns anything on.
function EnableSection({
  email,
  syncState,
  onEnable,
}: {
  email: string;
  syncState: SyncState;
  onEnable: () => Promise<void>;
}) {
  const t = useTranslations("account");
  const tDevices = useTranslations("account.devices");
  const [counts, setCounts] = useState<CountsState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [local, remote] = await Promise.all([
          countRecords(),
          fetchPending(syncState.pulledThroughCursor),
        ]);
        if (!cancelled) setCounts({ kind: "ready", local, remote });
      } catch {
        if (!cancelled) setCounts({ kind: "failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncState.pulledThroughCursor, attempt]);

  async function handleEnable(): Promise<void> {
    setEnabling(true);
    await onEnable();
  }

  return (
    <Flex direction="column" gap="4">
      <Text size="2">{t("signedInAs", { email })}</Text>

      {counts.kind === "loading" && <Spinner />}

      {counts.kind === "ready" && (
        <Button size="2" tap onClick={() => void handleEnable()} disabled={enabling}>
          {t("enableWithBothCounts", { local: counts.local, remote: counts.remote })}
        </Button>
      )}

      {counts.kind === "failed" && (
        <Flex direction="column" gap="3" align="start">
          <Separator size="4" />
          <Text size="2" weight="bold">
            {t("syncFailed")}
          </Text>
          <Button
            size="2"
            tap
            onClick={() => {
              setCounts({ kind: "loading" });
              setAttempt((current) => current + 1);
            }}
          >
            {tDevices("retry")}
          </Button>
        </Flex>
      )}
    </Flex>
  );
}

type SyncStatus = { kind: "idle" } | { kind: "syncing" } | { kind: "failed" };

// State 3: signed in, the copy on. `DevicesPanel` is the module 21 line the
// contract names — this file writes nothing else of it.
function SyncedSection({
  syncState,
  syncStatus,
  syncVersion,
  onSyncNow,
  onDisable,
}: {
  syncState: SyncState;
  syncStatus: SyncStatus;
  syncVersion: number;
  onSyncNow: () => void;
  onDisable: () => void;
}) {
  const t = useTranslations("account");
  const format = useFormatter();
  const syncing = syncStatus.kind === "syncing";

  return (
    <Flex direction="column" gap="4">
      <Text size="2" muted>
        {syncState.lastSyncedAt
          ? t("lastSynced", {
              date: format.dateTime(new Date(syncState.lastSyncedAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })
          : t("neverSynced")}
      </Text>

      <Flex gap="3">
        <Button size="2" tap onClick={onSyncNow} disabled={syncing}>
          {syncing ? t("syncing") : t("syncNow")}
        </Button>
        <Button size="2" tap variant="soft" color="gray" onClick={() => void onDisable()} disabled={syncing}>
          {t("disable")}
        </Button>
      </Flex>

      {syncStatus.kind === "failed" && (
        <Flex direction="column" gap="3" align="start">
          <Separator size="4" />
          <Text size="2" weight="bold">
            {t("syncFailed")}
          </Text>
        </Flex>
      )}

      <Separator size="4" />

      {/* A raw server action, not `execute()`: `signOut` throws Next's own
          redirect, and a `<form>` is the invocation the framework documents
          for that (node_modules/next/dist/docs's server-actions guide). */}
      <form action={signOut}>
        <Button size="2" tap type="submit" variant="soft" color="gray">
          {t("signOut")}
        </Button>
      </form>

      <Separator size="4" />

      <DevicesPanel refreshSignal={syncVersion} />
    </Flex>
  );
}

// States 2 and 3 both need the device's own `sync` row (IndexedDB, never the
// network) before they can draw anything, so this one component owns the
// read and the transitions between the two rather than splitting that race
// across two effects in two files.
function SignedInPanel({ email }: { email: string }) {
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: "idle" });
  // Bumped once `syncNow()` resolves, success or failure alike: the device
  // list's own refetch keys off this, never off a timer (module 35).
  const [syncVersion, setSyncVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    readSyncState().then((state) => {
      if (!cancelled) setSyncState(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runSync(): Promise<void> {
    setSyncStatus({ kind: "syncing" });
    const outcome = await syncNow();
    setSyncState(await readSyncState());
    setSyncStatus(outcome.kind === "failed" ? { kind: "failed" } : { kind: "idle" });
    setSyncVersion((current) => current + 1);
  }

  // Turning the copy on writes `enabled: true` and calls `syncNow()` in the
  // same gesture (RL-23, decision 9): the screen switches to state 3 the
  // moment the write lands, and `syncStatus` carries the sync already under
  // way there rather than blocking the switch on it finishing.
  async function handleEnable(): Promise<void> {
    await writeSyncState({ enabled: true });
    setSyncState(await readSyncState());
    await runSync();
  }

  async function handleDisable(): Promise<void> {
    await writeSyncState({ enabled: false });
    setSyncState(await readSyncState());
    setSyncStatus({ kind: "idle" });
  }

  // The IndexedDB read settles in a beat; nothing is drawn while it does,
  // same as the near-instant reads `record.ts` backs elsewhere.
  if (!syncState) return null;

  if (!syncState.enabled) {
    return <EnableSection email={email} syncState={syncState} onEnable={handleEnable} />;
  }

  return (
    <SyncedSection
      syncState={syncState}
      syncStatus={syncStatus}
      syncVersion={syncVersion}
      onSyncNow={() => void runSync()}
      onDisable={handleDisable}
    />
  );
}

/**
 * The account screen's three states (RL-22, RL-23): no reader, a reader with
 * the copy off, a reader with it on. `readerEmail` comes from the server
 * component above, which is the only place `getReader()` runs — this file
 * never opens a session of its own to learn it.
 */
export function AccountPanel({ readerEmail }: { readerEmail: string | null }) {
  if (!readerEmail) return <SignedOutForm />;
  return <SignedInPanel email={readerEmail} />;
}
