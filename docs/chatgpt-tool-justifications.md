# Tool annotation justifications (OpenAI plugin form)

Twenty-four fields: eight tools times `readOnlyHint`, `openWorldHint`,
`destructiveHint`. Written for a reviewer who does not have the code open, so each one
states the **mechanism** rather than repeating the claim.

## The three facts they all rest on

Verified in the source, not asserted:

1. **The dataset is bundled at build time.** `repository.ts` imports `campaigns.json`,
   `professions.json`, `attributes.json`, `skill-types.json`, `skills.json` and
   `heroes.json` as static modules. There is no runtime fetch anywhere in the tool
   packages — `grep -rn "fetch(" packages/gw-mcp/src packages/gw-data/src
packages/gw-template/src` returns nothing.
2. **Nothing is written.** No file writes, no key-value store, no database, no account,
   no session. The server is stateless; the only `.set()` in the tool code is a local
   `Map` inside the validator.
3. **The one write that does exist is telemetry, not domain state.** The Worker records
   an anonymous counter per call to Cloudflare Analytics Engine — a tool name, an
   outcome, and entities resolved from our own data, never caller input. It is disclosed
   at `/privacy`. Mention this proactively: a reviewer inspecting the bindings will see
   `MCP_ANALYTICS`, and it is better explained than discovered.

---

## get_skill

**Read Only: True** — Looks up one skill by exact English name or by template id in a
JSON dataset compiled into the bundle, and returns its stats and description. It has no
write path of any kind: no file system, no store, no account. Calling it a thousand times
leaves the service byte-identical.

**Open World: False** — The domain is closed and finite: the 1485 skills of Guild Wars 1
as shipped in this build. No network request is made at runtime, no external API is
consulted, and a name the dataset does not contain returns a `NOT_FOUND` code with
spelling suggestions rather than reaching outside for an answer.

**Destructive: False** — Follows from read-only: there is nothing to destroy. The tool
returns a record; it never modifies, deletes or supersedes anything, in this service or
in the player's game.

## search_skills

**Read Only: True** — Filters the same bundled dataset by profession, attribute,
campaign, elite flag and name substring, and returns compact records. Pure computation
over immutable in-memory data with no write path.

**Open World: False** — Searches only the bundled dataset. Filters that do not match a
known value are rejected by name (`UNKNOWN_PROFESSION`, `UNKNOWN_CAMPAIGN`) instead of
being forwarded anywhere, so the set of reachable results is fixed at build time.

**Destructive: False** — A filtered read. No state exists for it to affect.

## decode_template

**Read Only: True** — Decodes a Guild Wars 1 skill template code — a base64-ish
bit-packed string the game itself produces — into professions, attribute ranks and eight
skills. Pure bit manipulation on the argument plus lookups in the bundled dataset.
Nothing is stored, and the input string is not retained.

**Open World: False** — The codec is fully implemented in this repository
(`packages/gw-template`) and resolves ids against the bundled dataset. No decoding
service, no external lookup. A malformed code produces a structured error such as
`TRUNCATED` or `INVALID_HEADER`.

**Destructive: False** — Decoding is one-way and read-only. The caller's code string is
unchanged and nothing in the game is touched: the tool cannot reach a game client or an
account.

## decode_pawned_team

**Read Only: True** — Parses a paw-ned² team blob, the format players share for whole
hero teams, and decodes each slot's bar. Same purely computational path as
`decode_template`, applied per slot. No writes.

**Open World: False** — The container format and the codec are both implemented here.
Input size and slot count are bounded in-process (16 KiB, 12 slots) rather than delegated
anywhere, so the work stays inside this service.

**Destructive: False** — Read-only parsing. The blob is not modified, stored or
forwarded.

## encode_template

**Read Only: True** — This is the one that most deserves the detail. It _produces_ a
template code, which is a returned string, not a side effect. Nothing is written and
nothing is installed: the code appears in the response for the user to copy into their
own game client. The tool has no ability to reach a game, an account or a file. The user
remains the only party who can act on the result.

**Open World: False** — The skill ids and attribute ids come from the bundled dataset,
and the encoder is local. No registry is contacted to mint a code, and no code is
published anywhere.

**Destructive: False** — Producing a string destroys nothing. Notably, the tool refuses
to emit a code that the game would reject or silently alter — for example a bar with two
elite skills, which the client loads while dropping one — so its failure mode is to
return an error rather than to hand back something that would degrade the user's setup.

## validate_build

**Read Only: True** — Checks a proposed skill bar against the game's rules and returns
errors and warnings. Pure evaluation of the argument against bundled data; it neither
stores the build nor changes anything.

**Open World: False** — Every rule is implemented in this repository and every rule cites
its source in the code, verified against the official Guild Wars wiki and, for several,
against the game client's own behaviour. No external validator is called.

**Destructive: False** — It returns a verdict. Nothing is altered, and a failing verdict
blocks nothing the user could otherwise do — it only informs.

## get_hero

**Read Only: True** — Returns one hero's profession, campaign and unlock notes from the
bundled hero dataset. No writes; no account state is read or touched, since the service
has none.

**Open World: False** — The hero roster is finite and bundled: 31 heroes as shipped in
this build. No external source is consulted.

**Destructive: False** — A single-record read.

## list_heroes

**Read Only: True** — Lists heroes, optionally filtered by profession or campaign, from
the same bundled dataset. Read-only computation.

**Open World: False** — Enumerates only the bundled roster. Unknown filter values are
rejected by name rather than forwarded.

**Destructive: False** — An enumeration. No state to affect.

---

## If the form asks for one overall statement

> All eight tools are pure, read-only computations over a Guild Wars 1 dataset compiled
> into the deployment at build time. The service is stateless: no accounts, no sessions,
> no stored user data, and no runtime network calls from any tool — the dataset is a
> static import and the template codec is implemented in this repository. Nothing any
> tool returns can act on the user's game; `encode_template` produces a string the user
> copies themselves, and it refuses to emit codes the game would reject or silently
> alter. The only write in the system is an anonymous per-call counter to Cloudflare
> Analytics Engine (tool name, outcome, and entity names resolved from our own data —
> never caller arguments), disclosed at /privacy.
