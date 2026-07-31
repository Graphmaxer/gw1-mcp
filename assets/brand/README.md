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

The rounded-square boundary was derived from the image rather than guessed: the
tile ground reads at luminance ~15-23 while the outside corners read ~0.2, so the
mask is a luminance threshold, closed with a max/min filter pass and softened by a
1.2px blur for anti-aliasing. Fitting a circle or a squircle would have risked
clipping the real curve — measured radius is 20.7% of the width, close to but not
exactly the iOS 22.37% squircle.

Verified: corner alpha 0, centre alpha 255, edge midpoints still fully opaque (the
mask does not eat into the tile), and the gold unchanged at `(241, 188, 53)`.
