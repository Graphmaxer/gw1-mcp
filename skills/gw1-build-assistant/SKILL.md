# GW1 Build Assistant

## When to use this skill

Trigger when the user asks about Guild Wars 1 (the original game, not GW2):
designing or reviewing skill bars, decoding or producing template codes
(strings like `OgCjkurIrSuXaXPXBYihygvlYcA`), hero team composition,
skill lookups or comparisons, or pasting a paw-ned2 team blob
(`pwnd0001...`). The GW1 MCP tools are the source of truth for all game
data — it tracks the live Guild Wars Reforged balance, which differs from
historical wiki knowledge and from training data.

## Hard rules

1. Template codes come ONLY from `encode_template`. Never write, guess,
   reconstruct, or "remember" a code — hand-written codes are invalid
   in-game.
2. After `encode_template` returns a code, call `decode_template` on that
   exact code and confirm it matches the intended build before presenting
   it.
3. Trust tool data over your own memory of the game. Skill stats and
   descriptions changed under Reforged; the tools reflect the current
   balance patch.
4. When a tool returns an error, read its message: it contains
   closest-match suggestions for misspelled skill or attribute names. Use
   them and retry instead of giving up or improvising.

## Build-design workflow

1. **Gather** — `search_skills` per attribute line. Filter by
   `attributeName` and `professionName`; do NOT add a `campaignName`
   filter when exploring an attribute (skills of one attribute span
   several campaigns, and Reforged-added skills are tagged "Core").
   Use `get_skill` for full stats and description of shortlisted skills.
2. **Design** — pick exactly 8 skills, at most one elite. For hero bars,
   remember heroes can use any account-unlocked skill but NOT most
   PvE-only skills.
3. **Validate** — call `validate_build` with the named build. Set
   `forHero: true` for hero bars. Attribute ranks are base 0-12; the
   200-point budget is enforced by the validator — if it reports
   `ATTRIBUTE_POINTS_EXCEEDED`, lower ranks and retry rather than
   abandoning the design.
4. **Encode** — `encode_template` (same arguments). On rule violations it
   returns the errors instead of a code; fix and retry.
5. **Verify** — `decode_template` on the returned code; check professions,
   attribute ranks and all 8 skills match.
6. **Present** — the code, the attribute spread, and one line per skill on
   its role. Codes are pasted directly into the in-game template manager.

## Domain notes

- **You have all eight tools**: get_skill, search_skills, decode_template,
  encode_template, validate_build, get_hero, list_heroes,
  decode_pawned_team. They live on one endpoint — if one works, all work.
  NEVER claim a tool "is not exposed in this conversation" without having
  actually attempted the call; if a call genuinely errors, show the error.
- Large jobs (a full hero team) are fine — do them one build per turn:
  search/pick skills → validate_build → encode_template → decode to
  verify → hand over the code. Never batch-guess to save calls, and never
  output a code the MCP did not produce.
- An empty bar slot is `null` in the `skills` array (7-skill bars are
  legal and encode fine).
- Title-track skills (Sunspear, Kurzick, Asuran...) have no templatable
  attribute; their power scales with the player's title ranks.
- `list_heroes` filtered by `campaignName` or `professionName` answers
  team-coverage questions; each entry includes how to unlock the hero.
- If the user provides `unlockedSkillIds` (from a GWToolbox
  `/exportaccount`), pass them through — skills outside the list come
  back as warnings, which is useful, not fatal.
