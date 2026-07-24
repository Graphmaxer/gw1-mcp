// No shebang on purpose. This file is not directly executable: the project
// deliberately ships sources with .js specifiers and never builds to dist, so
// `node stdio.ts` fails with ERR_MODULE_NOT_FOUND and only `tsx` resolves it.
// A `#!/usr/bin/env node` line promised an entry point that never worked.
// Run it with `pnpm --filter @gw1-mcp/gw-mcp dev` (or `npx tsx <path>`).
// Publishing a real `bin` would need a build step and a public package — see
// the distribution note in CLAUDE.md.
import { argv, exit } from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("gw1-mcp: stdio server ready");
}

const isDirectRun = argv[1] && import.meta.url === pathToFileURL(argv[1]).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  });
}
