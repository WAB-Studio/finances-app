"use client";

import { forwardRef } from "react";
import {
  Button as ThemesButton,
  IconButton as ThemesIconButton,
  type ButtonProps,
  type IconButtonProps,
} from "@radix-ui/themes";

import styles from "./button.module.css";

// The one door onto Radix Themes' two buttons, so a screen that needs the floor
// asks for it here instead of drawing one.
type TapSize = 32 | 44;

type TapProp = {
  // Holds the control to 32px on both sides, which is what a ghost variant
  // otherwise falls under. Pass 44 for the one control RL-26 holds wider —
  // a thumb target beside a headword, not a control-height default.
  tap?: boolean | TapSize;
};

function withTap(
  tap: boolean | TapSize | undefined,
  className: string | undefined,
): string | undefined {
  const floor = tap === 44 ? styles.tap44 : tap ? styles.tap : undefined;
  if (!floor) return className;
  return className ? `${floor} ${className}` : floor;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps & TapProp>(
  function Button({ tap, className, ...props }, ref) {
    return <ThemesButton ref={ref} {...props} className={withTap(tap, className)} />;
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps & TapProp>(
  function IconButton({ tap, className, ...props }, ref) {
    return <ThemesIconButton ref={ref} {...props} className={withTap(tap, className)} />;
  },
);
