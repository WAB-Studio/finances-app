"use client";

import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useTransition } from "react";
import { toast } from "sonner";

import { switchFundAction } from "@/app/actions/fund";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePathname } from "@/i18n/navigation";
import type { FundSummary } from "@/db/queries/funds";

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
  const [isPending, startTransition] = useTransition();

  const { execute, isExecuting } = useAction(switchFundAction, {
    onError({ error }) {
      toast.error(
        tKey((error.serverError ?? "errors.unexpected") as MessageKey),
      );
    },
  });

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
    startTransition(() => execute({ fundId }));
  }

  return (
    <Select
      value={activeFundId(pathname)}
      onValueChange={onValueChange}
      disabled={isPending || isExecuting}
    >
      <SelectTrigger
        aria-label={t("label")}
        className="min-w-0 flex-1 justify-between"
      >
        <SelectValue />
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
