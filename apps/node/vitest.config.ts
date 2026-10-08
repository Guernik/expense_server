import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { yamlAsText } from "../../vitest.shared.ts";

/**
 * Runs this app's tests plus the API scenario suite (ingest, classifier, dedupe, Telegram flows,
 * digest) against the Node store: a SQLite file migrated by the same code the runtime starts with.
 */
export default defineConfig({
  root: fileURLToPath(new URL("../..", import.meta.url)),
  plugins: [yamlAsText],
  resolve: {
    alias: {
      "@denarii/db/testing": fileURLToPath(new URL("src/testing.ts", import.meta.url)),
    },
  },
  test: {
    include: ["apps/node/src/**/*.test.ts", "packages/api/src/**/*.test.ts"],
  },
});
