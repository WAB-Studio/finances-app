import { CategoryTile, Flex, Page, Skeleton } from "@/components/ui";

// Enough rows to reach the fold on a phone without drawing a page of grey.
const ROWS = [0, 1, 2, 3, 4, 5];

/**
 * The fallback for every screen under the signed-in shell. It draws the shape
 * they share — a title over a column of ledger rows — inside the same `Page`
 * gutter, so tapping a tab swaps only the body while the header and the tab bar
 * the layout renders stay put.
 */
export default function Loading() {
  return (
    <Page>
      <Flex direction="column" gap="4">
        <Skeleton width="9rem" height="var(--font-size-5)" />

        <Flex direction="column" gap="4">
          {ROWS.map((row) => (
            <Flex key={row} align="center" gap="3">
              {/* The tile a category without a colour already wears: the same
                  neutral the skeleton pulses between, so it reads as one shape. */}
              <CategoryTile color={null} />
              <Flex direction="column" gap="2" flexGrow="1" minWidth="0">
                <Skeleton width="60%" height="var(--font-size-3)" />
                <Skeleton width="35%" height="var(--font-size-2)" />
              </Flex>
              <Skeleton width="4.5rem" height="var(--font-size-3)" />
            </Flex>
          ))}
        </Flex>
      </Flex>
    </Page>
  );
}
