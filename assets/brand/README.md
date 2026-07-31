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

## Why one icon and not two

The mark is gold (`#F0BB34`), which measures 1.77:1 against white and 9.17:1
against dark. That drove an earlier design with a transparent variant for dark
surfaces and a dark-tile variant for light ones — two files, and a decision to get
wrong at every upload.

The tile already solves it: the mark sits on its own charcoal ground, so contrast
is 9.17:1 regardless of the page behind it. The only reason the tile looked wrong
on a light background was that the source had **opaque near-black corners** outside
its rounded square, which showed as black triangles. Making those corners
transparent fixes it, and one file then works everywhere.

## How the corners were cut

Redone 2026-07-29 after the first attempt showed a soft, haloed edge at 100% zoom.
Two separate mistakes, worth naming because each is easy to repeat:

**The shape was fitted wrong.** The first pass derived the mask from a luminance
threshold and softened it with a 1.2px blur, which produced a wide, muddy band
rather than a crisp curve. Fitting the boundary properly shows the tile is a
**superellipse of exponent 3 with radius 294px** (28.7% of the width), not a
circular arc: a circle fits with 3.16px mean error against 1.10px for the
superellipse, and that ~3px deviation is exactly what is visible when you zoom a
corner. The mask is now generated geometrically at 4x and box-averaged down, so
the anti-aliasing comes from coverage rather than from a blur.

**The edge colour was never unmatted.** The gold mark was unmatted in the earlier
pass, but the tile edge was not: its semi-transparent pixels still carried the
original near-black, so on a light background they read as a grey halo. Interior
tile colour is now propagated outward across the boundary band before the alpha is
applied. Measured: the band narrowed from 3396 to 1356 pixels and its mean
luminance rose from 7.6 to 19.2 — the tile reads 15-23, black reads 0.

**Downscaling is done in premultiplied space.** Resizing RGBA directly lets the
colour of transparent pixels — here near-black — bleed into the edge and recreate
the fringe at small sizes. Each size is premultiplied, resized with Lanczos, then
unpremultiplied. This matters most at 32 and 48px.

Verified at every size: corner alpha 0 (1 at 32px, rounding), edge band tight, and
edge luminance in the tile range rather than near black.
