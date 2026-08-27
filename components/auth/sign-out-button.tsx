"use client";

import { LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";

import { signOutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const t = useTranslations("auth");
  const { execute, isPending } = useAction(signOutAction);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      // Icon only on a narrow header; the label returns once there is room.
      className="sm:w-auto sm:gap-1.5 sm:px-2.5"
      aria-label={t("signOut")}
      disabled={isPending}
      onClick={() => execute()}
    >
      <LogOutIcon className="size-4" />
      <span className="hidden sm:inline">{t("signOut")}</span>
    </Button>
  );
}
