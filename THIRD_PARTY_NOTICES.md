# Third-party notices

This project's **source code** is licensed under the MIT License (see `LICENSE`).
The **game data** it bundles is not the project's own work and carries its own,
separate terms, described here. If you redistribute or build on this project,
these data terms apply independently of the MIT code license.

## Game data and skill descriptions

`packages/gw-data/data/skills.json` (skills, attributes, professions,
campaigns) and their English descriptions are imported from
[build-wars/gw-skilldata](https://github.com/build-wars/gw-skilldata).

That upstream project's **code** is MIT, but the **content** it aggregates
originates from the Guild Wars community wikis and carries their licenses:

The upstream build pipeline is readable, so the provenance below is **traced
from its code** (`build-wars/gw-skilldata`, `tools/Builder/Builder.php` and
`tools/Fetchers/`, checked 2026-07-29) rather than assumed:

- `WIKIFETCHERS` has exactly two entries. English pulls from
  `https://wiki.guildwars.com/api.php` — the **official Guild Wars Wiki**.
  German pulls from `https://www.guildwiki.de/gwiki/api.php` — **GuildWiki.de**,
  a separate German fansite wiki.
- `KEYS_DESC = [name, description, concise]` is assigned from the language's own
  fetcher. So every piece of **English text this project ships — skill names,
  descriptions and concise descriptions — comes from the official wiki**, which
  licenses original contributions under **GFDL 1.3** (full text in
  [`LICENSES/GFDL-1.3.txt`](./LICENSES/GFDL-1.3.txt)). Unlike a NonCommercial
  license, the GFDL permits commercial use, with attribution and share-alike.
- `WikiFetcherGerman::USE_FIELDS` writes the **numeric stat fields** into the
  shared data file: `upkeep`, `energy`, `activation`, `recharge`, `adrenaline`,
  `sacrifice`, `overcast`. All seven are present in our `skills.json`, so
  GuildWiki.de content does reach this repository — as numbers, not prose. Its
  pages carry a Creative Commons „Namensnennung – nicht kommerziell –
  Weitergabe unter gleichen Bedingungen" notice (BY-NC-SA, no version stated;
  its own Lizenzhinweise page says Attribution-ShareAlike 2.5, which contradicts
  the footer). `WikiFetcherEnglish::USE_FIELDS` contributes only `type`.
- **guildwars.fandom.com is NOT in the pipeline at all.** Earlier versions of
  this file attributed content to that wiki under CC BY-NC-SA 2.5. That was
  wrong on the source, and consequently wrong on the license and the version.

### The constraint that probably actually governs

Both wikis state plainly that in-game material is not theirs to license.
GuildWiki.de's Lizenzhinweise says all content taken from the game — images,
maps, skill icons, graphics, **names and texts** — is under NCsoft or ArenaNet
copyright and used under the Community Fansite Program. The official wiki's own
copyright discussion treats in-game content the same way, and ArenaNet's German
wiki notice states outright that content originating from the game, its websites
and its manuals remains ArenaNet/NCsoft property and is **not** licensed under
the GFDL.

Skill descriptions are verbatim in-game strings. On the wikis' own reading, they
are therefore ArenaNet/NCsoft copyright used under fansite terms, and neither the
GFDL nor any Creative Commons license is the operative instrument for them. The
wiki licenses would cover the editors' original prose — which is not what a
skill description is.

This is the question to put to counsel first, ahead of any version detail: not
"which CC version applies" but "does a wiki license apply to this text at all,
or are we redistributing ArenaNet strings under fansite terms?" Nothing here is
legal advice, and this repository is not in a position to answer it.

Note also that the published package `@buildwars/gw-skilldata` ships under
**MIT with no wiki attribution whatsoever** — its README states no provenance.
The attribution above is recovered from the build tooling in its repository, not
from anything the package itself declares.

This project also does not distinguish, field by field, which English skill
descriptions would trace to the Guild Wars Wiki versus GuildWiki — that
attribution lives further upstream than this repository controls. Treat the
whole `skilldata`/`skilldesc` import as subject to BOTH licenses' obligations
until a field-level provenance split is established.

### Hero roster is a SEPARATE source, not gw-skilldata

`packages/gw-data/data/heroes.json` is generated from the GWCA `HeroID` enum
(vendored in [gwdevhub/GWToolboxpp](https://github.com/gwdevhub/GWToolboxpp),
itself unlicensed game-interop header data with no applicable third-party
copyright license comparable to the wiki text above) plus
`packages/gw-data/data/heroes-overlay.json`, a small hand-curated overlay
(profession/campaign/unlock metadata) written by this project's maintainer —
this overlay IS project code, MIT like the rest of the repository. Do not
apply the GFDL/CC-BY-NC-SA notice above to the hero roster.

### What this means in practice

- The skill descriptions are **not** covered by this project's MIT license.
- **CC BY-NC-SA 2.5 is a NonCommercial license.** Redistribution or reuse of
  the affected descriptions in a commercial context may require permission or a
  different data source. This project makes no claim that the bundled data is
  freely usable for any purpose — only the code is MIT.
- ShareAlike and attribution obligations may apply to derivative uses of the
  affected text.

This is a good-faith notice, **not legal advice**. Anyone redistributing this
project or using it commercially should independently verify the licensing of
the specific data fields they rely on, and consider sourcing descriptions from a
provenance that matches their intended use.

## Trademark

Guild Wars is a registered trademark of NCSoft Corporation. This is an
unofficial, fan-made tool, not affiliated with or endorsed by NCSoft or ArenaNet.

## Template code format

The template code format is documented on the
[Guild Wars Wiki](https://wiki.guildwars.com/wiki/Skill_template_format). The
codec is an independent clean-room implementation validated against in-game and
community codes; it embeds no wiki text.
