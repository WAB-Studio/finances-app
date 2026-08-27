import type { CSSProperties, ReactNode } from "react";
import { Theme } from "@radix-ui/themes";

// The palette, fixed once for the whole app; no screen passes or overrides these.
export function AppTheme({ children }: { children?: ReactNode }) {
  return (
    <Theme
      accentColor="teal"
      grayColor="auto"
      radius="large"
      scaling="100%"
      style={
        {
          "--default-font-family": "var(--font-sans)",
          "--heading-font-family": "var(--font-sans)",
          "--code-font-family": "var(--font-geist-mono)",
        } as CSSProperties
      }
    >
      {children}
    </Theme>
  );
}
