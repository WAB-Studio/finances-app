"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";

import { sendSignInLink, signOut } from "@/app/actions/account";
import { readSyncState, writeSyncState } from "@/lib/log/record";
import { syncNow } from "@/lib/sync/driver";
import type { SyncState } from "@/lib/log/types";
import { Button, Flex, Separator, Text, TextField } from "@/components/ui";
import { DevicesPanel } from "./devices-panel";

// The key `bottom-nav.tsx:41-42` writes the box's query under. Not imported:
// that module belongs to the shell lane, so the spelling is pinned here by
// hand instead of exporting a constant from a file this one does not own.
const NAV_QUERY_STORAGE_KEY = "voyager:nav-query";

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

  // Half of RNL-09 this component has to hold by hand: `signOut` redirects
  // to `/registro`, so this never mounts on the way out of a session. It
  // only ever catches the other path onto this state — a device that was
  // signed in once, is not any more, and lands here directly (RL-30).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await readSyncState();
      if (!cancelled && current.enabled) await writeSyncState({ enabled: false });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

type SyncStatus = { kind: "idle" } | { kind: "syncing" } | { kind: "failed" };

// State 2: signed in, the copy on — the only state a session ever shows now
// (RL-30). `DevicesPanel` is the module 21 line the contract names — this
// file writes nothing else of it. No "Dejar de copiar" here: the user
// answered that no manual shutdown survives one (`docs/voyager/DESIGN.md`
// "Settled"), so the only doors out are `signOut` below and retiring this
// device from `DevicesPanel`.
function SyncedSection({
  email,
  syncState,
  syncStatus,
  syncVersion,
  onSyncNow,
}: {
  email: string;
  syncState: SyncState;
  syncStatus: SyncStatus;
  syncVersion: number;
  onSyncNow: () => void;
}) {
  const t = useTranslations("account");
  const format = useFormatter();
  const syncing = syncStatus.kind === "syncing";

  // Fires before the sign-out `<form>` submits: `signOut` redirects to
  // `/registro`, so this component never gets to unmount and run an effect
  // of its own first (RL-30, RNL-09). Same gesture drops the box's last
  // query (`bottom-nav.tsx:41-42`), which otherwise pre-fills `Buscar` for
  // whoever signs in next on this tab.
  function handleSignOutClick(): void {
    void writeSyncState({ enabled: false });
    try {
      window.sessionStorage.removeItem(NAV_QUERY_STORAGE_KEY);
    } catch {
      // Private browsing can refuse storage; nothing was there to leak.
    }
  }

  return (
    <Flex direction="column" gap="4">
      <Text size="2">{t("signedInAs", { email })}</Text>

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

      {/* The one manual trigger RNL-09 still allows: the copy also "fires
          … when the reader asks for it". Never the two-figure consent
          button RL-23 drew — that button is gone, not hidden. */}
      <Button size="2" tap onClick={onSyncNow} disabled={syncing}>
        {syncing ? t("syncing") : t("syncNow")}
      </Button>

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
        <Button size="2" tap type="submit" variant="soft" color="gray" onClick={handleSignOutClick}>
          {t("signOut")}
        </Button>
      </form>

      <Separator size="4" />

      <DevicesPanel refreshSignal={syncVersion} />
    </Flex>
  );
}

// The device's own `sync` row (IndexedDB, never the network) has to be read
// before anything draws, and — with a reader open — turned on by itself the
// moment it is not (RL-30): no button, no figures, no state 2 to click
// through. `EnableSection` and its pre-consent `/api/devices` request are
// gone, not hidden.
function SignedInPanel({ email }: { email: string }) {
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ kind: "idle" });
  // Bumped once `syncNow()` resolves, success or failure alike: the device
  // list's own refetch keys off this, never off a timer (module 35).
  const [syncVersion, setSyncVersion] = useState(0);

  async function runSync(): Promise<void> {
    setSyncStatus({ kind: "syncing" });
    const outcome = await syncNow();
    setSyncState(await readSyncState());
    setSyncStatus(outcome.kind === "failed" ? { kind: "failed" } : { kind: "idle" });
    setSyncVersion((current) => current + 1);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = await readSyncState();
      if (cancelled) return;
      if (current.enabled) {
        setSyncState(current);
        return;
      }
      // Turning the copy on and firing the first sync happen in the same
      // mount, with no act from the reader (RL-30): the two figures RL-23
      // used to ask permission with are never computed, let alone drawn.
      await writeSyncState({ enabled: true });
      if (cancelled) return;
      setSyncState(await readSyncState());
      await runSync();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The IndexedDB read settles in a beat; nothing is drawn while it does,
  // same as the near-instant reads `record.ts` backs elsewhere.
  if (!syncState) return null;

  return (
    <SyncedSection
      email={email}
      syncState={syncState}
      syncStatus={syncStatus}
      syncVersion={syncVersion}
      onSyncNow={() => void runSync()}
    />
  );
}

/**
 * The account screen's two states (RL-22, RL-30): no reader, or a reader
 * whose copy is already running. `readerEmail` comes from the server
 * component above, which is the only place `getReader()` runs — this file
 * never opens a session of its own to learn it.
 */
export function AccountPanel({ readerEmail }: { readerEmail: string | null }) {
  if (!readerEmail) return <SignedOutForm />;
  return <SignedInPanel email={readerEmail} />;
}
