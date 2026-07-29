# Upstream question: provenance of the skill description text

**Status:** drafted 2026-07-29, ready to file at
<https://github.com/build-wars/gw-skilldata/issues>. Not yet filed.

**Why file it:** to confirm the pipeline reading and to get a provenance note
into the README, which helps every downstream consumer.

**Deliberately narrowed.** An earlier draft asked the maintainer to characterise
the licensing of the text. He may well not know, and nobody may — so asking that
invites a guess we would then have to rely on. Our own position is now recorded
in `THIRD_PARTY_NOTICES.md` from evidence in the data itself (`<sic/>` markers,
`<gray>` matching in-game presentation, `[s]` bracket notation). What upstream
can answer with certainty is what his own code does, and whether he will document
it.

Keep the tone as written: this is a request for information from a maintainer who
has done the community a service, not a compliance demand.

---

## Suggested issue text

**Title:** Provenance and licensing of the skill description text

Hi, and thanks for gw-skilldata — it is the cleanest Guild Wars 1 skill dataset
available, and the continuous build is genuinely useful.

I maintain a downstream consumer (an MCP server that serves skill data to LLMs)
and I am trying to state the licensing of the text accurately in my own notices.
I read through `tools/Builder/Builder.php` and `tools/Fetchers/` rather than
guess, and I want to check my understanding:

- `WIKIFETCHERS` has two entries: `WikiFetcherEnglish` fetching
  `https://wiki.guildwars.com/api.php`, and `WikiFetcherGerman` fetching
  `https://www.guildwiki.de/gwiki/api.php`.
- In `fetchSkilldesc()`, `KEYS_DESC` (`name`, `description`, `concise`) is
  assigned from that language's own fetcher — so the English text in
  `skilldesc-en.json` comes from the official Guild Wars Wiki.
- `WikiFetcherGerman::USE_FIELDS` writes the numeric fields (`upkeep`, `energy`,
  `activation`, `recharge`, `adrenaline`, `sacrifice`, `overcast`) into
  `skilldata.json`, and `WikiFetcherEnglish::USE_FIELDS` contributes `type`.

Is that right? And one thing I could not settle from the code: which wiki field
the description and concise values are parsed out of — the skill infobox, or the
transcribed description block on the page?

I ask because the text looks like a faithful transcription of the game's own
strings rather than editor prose: 34 of them carry a `<sic/>` marker preserving
an original grammatical error, 403 wrap a clause in `<gray>` exactly where the
in-game tooltip greys it out, and the `signet[s]` bracket notation and leading
`(20 seconds.)` are the game's own conventions. That reading matters downstream,
because both wikis state that in-game text is not theirs to license.

I am not asking you to take a licensing position — that is not really yours or
mine to take. What would help every consumer of the package is a short
**provenance note in the README**: which fields come from which wiki, and that
the description text originates in the game client. The package ships MIT and the
README does not currently mention the wikis at all, so a reader has no way to
know any of this without doing what I just did.

Happy to open that PR myself if you tell me what it should say. No urgency, and
thanks either way.
