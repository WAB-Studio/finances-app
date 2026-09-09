import { WordHistory } from "@/components/log/word-history";
import { Page } from "@/components/ui";

// Server-rendered shell alone, like `/registro`: the read is IndexedDB-only,
// so it belongs to the client component this mounts. No `useDictionary`
// here, so no Worker mounts on a screen that never looks a word up
// (RNL-08). `measure="full"`: this is a list and a back link, not prose.
export default async function PalabraHistorialPage(props: PageProps<"/registro/[palabra]">) {
  const { palabra } = await props.params;

  return (
    <Page measure="full">
      <WordHistory normalised={palabra} />
    </Page>
  );
}
