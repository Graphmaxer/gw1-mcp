import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Mirror wrangler's module rules (wrangler.jsonc "rules") so tests and the
// deployed bundle see identical imports: *.svg as a raw string, *.ico as an
// ArrayBuffer. Keep both in sync when adding asset types.
export default defineConfig({
  plugins: [
    {
      name: "wrangler-asset-rules",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".svg")) {
          return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
        }
        return null;
      },
    },
  ],
});
