# Brand assets

**One icon, full-bleed, five sizes** — plus a rounded variant for surfaces that draw
no frame of their own.

| File                       | Use for                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `icon-1024/512/256/48.png` | full-bleed. Anything that applies its own frame: mcp.so, Glama, stores, GitHub avatars, submission forms |
| `favicon-32.png`           | full-bleed; served at `/favicon.ico`, `/favicon.png`, `/logo.png`                                        |
| `icon-rounded-512/256.png` | rounded, transparent corners. Surfaces that draw NO frame — the README header                            |
| `social-preview.png`       | GitHub Open Graph card, uploaded by hand in repo Settings                                                |

The split is by **who draws the frame**, not by light and dark. The mark is gold
(`#F0BB34`) — 1.77:1 against white, 9.17:1 against dark — which once argued for a
light/dark pair, but the tile carries its own ground so contrast holds whatever is
behind it. One file per purpose.

## Regenerating from a new master

If the master is replaced, re-measure rather than reusing these numbers: the
boundary exponent and radius are properties of the drawing, not constants.

1. **Fit the corner.** Superellipse, not a circular arc. The current master fits
   exponent 3 at radius 293px on a 1254px canvas — 23.4% — where a circle fits at
   11.37px mean error against 1.36px. The previous master sat at 28.7%, so reusing a
   ratio would cut into the artwork.
2. **Extract the mark by CHROMA, not luminance.** The background is neutral (chroma
   6, 99th percentile 12), the gold is not (189), so alpha ramps over chroma 12-45.
   This keeps the glow around the highlighted slot — thousands of dim but saturated
   pixels a luminance key discards. Unmat the colour so semi-transparent edges carry
   pure gold.
3. **Synthesise the background; do not patch the source.** Fit the measured gradient
   per channel against distance from centre (23 at centre to 20.5 at the corners,
   mostly blue) and evaluate it across the whole square. Patching leaves the tile's
   own edge highlight orphaned as a visible arc, which is the mistake that took three
   attempts to stop making.
4. **Downscale with area averaging** (`Image.BOX`), never Lanczos. Lanczos undershoots
   on the dark side of a high-contrast edge — 3 023 pixels darker than any source
   pixel at 512px — which reads as a dark outline around the gold. Resize RGBA in
   premultiplied space so transparent pixels do not bleed into the edge.

Checks worth rerunning: background luminance must be monotonic in radius with no
local bump (largest step 0.205 at present), the corner gradient away from the gold
must stay near zero (0.72), and no opaque pixel should fall below luminance 9.
