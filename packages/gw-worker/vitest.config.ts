import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Mirror wrangler's module rule (wrangler.jsonc "rules") so tests and the
// deployed bundle resolve *.png imports identically: as an ArrayBuffer.
// enforce:"pre" — otherwise vite serves its own asset URL instead.
export default defineConfig({
  plugins: [
    {
      name: "wrangler-png-rule",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".png")) {
          const bytes = [...readFileSync(id)];
          return `export default new Uint8Array([${bytes}]).buffer;`;
        }
        return null;
      },
    },
  ],
});
