"""Draws the launcher icon (neon ring + star on a night-sky square) at every density."""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

RES = sys.argv[1] if len(sys.argv) > 1 else "res"
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}


def star(cx, cy, r_out, r_in, n=5):
    import math
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = -math.pi / 2 + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def draw(size=1024):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    # vertical night gradient in a rounded square
    grad = Image.new("RGBA", (size, size))
    gd = ImageDraw.Draw(grad)
    for y in range(size):
        t = y / size
        gd.line([(0, y), (size, y)], fill=(int(40 - 25 * t), int(12 + 4 * t), int(74 - 40 * t), 255))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=255)
    img.paste(grad, (0, 0), mask)

    # glowing ring, gradient colors around it
    ring = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    colors = [(57, 255, 106), (41, 198, 255), (180, 77, 255), (255, 63, 164)]
    m = int(size * 0.17)
    w = int(size * 0.07)
    for i, c in enumerate(colors):
        rd.arc([m, m, size - m, size - m], start=-90 + i * 90, end=i * 90, fill=c + (255,), width=w)
    glow = ring.filter(ImageFilter.GaussianBlur(size * 0.03))
    img.alpha_composite(glow)
    img.alpha_composite(ring)

    # star in the middle
    s = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sd = ImageDraw.Draw(s)
    sd.polygon(star(size / 2, size / 2 + size * 0.02, size * 0.22, size * 0.095), fill=(198, 255, 61, 255))
    img.alpha_composite(s.filter(ImageFilter.GaussianBlur(size * 0.025)))
    img.alpha_composite(s)
    return img


big = draw()
for dens, px in SIZES.items():
    out = os.path.join(RES, "mipmap-" + dens)
    os.makedirs(out, exist_ok=True)
    big.resize((px, px), Image.LANCZOS).save(os.path.join(out, "ic_launcher.png"))
big.resize((512, 512), Image.LANCZOS).save(os.path.join(os.path.dirname(RES) or ".", "icon-512.png"))
