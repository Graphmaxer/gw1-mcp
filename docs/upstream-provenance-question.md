# Upstream question: provenance of the skill description text

**Status:** drafted 2026-07-29, ready to file at
<https://github.com/build-wars/gw-skilldata/issues>. Not yet filed.

**Why file it:** it is the one question that settles the licensing position of
every downstream consumer of this data, and only the upstream author can answer
it. Our own notices currently have to hedge (see `THIRD_PARTY_NOTICES.md`), and
hedging is the wrong long-term answer for a project that ships publicly.

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

Is that right? And the question I cannot answer from the code:

**Do you consider the description text to be wiki-editor content, or verbatim
in-game strings that the wiki reproduces?** It matters because both wikis say
in-game text is not theirs to license — GuildWiki.de's Lizenzhinweise puts
"Bezeichnungen, Texte" from the game under NCsoft/ArenaNet copyright used under
the Community Fansite Program, and the official wiki treats in-game content the
same way. If the descriptions are in-game strings, then neither the GFDL nor a
Creative Commons license is the operative instrument for them, and downstream
notices that cite those licenses are describing the wrong thing.

The package ships MIT and the README does not mention the wikis, so I would
rather ask than infer. Two things would help every downstream user:

1. A short provenance note in the README — which fields come from which wiki,
   and how you view the licensing of the text.
2. If you do consider parts wiki-licensed, whether the GFDL attribution
   requirements are intended to flow to consumers of the JSON.

Happy to open a PR adding such a note if you tell me what it should say. No
urgency, and thanks either way.
