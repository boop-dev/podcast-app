"""Generate the app's launcher icons and splash images (needs Pillow).

    python frontend/scripts/generate-icons.py

Writes the legacy (API 24-25) launcher PNGs into
frontend/android/app/src/main/res/mipmap-*/ (ic_launcher.png, ic_launcher_round.png).

Everything else is vector, so it stays sharp at any size and needs no generating:
  drawable/ic_launcher_foreground.xml  the microphone (adaptive icon, themed icon, splash)
  drawable/ic_launcher_background.xml  the gradient
  drawable/splash.xml                  pre-Android-12 splash
If you change the microphone, update the vector and the geometry in draw_glyph() together.
"""

import os
from PIL import Image, ImageDraw

RES = os.path.join(os.path.dirname(__file__), '..', 'android', 'app', 'src', 'main', 'res')
TOP, BOTTOM = (255, 138, 76), (224, 80, 26)  # tangerine gradient (matches the app accent)
WHITE = (255, 255, 255, 255)
SS = 4  # supersampling factor for smooth edges


def draw_glyph(size, scale=1.0, dy=2.5):
    """A white microphone on a transparent square canvas of `size` px.
    Geometry is in a 108-unit space (the adaptive icon canvas); `scale` grows it."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = big / 108.0 * scale
    off = (big - 108 * k) / 2  # keep it centred when scaled

    def p(x, y):
        return (off + x * k, off + (y + dy) * k)

    def box(x0, y0, x1, y1):
        a, b = p(x0, y0), p(x1, y1)
        return [a[0], a[1], b[0], b[1]]

    d.rounded_rectangle(box(46, 26, 62, 58), radius=8 * k, fill=WHITE)             # capsule
    d.arc(box(41, 39, 67, 65), start=0, end=180, fill=WHITE, width=round(4.2 * k))  # cradle
    for cx in (41, 67):                                                             # round cradle ends
        d.ellipse(box(cx - 2.1, 52 - 2.1, cx + 2.1, 52 + 2.1), fill=WHITE)
    d.rectangle(box(52, 64, 56, 74), fill=WHITE)                                    # stem
    d.rounded_rectangle(box(44, 73, 64, 77), radius=2 * k, fill=WHITE)              # base
    return img.resize((size, size), Image.LANCZOS)


def gradient(size):
    img = Image.new('RGBA', (size, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        row = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = row
    return img


def plate(size, shape):
    """Gradient plate with the glyph, shaped as a rounded square or a circle."""
    big = size * SS
    base = gradient(big)
    mask = Image.new('L', (big, big), 0)
    m = ImageDraw.Draw(mask)
    if shape == 'round':
        m.ellipse([0, 0, big - 1, big - 1], fill=255)
    else:
        m.rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=255)
    base.putalpha(mask)
    base = base.resize((size, size), Image.LANCZOS)
    base.alpha_composite(draw_glyph(size, scale=1.28 if shape == 'round' else 1.36, dy=1.5))
    return base


def main():
    sizes = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    for density, px in sizes.items():
        folder = os.path.join(RES, f'mipmap-{density}')
        plate(px, 'square').save(os.path.join(folder, 'ic_launcher.png'))
        plate(px, 'round').save(os.path.join(folder, 'ic_launcher_round.png'))
    print('legacy launcher icons written')


if __name__ == '__main__':
    main()
