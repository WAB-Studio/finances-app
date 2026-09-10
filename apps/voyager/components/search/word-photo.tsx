"use client";

import { useTranslations } from "next-intl";

import type { WordPhoto as PhotoData } from "@/lib/word/protocol";
import { Photo } from "@/components/ui";

// The three shapes `useDecoration` (module 9) can hand this square. `photo`
// carries exactly what `photoResponseSchema` validates — no headword in it,
// which is why this component takes the headword as its own prop.
export type PhotoState =
  | { kind: "pending" }
  | { kind: "resolved"; photo: PhotoData }
  | { kind: "absent" };

// The square beside the headword. State in, DOM out: it never fetches —
// module 9 owns the request, the debounce and the cache this draws from.
// `docs/voyager/DESIGN.md` "Settled": `PalabraFotoOscuroMovil` /
// `PalabraFotoOscuroEscritorio` (resolved), `PalabraFotoCargandoOscuroMovil`
// (pending, silent on purpose) and `PalabraSinFotoOscuroMovil` (absent —
// the header reads as if a photo had never been possible, so this draws
// nothing at all rather than an empty frame).
export function WordPhoto({ headword, state }: { headword: string; state: PhotoState }) {
  const t = useTranslations("word");

  if (state.kind === "absent") {
    return null;
  }

  if (state.kind === "pending") {
    return <Photo src={null} alt="" size="compact" />;
  }

  return <Photo src={state.photo.url} alt={t("photoAlt", { headword })} size="compact" />;
}
