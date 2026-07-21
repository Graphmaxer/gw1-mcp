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

- Text and data derived from the **[Guild Wars Wiki](https://wiki.guildwars.com)**
  are under the **GNU Free Documentation License 1.3 (GFDL)** — full text at
  [`LICENSES/GFDL-1.3.txt`](./LICENSES/GFDL-1.3.txt).
- Text and data derived from the **[GuildWiki](https://guildwars.fandom.com)**
  are under **Creative Commons Attribution-NonCommercial-ShareAlike 2.5
  (CC BY-NC-SA 2.5)** — canonical text at
  <https://creativecommons.org/licenses/by-nc-sa/2.5/legalcode>.

This project does not currently distinguish, field by field, which English
skill descriptions trace to the Guild Wars Wiki versus GuildWiki — that
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
