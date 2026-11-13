/**
 * Smoke test of the Worker under REAL workerd.
 *
 * What: starts `wrangler dev --local` on a free port, sends a short script of
 * HTTP requests to it and asserts on status codes, headers and tool results.
 *
 * Why: the unit suite calls `createApp().request()` under Node, and three times
 * the difference has mattered — `tools/list` measured 17 ms under Node against
 * 7.66 ms in production, a `text/plain` body answered 400 where workerd answers
 * 415, and `server.close()` empties a response only because the body is lazy
 * here. Each was found by hand with `wrangler dev --local`. This is that manual
 * pass, kept: the bundle wrangler really builds, on the runtime that really
 * serves it, checked on every pull request.
 *
 * How to run: `pnpm --filter @gw1-mcp/gw-worker smoke` (bare node, no build).
 *
 * Failure modes: exits 1 listing every failed check; exits 1 with wrangler's own
 * output if the worker is not answering within 90 s. Stays well under the
 * 100 requests/min rate limit, which IS emulated locally — a longer script would
 * start collecting 429s that look like bugs.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

type Rpc = { result?: Record<string, unknown>; error?: { code: number; message: string } };

/** A port nothing is listening on, chosen by the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });
}

/** The JSON-RPC message of a reply, whether it came back as JSON or as one SSE event. */
function parseRpc(body: string): Rpc {
  const data = body
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice("data: ".length);
  return JSON.parse(data ?? body) as Rpc;
}

/** The parsed JSON payload a tool returned as its first text block. */
function toolPayload(rpc: Rpc): Record<string, unknown> {
  const content = rpc.result?.["content"] as { text: string }[] | undefined;
  return JSON.parse(content?.[0]?.text ?? "{}") as Record<string, unknown>;
}

async function main(): Promise<void> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let output = "";
  // Its own process group, so wrangler AND the workerd it spawns die together.
  const wrangler = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--port",
      String(port),
      "--show-interactive-dev-session=false",
    ],
    { cwd: WORKER_DIR, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  wrangler.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  wrangler.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const stop = () => {
    if (wrangler.pid !== undefined) {
      try {
        process.kill(-wrangler.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  };

  const failures: string[] = [];
  let checks = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    checks++;
    if (!ok) failures.push(detail ? `${label} — ${detail}` : label);
  };
  const post = (body: string, headers: Record<string, string> = JSON_HEADERS, path = "/mcp") =>
    fetch(base + path, { method: "POST", headers, body });
  let id = 0;
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await post(
      JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    );
    return { response, rpc: parseRpc(await response.text()) };
  };

  try {
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (wrangler.exitCode !== null) throw new Error(`wrangler exited early:\n${output}`);
      if (Date.now() > deadline) throw new Error(`worker not answering after 90 s:\n${output}`);
      const up = await fetch(base + "/").then(
        (r) => r.ok,
        () => false,
      );
      if (up) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Plain routes.
    for (const [path, status] of [
      ["/privacy", 200],
      ["/favicon.ico", 200],
      ["/.well-known/glama.json", 404],
    ] as const) {
      const response = await fetch(base + path);
      check(`GET ${path} answers ${status}`, response.status === status, `got ${response.status}`);
    }
    check("GET /mcp answers 405 (stateless server)", (await fetch(base + "/mcp")).status === 405);

    // The MCP handshake and the tool surface.
    const init = await post(
      JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "workerd-smoke", version: "0" },
        },
      }),
    );
    const initRpc = parseRpc(await init.text());
    check("initialize answers 200", init.status === 200, `got ${init.status}`);
    check("initialize names the server", initRpc.result?.["serverInfo"] !== undefined);
    // Hardening survives the lazy streamed body.
    check(
      "no-store on an /mcp answer",
      init.headers.get("cache-control")?.includes("no-store") === true,
    );
    check("nosniff on an /mcp answer", init.headers.get("x-content-type-options") === "nosniff");
    check("open CORS on an /mcp answer", init.headers.get("access-control-allow-origin") === "*");

    const list = parseRpc(
      await (await post(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/list" }))).text(),
    );
    const tools = (list.result?.["tools"] ?? []) as { name: string; outputSchema?: unknown }[];
    check("tools/list returns the 8 tools", tools.length === 8, `got ${tools.length}`);
    check(
      "every tool declares an outputSchema",
      tools.every((tool) => tool.outputSchema !== undefined),
    );

    // The compiler, end to end: French lookup, encode, decode back.
    const skill = toolPayload((await call("get_skill", { name: "Sceau de guérison" })).rpc);
    check(
      "get_skill resolves a French name",
      skill["name"] === "Healing Signet",
      String(skill["name"]),
    );
    const encoded = toolPayload(
      (
        await call("encode_template", {
          primary: "Dervish",
          secondary: "Monk",
          attributes: [
            { attribute: "Mysticism", rank: 12 },
            { attribute: "Scythe Mastery", rank: 12 },
          ],
          skills: [
            "Avatar of Balthazar",
            "Mystic Sweep",
            "Eremite's Attack",
            null,
            null,
            null,
            null,
            null,
          ],
        })
      ).rpc,
    );
    check(
      "encode_template produces a code",
      typeof encoded["code"] === "string",
      JSON.stringify(encoded),
    );
    const decoded = toolPayload((await call("decode_template", { code: encoded["code"] })).rpc);
    const names = ((decoded["skills"] ?? []) as ({ name: string } | null)[]).map((s) => s?.name);
    check(
      "decode_template returns the same bar",
      names[1] === "Mystic Sweep",
      JSON.stringify(names),
    );

    // Refusals, as real workerd answers them.
    const typo = await call("get_hero", { name: "Master of Wispers" });
    const typoError = toolPayload(typo.rpc)["error"] as { suggestions?: string[] } | undefined;
    check("a hero typo is an isError result", typo.rpc.result?.["isError"] === true);
    check("...with the right name suggested", typoError?.suggestions?.[0] === "Master of Whispers");
    const unknownArg = await call("search_skills", { profession: "Monk" });
    check("an undeclared tool argument is refused", unknownArg.rpc.result?.["isError"] === true);
    const flood = await call("decode_pawned_team", { pwnd: ">".repeat(8192) });
    check("a hostile pwnd blob is refused, not hung on", flood.rpc.result?.["isError"] === true);

    const batch = await post(JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]));
    check("a JSON-RPC batch answers 400", batch.status === 400, `got ${batch.status}`);
    const plain = await post("[not json", { "content-type": "text/plain" });
    check("a text/plain body answers 415", plain.status === 415, `got ${plain.status}`);
    for (const path of ["/mcp", "/mcp/"]) {
      const big = await post(JSON.stringify({ pad: "x".repeat(600 * 1024) }), JSON_HEADERS, path);
      check(`a 600 KiB body on ${path} answers 413`, big.status === 413, `got ${big.status}`);
    }
  } finally {
    stop();
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} of ${checks} workerd checks failed:\n- ${failures.join("\n- ")}`,
    );
  }
  console.log(`workerd smoke: ${checks} checks passed`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
