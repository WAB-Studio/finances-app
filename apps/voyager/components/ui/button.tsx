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

type BlockProp = {
  // Runs the button to the row's full width — `CuentaSinRed`'s retry is the
  // one place that asks for it, so it is a prop here rather than a style
  // reached from outside.
  block?: boolean;
};

function withTap(
  tap: boolean | TapSize | undefined,
  className: string | undefined,
): string | undefined {
  const floor = tap === 44 ? styles.tap44 : tap ? styles.tap : undefined;
  if (!floor) return className;
  return className ? `${floor} ${className}` : floor;
}

function withBlock(block: boolean | undefined, className: string | undefined): string | undefined {
  if (!block) return className;
  return className ? `${styles.block} ${className}` : styles.block;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps & TapProp & BlockProp>(
  function Button({ tap, block, className, ...props }, ref) {
    return <ThemesButton ref={ref} {...props} className={withBlock(block, withTap(tap, className))} />;
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps & TapProp>(
  function IconButton({ tap, className, ...props }, ref) {
    return <ThemesIconButton ref={ref} {...props} className={withTap(tap, className)} />;
  },
);
