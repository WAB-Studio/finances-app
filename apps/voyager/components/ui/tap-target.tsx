import type { ReactNode } from "react";
import { Flex, type FlexProps } from "@radix-ui/themes";

// A link's content has no intrinsic control height, unlike a Radix control
// sized "2"; this pins a floor onto whatever sits inside a link. 32px by
// default; pass 44 for the bottom nav's own item, which DESIGN.md holds to
// a wider floor than an inline link.
export function TapTarget({
  align,
  justify,
  direction,
  gap,
  px,
  width,
  size = 32,
  children,
}: Pick<FlexProps, "align" | "justify" | "direction" | "gap" | "px" | "width"> & {
  size?: 32 | 44;
  children?: ReactNode;
}) {
  const floor = `${size}px`;
  return (
    <Flex
      as="span"
      align={align}
      justify={justify}
      direction={direction}
      gap={gap}
      px={px}
      width={width}
      minWidth={floor}
      minHeight={floor}
    >
      {children}
    </Flex>
  );
}
