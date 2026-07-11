#!/usr/bin/env node
import { argv, exit } from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error("gw1-mcp: stdio server ready");
}

const isDirectRun = argv[1] && import.meta.url === new URL(`file://${argv[1]}`).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  });
}
