# Brand assets

**One icon, five sizes.** There is no light/dark pair and no transparent-versus-tile
choice to make, because the earlier split solved the wrong problem.

| File                 | Use for                                                    |
| -------------------- | ---------------------------------------------------------- |
| `icon-1024.png`      | master; directory submission forms                         |
| `icon-512.png`       | README header, anywhere mid-size                           |
| `icon-256.png`       | directory listings that ask for 256                        |
| `icon-48.png`        | composer / small UI slots                                  |
| `favicon-32.png`     | served at `/favicon.ico`, `/favicon.png`, `/logo.png`      |
| `social-preview.png` | GitHub Open Graph card, uploaded manually in repo Settings |

## Why one icon, full-bleed

The artwork fills the whole square. There is no rounded tile baked in, no
transparent corners, and no light/dark pair. Two earlier designs were wrong for
opposite reasons, and both are worth recording so neither comes back.

**A light/dark pair was unnecessary.** The mark is gold (`#F0BB34`), 1.77:1 against
white and 9.17:1 against dark, which argued for a transparent variant on dark
surfaces and a tiled one on light. But the tile already solves it: the mark sits on
its own charcoal ground, so contrast is 9.17:1 whatever is behind it.

**A rounded tile was also wrong.** Most platforms — mcp.so, Glama, app stores,
GitHub avatars — apply their own rounded frame, so shipping one produces a visible
frame inside a frame. Full-bleed lets each surface impose its own shape, and the
surfaces that apply none (browser tab favicons, inline README images) show a plain
square, which is what an icon normally looks like anyway.

## Source

The master is a fresh reference rendered 2026-07-31 at 1254px, with the mark drawn
larger than the previous version for legibility at small sizes. Measured: gold
coverage rose from 14.4% to 16.0% of the canvas, and at 32px — where it matters —
from 23.0% to 26.2% of pixels.

Its own geometry was re-fitted rather than inherited: a superellipse of exponent 3
at radius 293px, which is 23.4% of 1254 where the previous master sat at 28.7% of 1024. Reusing the old ratio would have cut into the artwork.

## How the background is built: rebuilt, not patched

The first two attempts patched the source raster — repaint outside a fitted
boundary, keep the interior pixel-for-pixel. Both left a visible artefact in the
corners, and the second one taught why: **the tile carries its own edge highlight**
(luminance ~23 at its rim against ~17 further in). Preserving the interior
preserved exactly the feature that should not survive, leaving a bright arc
orphaned in the middle of a smooth field.

So the background is no longer derived from the source at all:

1. **The mark is extracted by chroma.** The background is neutral (chroma 6,
   99th percentile 12) and the gold is not (chroma 189), so alpha ramps over
   chroma 12-45. This keeps the glow around the highlighted slot, which is dim but
   saturated — 15 171 pixels that a luminance key would have thrown away.
2. **The mark colour is unmatted** against the modelled old background, so
   semi-transparent edges carry pure gold rather than a blend toward the tile.
3. **The background is synthesised from scratch** across the whole square: a
   per-channel linear fit of the measured gradient (23 at centre to 20.5 at the
   corners, mostly in blue). No pixel of the original background survives, so
   there is no bevel, no rim and no orphaned vignette to leak through.

Measured on the result: the radial luminance profile is monotonic, each 0.1-radius
ring differing from its neighbour by 0.19 with an internal deviation of 0.05, and
the largest step anywhere is **0.205** against ~4 at the old seam. In the corner
region, excluding the neighbourhood of the gold, the maximum background gradient
fell from **24 to 0.72**, with **0 pixels** above 1 where there were 4 439.

## Two defects found by eye that measurement had missed

Both were invisible in my own checks and obvious to a human looking at the file,
which is worth remembering.

**Black slivers survived inside the mask.** The geometric superellipse is fitted,
so where the fit runs slightly wider than the artwork's true edge, the mask says
"inside" and keeps the original pixel — which there is the black surround. Measured:
**9078 trapped black pixels**, roughly 370 per corner plus a thin rim along the
straight edges. No purely geometric mask can see this. The fix combines the
geometric coverage with a data-driven indicator ramped over luminance 5-11 (the
artwork's own floor sits at 12.5, the surround at ~0) and replaces wherever _either_
says outside. Erring toward replacing more is free, because the replacement colour
IS the tile colour; erring the other way leaves the black.

**Lanczos was ringing on the gold.** Downscaling reintroduced pixels darker than
anything in the source — 3023 of them at 512px — because Lanczos undershoots on the
dark side of a high-contrast edge. That reads as a faint dark outline around the
gold strokes. Every size is now resampled with **area averaging** (`Image.BOX`),
which has no negative lobes: measured undershoot is 0 at every size, against 3023
for Lanczos, 705 for bicubic and 1 for Hamming. Lanczos scored "sharper" on a
gradient metric, but part of that gradient _was_ the ringing.

Verified: no opaque pixel below luminance 9 in any size, corner alpha 0 on the
rounded family and 255 on the full-bleed one.
