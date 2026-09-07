"use client";

import { useTranslations } from "next-intl";

import type { TranslationResult } from "@/lib/translate/types";
import { Badge, Button, Flex, Progress, Spinner, Text } from "@/components/ui";

// What stage a sentence lookup is at. The composing module owns the debounce,
// the token floor and the request itself; this only draws the stage it lands
// in (RL-09).
export type PhraseState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "translating" }
  | { kind: "done"; result: TranslationResult }
  | { kind: "failed" };

// Whether the device's translator is worth mentioning, and how far its
// download has gotten when it is (RL-10, RL-11).
export type DeviceOffer =
  | { kind: "hidden" }
  | { kind: "offered" }
  | { kind: "downloading"; fraction: number | null };

export function PhraseAnswer({
  source,
  state,
  offer,
  onEnableDevice,
  onRetry,
}: {
  source: string;
  state: PhraseState;
  offer: DeviceOffer;
  onEnableDevice: () => void;
  onRetry: () => void;
}) {
  const t = useTranslations("phrase");

  // The typing has not settled and nothing was asked for: silence, not a
  // spinner, so the box never flickers while a person is mid-sentence.
  if (state.kind === "waiting") {
    return null;
  }

  return (
    <Flex direction="column" gap="4">
      {state.kind === "translating" && (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" color="gray">
            {t("translating")}
          </Text>
        </Flex>
      )}

      {state.kind === "done" && (
        <Flex direction="column" gap="1">
          <Text size="4">{state.result.text}</Text>
          <Text size="2" color="gray">
            {source}
          </Text>
          {state.result.origin === "device" ? (
            <Badge color="green" variant="soft">
              {t("originDevice")}
            </Badge>
          ) : (
            <Badge color="blue" variant="soft">
              {t("originNetwork")}
            </Badge>
          )}
        </Flex>
      )}

      {state.kind === "failed" && (
        <Flex direction="column" gap="2" align="start">
          <Text size="2" color="red">
            {t("failed")}
          </Text>
          <Button size="2" tap onClick={onRetry}>
            {t("retry")}
          </Button>
        </Flex>
      )}

      {offer.kind === "offered" && (
        <Flex direction="column" gap="1" align="start">
          <Button size="2" tap onClick={onEnableDevice}>
            {t("enableDevice")}
          </Button>
          <Text size="1" color="gray">
            {t("enableDeviceHint")}
          </Text>
        </Flex>
      )}

      {offer.kind === "downloading" && (
        <Flex direction="column" gap="1">
          <Text size="2" color="gray">
            {t("downloadingModel")}
          </Text>
          {offer.fraction === null ? (
            <Progress />
          ) : (
            <>
              <Progress value={Math.round(offer.fraction * 100)} />
              <Text size="1" color="gray">
                {t("downloadProgress", { percent: Math.round(offer.fraction * 100) })}
              </Text>
            </>
          )}
        </Flex>
      )}
    </Flex>
  );
}
