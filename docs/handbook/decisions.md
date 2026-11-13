# Decisions and distribution

Standing decisions with their premises (so they can be reopened for the right reason), the codec questions settled in game, where the server is listed, and the milestones that were declined.

## Public hostname: workers.dev, decided 2026-07-29

`https://gw1-mcp.graphmaxer.workers.dev` is the permanent origin. No custom
domain: Cloudflare charges nothing for one, but it means renting a domain name
yearly for a hobby project, and the free subdomain is unremarkable for an MCP
server.

Two consequences worth knowing, because they are not obvious:

- **Directory submissions pin the origin.** The MCP server URL cannot change
  between versions of a published connector — scheme, host and port are fixed
  once listed; only the path may change. Submitting with this URL is therefore a
  commitment, which is why it was decided before submitting rather than after.
- **Do NOT rename the Worker.** The workers.dev hostname is derived from the
  Worker's name, so renaming `gw1-mcp` would silently change the origin and break
  every listing that points at it. The name is now load-bearing.

Reopen only if a custom domain is actually acquired, and note that it would mean
re-submitting to every directory rather than editing a URL.

## Where this server is listed (updated 2026-08-14)

| Directory                    | Status                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official MCP Registry        | published                                | the source of truth other directories crawl; `publish-registry.yml` cascades on release                                                                                                                                                                                                                                                                                                                                       |
| mcp.so                       | **validated 2026-07-29**                 | https://mcp.so/servers/gw1-e2b8b9                                                                                                                                                                                                                                                                                                                                                                                             |
| Glama                        | indexed, unclaimed, healthy              | https://glama.ai/mcp/connectors/io.github.Graphmaxer/gw1-mcp — claiming needs an email at a public URL, declined, see debt #1. The single "quality A" grade is GONE: Glama now scores each TOOL with its TDQS rubric (2026-08-14: every tool A, 4.0-4.7/5). The ONLY directory that evaluates anything                                                                                                                        |
| LobeHub                      | listed, claimed, **stale**               | badge in README. Serving 0.8.2 and "Unvalidated" on 2026-08-14 — the only listing we control that shows wrong metadata                                                                                                                                                                                                                                                                                                        |
| PulseMCP                     | listed                                   | https://www.pulsemcp.com/servers/graphmaxer-gw1 — classification `community`, reads `server.json` directly. Their SEARCH did not surface it while submissions were paused mid-2026, so absence from a directory's search is not absence from the directory                                                                                                                                                                    |
| mcpmarket.com                | listed                                   | https://mcpmarket.com/server/gw1 — rate-limits fetches (429)                                                                                                                                                                                                                                                                                                                                                                  |
| Safeguard Gold               | listed, **stale at 0.3.2**               | https://gold.safeguard.sh/mcp/io.github.Graphmaxer__gw1-mcp — a security/supply-chain index. Pinned to our FIRST published version because the registry API returns versions oldest-first and their crawler takes `servers[0]`; all 15 are `status: active`. Nothing to fix our side, and their "the registry does not publish the license" note is structural — the 2025-12-11 server schema HAS no license field (verified) |
| PolicyLayer                  | listed (auto-generated)                  | https://policylayer.com/policies/gw1-mcp — an MCP-gateway vendor generating a policy page per registry entry as SEO. Reads 8 tools correctly; recommends a 60/min cap on `decode_pawned_team`, which is the same tool our own DoS work bounded, reached independently                                                                                                                                                         |
| Forge                        | `/.well-known/forge.json` served         | per-directory verification file                                                                                                                                                                                                                                                                                                                                                                                               |
| ChatGPT Plugins              | ready to submit                          | kit, generated JSON, identity verification and icons all done. Demo recorded and assembled 2026-08-05 (web + Android, one 2 min 51 file). Remaining: host the video at a login-free URL and press submit                                                                                                                                                                                                                      |
| Claude community marketplace | **submitted 2026-07-31, pending review** | validated locally (passed with the expected CLAUDE.md-at-root warning). On approval the plugin is pinned to a commit SHA in anthropics/claude-plugins-community, CI bumps the pin as commits land, and the public catalog syncs nightly, so installability lags approval                                                                                                                                                      |

Eight listings, ONE audience question. Six of the eight are crawlers of the
registry entry — they cost nothing and prove nothing, and every one of them ranks
by GitHub stars, of which there is 1. Reach is not gated on another directory; it
is gated on the two maintainer-held items (ChatGPT submission, Claude marketplace
review) and on telling actual GW1 players the thing exists. Do not read a new
crawler listing as progress.

Worth watching rather than assuming: the client-attribution dimension added the
same day means the `Connections per client` panel will show whether any of these
listings sends real clients or only health checks. Before it existed, 65% of all
traffic was one uptime monitor and the honest answer was "we cannot tell".

## Later milestones (context, not current work)

1. ~~MCP `resources`~~ — gw1://guide/build-workflow, gw1://meta and gw1://heroes
   are live. **Mission threat summaries: DECLINED 2026-07-29.** It is the non-goal,
   not an exception to it — a threat summary is an interpretation of a mission, so
   strategy content. And it is the one place the wiki copyleft would actually bite:
   skill descriptions are transcribed in-game strings, but threat summaries have no
   in-game equivalent and exist only as editors' own prose, which those licences
   unambiguously cover. Importing them would move the project from "arguable" to
   "clearly carrying copyleft obligations", voluntarily. Reopen only for an
   openly-licensed mission dataset — not by transcribing wiki articles.
2. `heroes_from_progression` tool — **DECLINED 2026-07-29.** Not a difficulty
   problem: the data does not exist. The 31 unlock notes are prose with no quest or
   mission identifiers and at least one branching condition (Master of Whispers is
   exclusive with Margrid); making them decidable means a quests/missions dataset,
   which is the guide-database non-goal; and the export plugin carries
   `unlockedAccountSkills` and no progression state, so the input would be the
   player's prose anyway — which is what an LLM already handles well from the notes.
   Reopen only if the plugin gains real quest/mission state, or an upstream dataset
   exposes unlock conditions structurally.
3. Cloudflare Workers deployment + custom connector on claude.ai; then Anthropic connectors directory submission.
4. ~~GWToolbox export plugin~~ — written in gwtoolbox-plugin/AccountExport; needs first Windows build, then consider upstreaming as a PR to GWToolbox's Completion window.

## Attribute order in template codes (learned from wild codes)

Real-world codes do NOT share a canonical attribute order: most tools emit
ascending ids, but e.g. the PvX Imbagon code stores [Leadership 40, Spear 37,
Command 38]. The game's decoder accepts any order. Our encoder canonicalizes
to ascending ids (deterministic output, matches the majority of wild codes);
consequence: string-exact round-trip is only guaranteed for ascending-order
codes, semantic round-trip always holds and is asserted for every fixture.

## Codec questions settled with in-game codes

1. Zero-attribute bars: which filler value the game writes in the unused
   attribute bit-length field.
2. Attribute width floor: with all attribute ids < 16 (e.g. any Mesmer
   FC/Dom/Insp bar), does the game emit the spec-minimal 4 bits or pad to 5
   like PvXCode and @buildwars/gw-templates do (shared authorship)? Our
   encoder emits the minimum; both forms decode identically everywhere.
   Corpus coverage (27 fixtures, incl. nine live in-game emissions): ALL 10 primary professions, 8 secondaries, skills from all 5 campaigns (Core, Prophecies,
   Factions, Nightfall, EotN), all 64 charset chars exercised ('+' and '/'
   included), both header formats, sorted and unsorted attribute orders, three
   independent third-party encoders (the game pre-2007, PvXCode, and
   @buildwars/gw-templates via gw1builds.com whose icon URLs expose skill IDS
   for id-level verification, plus a GWW player page whose Ranger codes are
   byte-identical to our encoding except one trailing zero-padding char).
   The fixture wishlist was FULLY SERVED on 2026-07-16 (nine live client
   emissions including the empty bar and all-low-attribute-id bars, four
   byte-exact) — every question it was written to arbitrate is settled; see
   the "in-game emission" fixture class and the codec.ts dialect note.

## Game rules: see docs/game-rules-provenance.md

Every validator rule, where it comes from, and how sure we are: **15 of 24 verified
against primary sources, 0 partial, 0 unverified, 9 that are not game rules.** Each
rule cites its source in `validate.ts`.

Two defects were found on 2026-07-31 by checking sources instead of reading code, and
both are recorded there: `PVE_ONLY_ON_PVP_BUILD` was missing (54 PvE-only skills carry
no profession, so they passed every other check, and `encode_template` would produce a
valid code for an illegal PvP bar), and the three-skill PvE cap wrongly excluded
Signet of Capture.

**Settled in game 2026-08-01, and both split-version rules were wrong.** A PvP-only
Mesmer's own template (`OQBDAowjCXoyJEhyEaIA`) stores Fragility as id 19 and Empathy as
26 — the PvE versions. The client normalises when writing, on a PvP character, under
Reforged. So `PVE_VERSION_ON_PVP_BUILD` rejected the normal case for all 156 split
skills and is deleted, and `PVP_VERSION_ON_PVE_BUILD` became a warning independent of
`forPvp`. That template is now a fixture. Primary evidence outranked a 2009 comment and
a second model that agreed with it.
