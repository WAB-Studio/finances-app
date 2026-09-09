"use client";

import { useId, useState, type ReactNode } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";

import { Text } from "./text";
import { TapTarget } from "./tap-target";
import styles from "./collapsible.module.css";

// A chevron drawn to the app's own stroke (1.75px, round caps and joins,
// the convention `sense-list.tsx`'s `SpeakerGlyph` already sets), rotated
// in place rather than swapped for a second path: `>` closed, `v` open.
function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg
      className={open ? styles.chevronOpen : styles.chevron}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// docs/voyager/DESIGN.md "The English definition folds away behind a tap":
// a row ruled with a hairline above and below, closed by default, that
// unfolds its own content below the second hairline. A real `<button>` with
// `aria-expanded` and `aria-controls`, never a `div` with an `onClick` — the
// keyboard reaches it and a screen reader hears its state for free.
export function Collapsible({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <Flex direction="column">
      <Separator size="4" />
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <TapTarget size={44} align="center" justify="between" width="100%">
          <Text size="1" muted>
            {label}
          </Text>
          <ChevronGlyph open={open} />
        </TapTarget>
      </button>
      <Separator size="4" />
      {open && (
        <Box id={contentId} pt="2" pb="1">
          {children}
        </Box>
      )}
    </Flex>
  );
}
