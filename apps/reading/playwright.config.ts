import { defineConfig, devices } from "@playwright/test";

// No `webServer` block, no `globalSetup`, no `storageState`, no harness lane:
// this app has no identity and no seeded row. A dev server is started and
// kept running by hand, against `next build && next start` — module 22's own
// counting assertions need the single effect run production gives and dev
// does not (docs/TRAPS.md "StrictMode doubles a Worker count").
const baseURL = process.env.READING_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  // Gitignored, so a run leaves the tree clean.
  outputDir: "./private/playwright-results",
  workers: 1,
  // A retry would hide a flake behind a green run, which is what this layer
  // exists to find.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
  },
  projects: [
    // RNL-03's base case: a phone, held one-handed, standing.
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 740 },
        hasTouch: true,
      },
    },
  ],
});
