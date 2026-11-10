"""Seam check for tileable textures (Pillow).

python -I tile_check.py in.png [out.png]

Offsets the image by half in both axes and saves a 2x2 preview so any seam sits in the middle.
Also prints size, power-of-two status and the mean edge mismatch (lower is better).
"""
import sys

from PIL import Image, ImageChops, ImageStat


def pot(n):
    return n > 0 and n & (n - 1) == 0


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    src = argv[0]
    dst = argv[1] if len(argv) > 1 else src.rsplit(".", 1)[0] + "_seams.png"
    im = Image.open(src).convert("RGB")
    w, h = im.size
    print(f"size={w}x{h} power_of_two={pot(w) and pot(h)} square={w == h}")
    if max(w, h) > 1024:
        print("NOTE PBR maps used with SurfaceAppearance are limited to 1024x1024")
    lr = sum(ImageStat.Stat(ImageChops.difference(im.crop((0, 0, 1, h)), im.crop((w - 1, 0, w, h)))).mean) / 3
    tb = sum(ImageStat.Stat(ImageChops.difference(im.crop((0, 0, w, 1)), im.crop((0, h - 1, w, h)))).mean) / 3
    print(f"edge_mismatch left-right={lr:.1f} top-bottom={tb:.1f} (0 to 255; above about 12 will show)")
    shifted = ImageChops.offset(im, w // 2, h // 2)
    canvas = Image.new("RGB", (w * 2, h * 2))
    for x in (0, w):
        for y in (0, h):
            canvas.paste(shifted, (x, y))
    canvas.save(dst)
    print("saved", dst, "(2x2 of the half-offset image: look for lines at the joins and the centre cross)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
