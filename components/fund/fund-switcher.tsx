"use client";

import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { switchFundAction } from "@/app/actions/fund";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FundSummary } from "@/db/queries/funds";
import { usePathname } from "@/i18n/navigation";

// `/f/<id>/…`, locale already stripped by `usePathname`.
function activeFundId(pathname: string): string | undefined {
  const [, root, id] = pathname.split("/");
  return root === "f" ? id : undefined;
}

export function FundSwitcher({ funds }: { funds: FundSummary[] }) {
  const t = useTranslations("fund");
  // Root-scoped: the action's error is a full catalogue path.
  const tKey = useTranslations();
  type MessageKey = Parameters<typeof tKey>[0];
  const pathname = usePathname();
  const [picked, setPicked] = useState<string | null>(null);

  const { execute } = useAction(switchFundAction, {
    onError({ error }) {
      setPicked(null);
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

  const active = activeFundId(pathname);
  // The server owns the redirect, so the URL arriving is what ends the wait.
  const switching = picked !== null && picked !== active;

  if (funds.length === 0) {
    return (
      <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
        {tKey("common.appName")}
      </span>
    );
  }

  if (funds.length === 1) {
    return (
      <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
        {funds[0].name}
      </span>
    );
  }

  function onValueChange(fundId: string) {
    setPicked(fundId);
    execute({ fundId });
  }

  return (
    <Select
      value={picked ?? active ?? ""}
      onValueChange={onValueChange}
      disabled={switching}
    >
      <SelectTrigger
        aria-label={t("label")}
        className="min-w-0 flex-1 justify-between"
      >
        <SelectValue />
        {switching && <Loader2Icon className="size-4 shrink-0 animate-spin" aria-hidden />}
      </SelectTrigger>
      <SelectContent>
        {funds.map((fund) => (
          <SelectItem key={fund.id} value={fund.id}>
            {fund.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
