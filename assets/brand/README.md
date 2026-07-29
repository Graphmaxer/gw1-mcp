# Brand assets

Two variants of the same mark, because the right one depends on what the
surface behind it looks like.

| File                                            | Background         | Use for                                                                                                                    |
| ----------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `logo-1024.png`, `logo-512.png`, `logo-256.png` | transparent        | the default: directory listings, READMEs, anywhere the host composites on its own surface                                  |
| `logo-*-tile.png`                               | dark charcoal tile | when a platform requires a filled/opaque icon, or when the listing renders on a light theme and the mark must stay legible |
| `favicon-32.png`                                | dark tile          | served at `/favicon.ico`, `/favicon.png`, `/logo.png`                                                                      |
| `favicon-32-transparent.png`                    | transparent        | kept for completeness; **not** wired up (see below)                                                                        |

## Why the favicon keeps its tile

The mark is gold (`#F0BB34`) and gold has very little contrast against light
surfaces — measured 1.77:1 on white and 1.64:1 on the near-white a store page
uses, against 9.17:1 on dark. At 1024px that is fine: the shape is large enough
to read even when the colour is washed out. At 32px, where only ~10% of pixels
carry the mark, a transparent version is close to invisible on a light browser
tab strip. The tile is what makes it readable, so the favicon keeps it.

## How the transparency was cut

The source was fully opaque with a charcoal background (`#17151B`) vignetting to
near-black at the corners, so a flat "make black transparent" would have left
halos. Instead alpha is keyed on luminance — the histogram is cleanly bimodal
(84% of pixels below 0.1, the gold at ~0.74, almost nothing between) and the
mark does not touch the edges — and the colour is then _unmatted_:

    observed = gold * alpha + background * (1 - alpha)
    gold     = (observed - background * (1 - alpha)) / alpha

Without that last step the anti-aliased edge pixels keep the dark background
mixed into them and show as a dirty fringe on light backgrounds. Verified by
compositing over white, near-white and dark.

## `social-preview.png` (1280×640)

GitHub's Open Graph card. **It cannot be committed into place** — upload it at
Settings → General → Social preview. The file lives here for provenance and so
it can be regenerated.

Design notes, so a future change stays deliberate:

- **The content is real, and the product made it.** The template code
  `OgCjkyrKLOu3mL0dAzcZvmXxL` is not decorative filler: it is the actual output
  of `encodeTemplate` for a Dervish scythe bar (Avatar of Balthazar, Eremite's
  Attack, Victorious Sweep, Chilling Victory, Mystic Sweep, Mystic Regeneration,
  Sand Shards, Vital Boon; Scythe 12 / Earth Prayers 10 / Mysticism 8). It
  passes `validateBuild` with zero errors and zero warnings, and round-trips
  through `decodeTemplate` back to the same bar. The first two drafts did not:
  the validator rejected MULTIPLE_ELITES, then ATTRIBUTE_POINTS_EXCEEDED at
  224/200. A card advertising a validator should not show a build its own
  validator refuses.
- **The eight slots are the logo's device, reused.** Exactly one is gold —
  the single elite the validator allows. The structure encodes a game rule
  rather than decorating the space.
- **Type pairs a renaissance serif with a monospace** (TeX Gyre Pagella +
  DejaVu Sans Mono). That tension is the project: a 2005 game meeting an LLM
  protocol. A geometric sans would have read as generic developer-tool.
- **Margins are 72px** so the 1.91:1 crop Facebook and LinkedIn apply takes
  only empty ground. Verified at 590px feed scale, where the code is still
  legible — which is why the code is set large and the skill names are not on
  the card at all.
