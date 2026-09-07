import { Page } from "@/components/ui";
import { SearchScreen } from "@/components/search/search-screen";

// Server-rendered shell alone: the box, the worker and every promise it
// answers with belong to the client component this mounts.
export default function HomePage() {
  return (
    <Page>
      <SearchScreen />
    </Page>
  );
}
