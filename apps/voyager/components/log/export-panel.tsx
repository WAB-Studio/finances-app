"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { buildExport } from "@/lib/log/export";
import { countRecords } from "@/lib/log/record";
import { Button, Flex, Spinner, Text } from "@/components/ui";

type CountState = { kind: "loading" } | { kind: "ready"; count: number } | { kind: "failed" };
type ExportState = { kind: "idle" } | { kind: "building" } | { kind: "done" } | { kind: "failed" };

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

// `registro-lecturas-<YYYY-MM-DD>.json`, the file name the contract fixes.
function exportFileName(now: Date): string {
  return `registro-lecturas-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// Downloads a blob without a server round trip: an anchor with a `download`
// attribute and an object URL, never a `<form>` post (RNL-08 — nothing here
// leaves the device).
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ExportPanel() {
  const t = useTranslations("log");
  const [countState, setCountState] = useState<CountState>({ kind: "loading" });
  const [exportState, setExportState] = useState<ExportState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    countRecords()
      .then((count) => {
        if (!cancelled) setCountState({ kind: "ready", count });
      })
      .catch(() => {
        if (!cancelled) setCountState({ kind: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleExport(): Promise<void> {
    setExportState({ kind: "building" });
    try {
      const payload = await buildExport();
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      downloadBlob(blob, exportFileName(new Date()));
      setExportState({ kind: "done" });
    } catch {
      setExportState({ kind: "failed" });
    }
  }

  return (
    <Flex direction="column" gap="4">
      {countState.kind === "loading" && (
        <Flex align="center" gap="2">
          <Spinner />
          <Text size="2" muted>
            {t("counting")}
          </Text>
        </Flex>
      )}

      {countState.kind === "ready" && (
        <Text size="2" muted>
          {t("count", { count: countState.count })}
        </Text>
      )}

      {countState.kind === "failed" && (
        <Text size="2" muted>
          {t("countFailed")}
        </Text>
      )}

      <Button size="2" tap onClick={() => void handleExport()} disabled={exportState.kind === "building"}>
        {exportState.kind === "building" ? t("exporting") : t("export")}
      </Button>

      {exportState.kind === "done" && (
        <Text size="2" muted>
          {t("exported")}
        </Text>
      )}

      {exportState.kind === "failed" && (
        <Text size="2" muted>
          {t("exportFailed")}
        </Text>
      )}
    </Flex>
  );
}
