# ChatGPT demo recording — shot list

**Status:** drafted 2026-07-31. The submission form blocks on
`Demo recording URL is required`, and asks for a video made in
[Developer Mode](https://platform.openai.com/docs/guides/developer-mode) covering
"all main use cases and tools across all platforms (web, iOS, Android)".

## Why this is not just "record the five test cases"

The five positive cases in `chatgpt-app-submission.json` exercise six tools:
`decode_template`, `get_skill`, `search_skills`, `validate_build`,
`encode_template`, `list_heroes`. They leave **`get_hero` and
`decode_pawned_team` untouched**. Following them alone would submit a recording
that omits two of the eight tools the form asks to see.

Shots 4 and 6 below exist to close that gap.

## Shot list

Run in this order. Each shot's prompt is what to type; the point is what a
reviewer should be able to observe.

1. **Decode a code someone shared** — `decode_template`
   Prompt: `Decode OgCjkurIrSuXaXPXBYihygvlYcA.`
   Show: professions, attribute ranks, the eight named skills. Establishes that
   the app reads real game data rather than guessing.

2. **Current stats, not model memory** — `get_skill`
   Prompt: `What does Mystic Regeneration cost and do right now?`
   Show: energy, activation, recharge, description. Say aloud (or caption) that
   these are current Reforged values from the tool.

3. **Design a bar and get a usable code** — `search_skills`, `validate_build`,
   `encode_template`
   Prompt: `Design a Motivation Paragon hero bar for General Morgahn and give me
the code.`
   Show: the search narrowing by attribute, the validation passing, and the code.
   This is the core workflow and deserves the most screen time.

4. **One hero in detail** — `get_hero` _(gap-filler)_
   Prompt: `Tell me about Master of Whispers — profession, campaign and how I
unlock him.`
   Show: the unlock note. Worth including because it demonstrates the app knows
   account-level constraints, not just skills.

5. **Browse a campaign roster** — `list_heroes`
   Prompt: `List the Nightfall heroes and how to unlock them.`
   Show: the roster with professions. Do NOT state a hero count on camera — the
   roster comes from upstream data and a spoken number would date the video.

6. **A whole team blob from PvXwiki** — `decode_pawned_team` _(gap-filler)_
   Prompt: paste a `pwnd0001...` team blob and ask
   `Decode this team and tell me what each hero is running.`
   Show: per-slot labels (Player, Hero 1…) and each bar decoded. Use the blob in
   `packages/gw-mcp/test/server.test.ts` (the 3 Hero Discordway fixture), which is
   verbatim from a real PvX page and is known to decode.

7. **The refusal that proves the point** — no tool call
   Prompt: `Just write me a template code for a Warrior bar without using the
tools.`
   Show: the assistant declining to invent a code and offering to encode one
   properly. This is the app's whole reason to exist — a hand-written code is
   invalid in game — so it is worth 15 seconds even though it is a negative case.

## Platform coverage

The form asks for web, iOS and Android. Every shot above is text-only, with no
widget or UI surface, so the same script runs unchanged on all three — this should
be three passes of the same recording, not three different scripts.

Record web first and get it right, then repeat on mobile. Keep each pass short:
seven shots at roughly 20-30 seconds each is a five-minute video, which is enough
to show every tool without padding.

## Before recording

- Merge the pending release so the server reports the version being submitted;
  the scan and the recording should not disagree with the form.
- Have the template code and the pwnd blob in a paste buffer. Typing a 25-character
  code on a phone on camera is not a good use of a reviewer's time.
- Do not show the Cloudflare dashboard, Workers logs or anything with account
  identifiers in frame.

## Rehearsed 2026-07-31 in Claude Code — findings

The whole script was run end to end against the live server. All seven shots
worked, including the two gap-fillers that exist because the submitted test cases
omit `get_hero` and `decode_pawned_team`. Two things worth carrying into the
recording, and one worth noting for the project.

**The model volunteers a hero count.** Shot 5 produced "13 Nightfall heroes"
unprompted. The number is correct today — the data has exactly 13 — but a spoken
or on-screen count dates the video the moment upstream adds a hero, which is the
same reason counts were removed from the store descriptions. It cannot be
suppressed by wording the prompt differently, so either accept it or cut that
sentence in the edit.

**Two pwnd blobs are better than one.** The rehearsal decoded an AB PvP team (4
slots, no heroes) and a hard-mode hero team (7 slots, every bar ending in Flesh of
My Flesh). The second is the more useful shot: it shows per-slot roles and proves
the tool handles the format players actually share. Keep both if the runtime allows
— they demonstrate different things.

**The refusal shot is the strongest moment in the script.** Asked to hand-write a
code, the assistant declined and explained why in the project's own terms: a
template code is bit-packed, so one wrong bit shifts every skill id after it. That
is the thesis of the whole project stated by the model itself, unprompted. Give it
room in the edit.

### Production confirmation of the A1 fix

Incidental but valuable: shot 4 returned **Master of Whispers as hero id 4**, and
the data agrees. That id is exactly what the `parseHeroEnum` bug would have got
wrong — an upstream comment swallowed the following hero and shifted every id
after it, which in the reproduction turned Master of Whispers from 4 into 3. The
live server reporting 4 is the first end-to-end confirmation of that fix outside
the test suite.
