"use client";

import { useTranslations } from "next-intl";

import type { InstallFailure, InstallProgress } from "@/lib/dictionary/install";
import { Button, Flex, Progress, Spinner, Text } from "@/components/ui";

// Structural, not imported: the worker's own status type only has to satisfy
// this shape, so this file never depends on the module that produces it
// (RL-12).
export type InstallStatusValue = {
  state: "booting" | "installing" | "ready" | "failed";
  progress?: InstallProgress;
  reason?: InstallFailure;
};

// Sits beside the search box, never in its place: `null` when there is
// nothing to say, and no branch here ever disables an input or steals focus
// (RL-12, RL-13).
export function InstallStatus({
  status,
  onRetry,
}: {
  status: InstallStatusValue;
  onRetry: () => void;
}) {
  const t = useTranslations("install");

  if (status.state === "ready") {
    return null;
  }

  if (status.state === "booting") {
    return (
      <Flex align="center" gap="2">
        <Spinner />
        <Text size="2" color="gray">
          {t("preparing")}
        </Text>
      </Flex>
    );
  }

  if (status.state === "installing") {
    // A `content-length`-less response means an indeterminate bar: RL-12
    // only promises that progress is shown, not a number that does not exist.
    if (!status.progress || status.progress.total === null) {
      return (
        <Flex direction="column" gap="1">
          <Progress />
          <Text size="2" color="gray">
            {t("unknownSize")}
          </Text>
        </Flex>
      );
    }

    const { received, total } = status.progress;
    const percent = Math.round((received / total) * 100);
    return (
      <Flex direction="column" gap="1">
        <Progress value={percent} />
        <Text size="2" color="gray">
          {t("progress", { percent })}
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2" align="start">
      <Text size="2" color="red">
        {t("failed")}
      </Text>
      <Button size="2" tap onClick={onRetry}>
        {t("retry")}
      </Button>
    </Flex>
  );
}
