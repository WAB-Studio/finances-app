import { WordHistory } from "@/components/log/word-history";
import { Page } from "@/components/ui";

// A dynamic segment arrives percent-encoded, not decoded (measured against
// this Next version's own production build): a multi-word or accented
// `normalised` never matches its own IndexedDB row until this runs. A
// hand-typed URL can still carry a malformed escape (`100%`), which
// `decodeURIComponent` throws on — reading the raw segment as the word
// itself is the only sense to make of what the person typed.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// Server-rendered shell alone, like `/registro`: the read is IndexedDB-only,
// so it belongs to the client component this mounts. No `useDictionary`
// here, so no Worker mounts on a screen that never looks a word up
// (RNL-08). `measure="full"`: this is a list and a back link, not prose.
export default async function PalabraHistorialPage(props: PageProps<"/registro/[palabra]">) {
  const { palabra } = await props.params;

  return (
    <Page measure="full">
      <WordHistory normalised={decodeSegment(palabra)} />
    </Page>
  );
}
