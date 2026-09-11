import Image from "next/image";

import styles from "./photo.module.css";

type PhotoSize = "compact" | "wide";

function sizeClassName(size: PhotoSize | undefined): string {
  return size === "wide" ? styles.wide : styles.compact;
}

// The one door onto `next/image`, so a photo pulled from Supabase Storage
// never reaches the page without `next.config.ts`'s own `remotePatterns`
// knowing that host. `src: null` draws the bare square with nothing inside
// it — `PalabraFotoCargandoOscuroMovil`, asked for and not yet back,
// deliberately silent: nobody is waiting on a 76px ornament, so it carries
// no spinner (docs/voyager/DESIGN.md "Settled"). `compact` is the word
// screen's own square, 76px below the reading column's ~660px breakpoint
// and 96px above it — the same square at two widths, not two squares.
export function Photo({
  src,
  alt,
  size,
}: {
  src: string | null;
  alt: string;
  size?: PhotoSize;
}) {
  return (
    <div className={sizeClassName(size)} aria-hidden={src === null ? true : undefined}>
      {src !== null && (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 660px) 96px, 76px"
          style={{ objectFit: "cover" }}
          // The route already hands back a sized WebP it fetched and stored
          // itself, so a second pass through the optimiser buys nothing. It
          // also cannot run: the optimiser refuses a local `src` carrying a
          // query string unless `images.localPatterns` names that exact
          // query, and the headword varies per word.
          unoptimized
        />
      )}
    </div>
  );
}
