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

## How the full-bleed background was built

The corners were not simply flooded with a flat colour. The tile carries a real,
subtle gradient — measured `(22,21,22)` at the centre against `(24,21,28)` at the
edge, almost entirely in the blue channel — so a flat fill would have shown a seam.

The background is a per-channel linear fit of that measured gradient against
distance from centre, extrapolated to the corners (normalised distance reaches
1.414 there). The interior is then preserved pixel-for-pixel and only the region
outside the old rounded boundary is repainted, with the anti-aliased boundary band
blended into the new background so the former tile edge disappears.

The boundary is a **superellipse of exponent 3**, fitted from each source rather
than assumed — 293px on the current 1254px master, where a circular arc fits at
11.37px mean error against 1.36px for the superellipse, and exponent 4 at 1.56px.
The exponent is a property of the artwork, so it is re-fitted whenever the master
is replaced.

Verified: background luminance standard deviation across the old boundary is 0.47,
**lower** than the 3.16 measured away from it — the join is smoother than the
artwork's own vignette, so there is no residual ring. Corner reads `(21,19,27)`,
centre `(17,16,20)`.

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
