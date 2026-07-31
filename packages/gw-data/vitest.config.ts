import codspeedPlugin from "@codspeed/vitest-plugin";
import { defineConfig } from "vitest/config";

// The plugin is inert outside a CodSpeed run (it only rewires the benchmark
// loop when CODSPEED_ENV is set), so `vitest run` keeps behaving exactly as it
// did config-free.
export default defineConfig({
  plugins: [codspeedPlugin()],
});
