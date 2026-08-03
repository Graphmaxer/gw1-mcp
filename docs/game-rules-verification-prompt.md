# Prompt: have another model verify the game rules

Paste the block below into ChatGPT (or any model with good web search). It was
generated from `packages/gw-mcp/src/validate.ts`, so the assertions are what the code
actually does, not a paraphrase.

Why this exists: on 2026-07-31 two rules turned out to be wrong, and both were found by
checking sources rather than reading code. One rejected legal builds. Reading an
implementation can only tell you the code does what it says.

**When the answers come back**, do not apply them directly. For each verdict, open the
cited URL and check the quote exists and says what is claimed. A confident answer with
a dead link or a paraphrased "quote" is worth nothing — that is exactly the failure this
prompt is trying to catch.

---

## The prompt

I need you to fact-check the rule set of a Guild Wars 1 build validator against
primary sources. **Guild Wars 1 (Prophecies/Factions/Nightfall/Eye of the North, and
the current Guild Wars Reforged), NOT Guild Wars 2.** If a source is about GW2, discard
it.

Source priority:

1. `wiki.guildwars.com` (the official wiki) — prefer this
2. `guildwars.fandom.com` (GuildWiki) — acceptable
3. `gwpvx.fandom.com`, forums, Reddit, Steam discussions — only as corroboration, never
   alone
4. Official ArenaNet/NCSoft update notes, especially anything Reforged-era that may
   have changed a long-standing rule

For **each** rule below, answer in this exact shape:

```
RULE: <name>
VERDICT: CORRECT | TOO STRICT | TOO LENIENT | WRONG | NOT FOUND
SOURCE: <full URL>
QUOTE: "<verbatim sentence from that page that supports the verdict>"
NOTE: <one or two lines; mention any exception, or any Reforged change>
CONFIDENCE: HIGH | MEDIUM | LOW
```

Rules:

- `TOO STRICT` means the validator rejects something the game allows. **This is the
  verdict I care about most** — a false rejection is worse than a missed rule, because
  the user cannot tell the tool is at fault.
- `TOO LENIENT` means the game forbids something the validator accepts.
- `NOT FOUND` is a perfectly good answer. **Say it rather than inferring.** Do not
  reason from plausibility; if no source states it, say so.
- Quote verbatim. If you cannot find a sentence to quote, the verdict is `NOT FOUND`.

### The rules, as the code enforces them

1. **NO_PRIMARY** — a build must have a primary profession.
2. **SAME_PROFESSIONS** — primary and secondary must differ.
3. **INVALID_SKILL_COUNT** — a skill bar has exactly 8 slots.
4. **MULTIPLE_ELITES** — at most one elite skill per bar.
5. **PROFESSION_MISMATCH** — every skill must belong to the primary profession, the
   secondary profession, or to no profession (common/PvE-only skills).
6. **PVE_ONLY_ON_PVP_BUILD** — a PvE-only skill cannot appear on a PvP character's bar.
7. **PVE_ONLY_ON_HERO** — a hero cannot equip a PvE-only skill. (Signet of Capture is
   handled by a separate rule that also forbids it for heroes.)
8. **TOO_MANY_PVE_SKILLS** — at most 3 PvE-only skills per player bar, **and Signet of
   Capture counts toward that 3**. Heroes are exempt from the count because they cannot
   have any.
9. **PVP_VERSION_ON_PVE_BUILD** — a skill id that is the PvP version of a split skill
   is rejected unless the caller declares the bar is for a PvP character.
10. **PVE_VERSION_ON_PVP_BUILD** — on a PvP character's bar, a skill that HAS a
    separate PvP version but is given as the PvE version is rejected.
11. **ATTRIBUTE_NOT_TEMPLATABLE** — title tracks (Sunspear rank, Lightbringer rank)
    cannot be allocated attribute points in a skill template.
12. **RANK_OUT_OF_RANGE** — base attribute ranks are 0 to 12 inclusive.
13. **ATTRIBUTE_PROFESSION_MISMATCH** — points can only be allocated to attributes
    belonging to the primary or secondary profession.
14. **PRIMARY_ATTRIBUTE_ON_SECONDARY** — a profession's primary attribute (Divine
    Favor, Strength, Soul Reaping, Fast Casting, Energy Storage, Expertise, Critical
    Strikes, Spawning Power, Leadership, Mysticism) can only receive points if that
    profession is the PRIMARY one.
15. **DUPLICATE_SKILL** — the same skill cannot appear twice on a bar, EXCEPT Signet of
    Capture, of which up to three copies are allowed.
16. **Attribute point budget** — a level 20 character has at most **200** points (170
    from levelling plus 15 from each of two campaign-native attribute quests), and the
    cumulative cost to reach a rank is:
    `rank 0=0, 1=1, 2=3, 3=6, 4=10, 5=15, 6=21, 7=28, 8=37, 9=48, 10=61, 11=77, 12=97`.
    Verify **both** the 200 total and every number in that table.

### Two rules I specifically suspect — spend extra effort here

Rules 9 and 10 concern PvE/PvP split skills. I have found a 2009 comment on
`gwpvx.fandom.com/wiki/Talk:PvX_wiki/Archive_12` by "poke", who documented the skill
template format on the official wiki, saying that PvE and PvP versions are separate
skills with separate ids, but that **when the game generates a skill template code it
writes the PvE id even for PvP-version skills**, which is what allows a PvP build to
load in PvE and vice versa, and makes it impossible to tell from a template whether it
was meant for PvP or PvE.

If that is true and still true today:

- Rule 10 rejects the normal case, since every genuine PvP template would carry PvE ids
  for all 156 split skills.
- Rule 9's condition is wrong too, since `forPvp` would not make a PvP id legitimate —
  the game never writes one.

Please try to confirm or refute this specifically, and say clearly which. Look for: the
official `Skill template format` page, anything about how split skills are stored in
templates, and any Reforged-era change. If you can only find the 2009 comment, say so
and mark confidence LOW — I would rather know it is unconfirmed than act on it.

### Also tell me what is MISSING

After the per-rule verdicts, list any rule the game enforces on an 8-skill bar or an
attribute allocation that is **not** in the list above. Same format: source and verbatim
quote. Things worth checking: restrictions on heroes beyond PvE-only skills, anything
specific to PvP-only characters, anything about elite skills beyond the one-per-bar
limit, and any Reforged-era addition.

Do not summarise at the end. The per-rule blocks and the missing-rule list are the whole
answer.
