import type { Hono } from "hono";
import type { AppEnv } from "./env.js";

/**
 * The static side of the Worker: the discovery document, the favicon, the legal
 * pages and the well-known files. None of it touches MCP; it is what a browser,
 * a crawler or a directory validator fetches.
 */

// Single source of truth for cross-endpoint strings (repo URL appeared in
// three places, the trademark disclaimer in two).
const REPO_URL = "https://github.com/Graphmaxer/gw1-mcp";
const DISCLAIMER =
  "Unofficial fan-made tool. Guild Wars is a registered trademark of NCSoft Corporation; not affiliated with or endorsed by NCSoft or ArenaNet.";
// Security contact derives from the same place SECURITY.md points to:
// GitHub private vulnerability reporting. No email to duplicate or scrape.
const SECURITY_CONTACT = `${REPO_URL}/security/advisories/new`;
// RFC 9116 requires Expires, but a value recomputed per request made the
// response uncacheable and non-reproducible (every fetch returned a different
// file). A fixed date is the conformant form; a test in test/http.test.ts
// fails once it is under 30 days away, so CI asks for the bump instead of the
// file silently expiring.
const SECURITY_TXT_EXPIRES = "2027-07-01T00:00:00.000Z";

/**
 * @param faviconPng raw bytes of the 32x32 PNG favicon. The real entry point
 * (index.ts, the only file wrangler bundles) imports the PNG and passes it;
 * tests call createApp() with no argument, so the test path never imports a
 * binary asset — that is why no vitest asset config is needed.
 */
export function registerSiteRoutes(app: Hono<AppEnv>, faviconPng: ArrayBuffer | Uint8Array): void {
  app.get("/", (c) =>
    c.json({
      name: "gw1-mcp",
      description: "A Guild Wars 1 build compiler for LLMs",
      endpoint: "/mcp",
      transport: "streamable-http",
      repository: REPO_URL,
      disclaimer: DISCLAIMER,
    }),
  );

  // Favicon: 32x32 PNG (assets/brand/favicon-32.png, a 32px export of
  // icon-1024.png), passed in by index.ts. Served here and at /favicon.ico.
  const FAVICON_PNG = new Uint8Array(faviconPng);
  const serveFavicon = (c: { body: (b: BodyInit, init?: ResponseInit) => Response }) =>
    c.body(FAVICON_PNG as unknown as BodyInit, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
    });
  app.get("/favicon.ico", (c) => serveFavicon(c));
  app.get("/favicon.png", (c) => serveFavicon(c));
  app.get("/logo.png", (c) => serveFavicon(c));

  // Terms of use. The ChatGPT plugin form requires a Terms of Service URL, and
  // the submission kit previously pointed at the repository's MIT LICENSE. That
  // does not hold: MIT governs the CODE, not the use of a hosted service, and it
  // says nothing about the third-party game data this service redistributes. This
  // page is deliberately short and makes no promises the service cannot keep.
  app.get("/terms", (c) =>
    c.text(
      [
        "gw1-mcp terms of use",
        "",
        "What this is. A free, public, read-only tool that looks up Guild Wars 1",
        "skill and hero data and compiles or decodes in-game skill template codes.",
        "There are no accounts, no payments, and nothing is sold. Use of the",
        "service means accepting these terms.",
        "",
        "No warranty, no service level. The service is provided as is, without",
        "warranty of any kind. It may be slow, wrong, rate-limited, changed, or",
        "shut down at any time and without notice. It is a personal project run at",
        "no cost, not a product with an availability commitment. Do not build",
        "anything on it that you cannot afford to see stop working.",
        "",
        "Verify what you use in game. Template codes are produced by this",
        "service's own encoder and validated against the game's build rules, but",
        "game data is imported from third-party sources and can be out of date or",
        "wrong. Treat any output as a suggestion to check, not as an authority.",
        "",
        "Fair use. Automated access is expected — this is an MCP server. Requests",
        "are rate-limited per address. Do not attempt to circumvent that limit, to",
        "disrupt the service, or to use it to attack anything else.",
        "",
        "Code and data are governed separately. The source code is MIT licensed",
        `(${REPO_URL}). The game data is NOT: skill names,`,
        "descriptions and related text originate with the game and its community",
        "wikis, and the rights in that material belong to their respective",
        "holders. THIRD_PARTY_NOTICES.md in the repository records what is known",
        "about that provenance, including what remains unresolved. Nothing here",
        "grants you rights in that material.",
        "",
        DISCLAIMER,
        "",
        `Contact: ${SECURITY_CONTACT}`,
        `Source: ${REPO_URL}`,
      ].join("\n"),
      200,
      { "Cache-Control": "public, max-age=3600" },
    ),
  );

  app.get("/privacy", (c) =>
    c.text(
      [
        "gw1-mcp privacy policy",
        "",
        "This service is a stateless, read-only compiler for Guild Wars 1 build",
        "data. It has no accounts, no authentication, and it does not collect,",
        "store, or share any personal data. Requests are processed in memory and",
        "no request content is persisted by the application. Aggregate, anonymous",
        "usage counters are recorded for operational purposes. Described by",
        "category rather than enumerated, so this stays accurate: which tool ran,",
        "whether the call succeeded, this service's own error and validation",
        "codes, the canonical name of the game entity resolved from its own",
        "dataset, which optional flags the caller set, and the client software",
        "name a client reports about itself. Never free-text arguments, never IP",
        "addresses, and nothing the service itself derives from or about a",
        "person. One caveat stated plainly rather than hidden behind that: the",
        "client software name is supplied by the caller, so a client configured",
        "to announce itself with a personal string would have that string",
        "recorded (charset-restricted, truncated to 64 characters, no version).",
        "Nothing else in a request reaches the counters. The service runs on",
        "Cloudflare Workers; Cloudflare may process standard operational metadata",
        "(such as IP addresses in transient logs) per its own privacy policy.",
        "Per-IP rate limiting sends the connecting IP to Cloudflare's Rate",
        "Limiting binding as a lookup key. Cloudflare may cache and synchronize",
        "the resulting counters within its own infrastructure per its rate-limit",
        "product's operation — this is not purely a local in-memory count. The",
        "application itself does not persist request content or write IP",
        "addresses to its own analytics dataset.",
        "",
        "Retention: the aggregate, anonymous usage counters are written to",
        "Cloudflare Workers Analytics Engine, which retains them for 90 days and",
        "then discards them automatically. The counters record the categories",
        "above with a timestamp, carry no identifier or session, and the service",
        "is stateless, so two counters cannot be linked to one another. Nothing",
        "is asked for that identifies a person; the only value a caller could",
        "make identifying is the client name it chooses to announce, which is",
        "why it is named explicitly above. Analytics Engine has no per-row",
        "deletion, so a counter cannot be withdrawn before it expires; a client",
        "announcing a different name simply stops producing new ones.",
        "",
        "",
        DISCLAIMER,
        "",
        `Contact: open an issue at ${REPO_URL}`,
      ].join("\n"),
    ),
  );

  // OpenAI Apps domain-verification challenge: the token is revealed during
  // submission; set it as a Worker variable (dash or wrangler.jsonc "vars").
  app.get("/.well-known/openai-apps-challenge", (c) => {
    const token = c.env?.["OPENAI_APPS_CHALLENGE"];
    return token ? c.text(token) : c.notFound();
  });

  // NO /.well-known/glama.json here, and it must not come back. Glama's only
  // ownership verification is an email in that file matching the Glama account's
  // email — no DNS record, no opaque token like OpenAI's challenge. Publishing an
  // address at a predictable public URL is a more direct scraping target than git
  // metadata (no API, no .patch, just a GET), and the maintainer decided against
  // it on 2026-07-29 and deleted the Glama account. Nothing is lost: Glama
  // indexes and health-checks the server from the official MCP Registry anyway —
  // the listing was live and scoring A with the route already 404ing. Claiming
  // would only have added listing-copy control and usage reports that Cloudflare
  // and this project's own analytics already cover.

  // robots.txt. ClaudeBot and other web crawlers ask for it ~10x/day and were
  // getting 404s. Disallowing /mcp is the useful part: it is a JSON-RPC endpoint
  // that only answers POST, so a crawler fetching it gets a 405 and learns
  // nothing — telling it not to bother saves both sides the request. No sitemap
  // is served on purpose: four static routes do not need one, and pointing at a
  // sitemap that does not exist would be worse than omitting the line.
  app.get("/robots.txt", (c) =>
    c.text(["User-agent: *", "Allow: /", "Disallow: /mcp", ""].join("\n"), 200, {
      "Cache-Control": "public, max-age=86400",
    }),
  );

  // security.txt (RFC 9116): points researchers to the same GitHub private
  // vulnerability reporting SECURITY.md uses — Contact is a URL, not an email,
  // so nothing is duplicated or exposed to scrapers.
  app.get("/.well-known/security.txt", (c) => {
    // Canonical must match the URL the file is actually served from, so derive
    // it from the request instead of hardcoding the workers.dev host — the
    // hardcoded value silently became wrong the moment a custom domain existed.
    const canonical = `${new URL(c.req.url).origin}/.well-known/security.txt`;
    return c.text(
      [
        `Contact: ${SECURITY_CONTACT}`,
        `Expires: ${SECURITY_TXT_EXPIRES}`,
        `Policy: ${REPO_URL}/blob/main/SECURITY.md`,
        "Preferred-Languages: en, fr",
        `Canonical: ${canonical}`,
      ].join("\n"),
      200,
      { "Content-Type": "text/plain; charset=utf-8" },
    );
  });

  // Forge registry (forgeregistry.com) domain-verification claim, served the
  // same way as security.txt above — a well-known file only does its job if
  // it's actually fetchable at the real domain, not just sitting in git.
  // Static identity assertion only: no CI or publish-permission changes
  // involved, unlike the rest of that site's suggested "AI prompt" steps
  // (npm publish/OIDC), which this project doesn't use and won't add.
  app.get("/.well-known/forge.json", (c) =>
    c.json({ publisher: "Graphmaxer" }, 200, { "Content-Type": "application/json; charset=utf-8" }),
  );
}
