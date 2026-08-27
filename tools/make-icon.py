"""Build the lil download icon from the lil edit one. Needs Pillow.

Same black rounded square, same fox — two things change, and both on purpose:

* **The colour.** lil edit and lil view are lavender. This one is red, so the
  suite can be told apart in the Dock without reading the label. Recolouring is
  a scale rather than a hue swap: against the near-black background a pixel is
  roughly `t · ink`, so solving for `t` and re-multiplying by the new ink keeps
  every antialiased edge exactly as soft as it was.
* **The pictogram.** lil edit's crop marks become an arrow dropping into a tray,
  because that is what this app does.

The old pictogram is removed by inpainting horizontally from the background
either side of it, which is a smooth near-black gradient, so no seam shows.

    iconutil -c iconset <lil-edit>/src-tauri/icons/icon.icns -o /tmp/liledit.iconset
    python tools/make-icon.py
    npx tauri icon /tmp/lildownload-icon-1024.png
"""
import colorsys
import sys
from collections import Counter, deque

from PIL import Image, ImageDraw

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/liledit.iconset/icon_512x512@2x.png"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/lildownload-icon-1024.png"

# YouTube is the source this app will see most, and red is the one colour nobody
# has to be taught to associate with it. Given as a hue, not a colour: the
# recolour below rotates hue and keeps each pixel's own lightness, which is what
# carries the gradient across. A flat target colour scaled by brightness keeps
# the ratio and loses the feel.
HUE = 8.0

# The pictogram is drawn, not recoloured, so it needs the colour spelled out —
# the same hue at the ink's own base lightness, so it sits at the same weight as
# the fox beside it rather than jumping forward.
RED = tuple(round(c * 255) for c in colorsys.hls_to_rgb(HUE / 360, 0.72, 0.46))

im = Image.open(SRC).convert("RGBA")
W, H = im.size
px = im.load()


def lavender(x, y):
    r, g, b, a = px[x, y]
    return a > 100 and b > 120 and b > r + 8 and r > 90


# --- find the pictogram: the lavender blob that isn't the fox -----------------
seen = [[False] * W for _ in range(H)]
comps = []
for y in range(H):
    for x in range(W):
        if lavender(x, y) and not seen[y][x]:
            q = deque([(x, y)])
            seen[y][x] = True
            pts = []
            while q:
                cx, cy = q.popleft()
                pts.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and lavender(nx, ny):
                        seen[ny][nx] = True
                        q.append((nx, ny))
            comps.append(pts)
comps.sort(key=len, reverse=True)
fox, glyph = comps[0], comps[1]
gx0 = min(p[0] for p in glyph); gx1 = max(p[0] for p in glyph)
gy0 = min(p[1] for p in glyph); gy1 = max(p[1] for p in glyph)
print(f"fox {len(fox)}px, pictogram {len(glyph)}px bbox {gx0},{gy0}-{gx1},{gy1}")

ink = Counter(px[x, y] for x, y in glyph).most_common(1)[0][0]
ink_peak = max(ink[:3])
print("old ink", ink)

# --- erase the old pictogram --------------------------------------------------
PAD = 12
mask = [[False] * W for _ in range(H)]
for x, y in glyph:
    for dy in range(-PAD, PAD + 1):
        for dx in range(-PAD, PAD + 1):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H:
                mask[ny][nx] = True
for x, y in fox:  # never touch the fox, whatever the dilation covered
    mask[y][x] = False

out = im.copy()
op = out.load()
for y in range(max(0, gy0 - PAD), min(H, gy1 + PAD + 1)):
    row = mask[y]
    x = max(0, gx0 - PAD)
    end = min(W, gx1 + PAD + 1)
    while x < end:
        if not row[x]:
            x += 1
            continue
        run_start = x
        while x < W and row[x]:
            x += 1
        run_end = x - 1
        left = px[max(0, run_start - 1), y]
        right = px[min(W - 1, run_end + 1), y]
        span = run_end - run_start + 1
        for i in range(span):
            t = (i + 1) / (span + 1)
            op[run_start + i, y] = tuple(
                round(left[c] * (1 - t) + right[c] * t) for c in range(4)
            )

# --- repaint the fox ----------------------------------------------------------
# A wider test than `lavender()` on purpose: the strict one misses the soft
# fringe, and a leftover violet halo around a red fox looks like a mistake.
#
# Hue rotation, keeping each pixel's lightness and saturation. The ink is not
# one flat colour — it runs from L 0.77 at the top of the fox to L 0.65 at the
# bottom, and that fall is most of what makes the icon look drawn rather than
# stamped. Scaling a flat red by brightness kept the ratio and flattened the
# look; anything lighter than the base clamped away entirely.
recoloured = 0
for y in range(H):
    for x in range(W):
        r, g, b, a = op[x, y]
        if a < 20 or b <= r + 4:
            continue
        _, l, sat = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        nr, ng, nb = colorsys.hls_to_rgb(HUE / 360, l, sat)
        op[x, y] = (round(nr * 255), round(ng * 255), round(nb * 255), a)
        recoloured += 1
print("recoloured", recoloured, "px")

# --- draw the new pictogram ---------------------------------------------------
# Same box as the old one, so the composition beside the fox is unchanged.
BOX = 300
OX, OY = 588, 192
S = 4  # supersample, then downscale for clean edges
layer = Image.new("RGBA", (BOX * S, BOX * S), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)


def rect(x0, y0, x1, y1):
    d.rectangle([x0 * S, y0 * S, x1 * S, y1 * S], fill=RED)


# Arrow: solid shapes rather than strokes, to sit with the square corners and
# heavy borders the rest of the suite is drawn with.
rect(130, 24, 170, 152)                                    # shaft
d.polygon([(88 * S, 138 * S), (212 * S, 138 * S), (150 * S, 236 * S)], fill=RED)

# Tray it drops into: an open-topped U.
rect(40, 214, 80, 292)                                     # left wall
rect(220, 214, 260, 292)                                   # right wall
rect(40, 252, 260, 292)                                    # floor

layer = layer.resize((BOX, BOX), Image.LANCZOS)
out.alpha_composite(layer, (OX, OY))
out.save(OUT)
print("wrote", OUT, out.size)
