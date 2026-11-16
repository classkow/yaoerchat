#!/usr/bin/env python3
"""生成一套 PWA 图标：512 / 192 / apple-touch-180 / maskable-512。

用法：
    python3 gen-pwa-icons.py --out public/icons --letter y
    python3 gen-pwa-icons.py --out public/icons --letter A \\
        --color-top '#FF8A3D' --color-bottom '#F04A36'

要点（踩过的坑）：
- 小写字母有降部，按字体框 anchor='mm' 居中会视觉偏低；本脚本按**墨迹包围盒**居中。
- maskable 必须满铺直角，内容收进中央 80% 安全区，否则安卓会套白圆角框。
- 交付前一定要看末尾打印的客观校验，不要只凭肉眼。

依赖 Pillow（PIL）。
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def pick_font(explicit=None):
    for p in ([explicit] if explicit else []) + FONT_CANDIDATES:
        if p and os.path.exists(p):
            return p
    sys.exit("找不到字体，用 --font 指定一个 .ttf/.ttc")


def hex_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        row = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(size):
            px[x, y] = row
    return img


def ink_glyph(size, ratio, font_path, letter, optical_dy=0.0):
    """按墨迹包围盒居中，而不是按字体框。"""
    tmp = Image.new("RGBA", (size * 2, size * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    font = ImageFont.truetype(font_path, int(size * ratio))
    d.text((size, size), letter, font=font, fill=(255, 255, 255, 255), anchor="mm")
    box = tmp.getbbox()
    if not box:
        sys.exit("字形渲染为空，检查 --letter")
    glyph = tmp.crop(box)
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.alpha_composite(
        glyph,
        ((size - glyph.width) // 2,
         (size - glyph.height) // 2 + int(size * optical_dy)),
    )
    return layer


def rounded(img, radius_ratio=0.22):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def ink_box(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and r > 235 and g > 235 and b > 235:
                xs.append(x)
                ys.append(y)
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="输出目录")
    ap.add_argument("--letter", default="y", help="图标上的字（默认 y）")
    ap.add_argument("--color-top", default="#FF8A3D")
    ap.add_argument("--color-bottom", default="#F04A36")
    ap.add_argument("--font", default=None)
    a = ap.parse_args()

    font = pick_font(a.font)
    top, bottom = hex_rgb(a.color_top), hex_rgb(a.color_bottom)
    os.makedirs(a.out, exist_ok=True)

    base = gradient(512, top, bottom).convert("RGBA")
    base.alpha_composite(ink_glyph(512, 0.56, font, a.letter, optical_dy=-0.01))
    icon512 = rounded(base, 0.22)
    icon512.save(os.path.join(a.out, "icon-512.png"))

    icon512.resize((192, 192), Image.LANCZOS).save(os.path.join(a.out, "icon-192.png"))
    icon512.resize((180, 180), Image.LANCZOS).save(
        os.path.join(a.out, "apple-touch-icon-180.png"))

    # maskable：满铺直角 + 中央安全区
    m = gradient(512, top, bottom).convert("RGBA")
    m.alpha_composite(ink_glyph(512, 0.52, font, a.letter))
    m.convert("RGB").save(os.path.join(a.out, "maskable-512.png"))

    # ---- 客观校验 ----
    print("=== 产出 ===")
    for f in sorted(os.listdir(a.out)):
        p = os.path.join(a.out, f)
        print(f"{os.path.getsize(p):>8}  {p}")

    print("\n=== 校验 ===")
    ok = True
    for f, size, want_alpha in [
        ("icon-512.png", (512, 512), True),
        ("icon-192.png", (192, 192), True),
        ("apple-touch-icon-180.png", (180, 180), True),
        ("maskable-512.png", (512, 512), False),
    ]:
        p = os.path.join(a.out, f)
        im = Image.open(p).convert("RGBA")
        w, h = im.size
        px = im.load()
        corners = [px[0, 0][3], px[w - 1, 0][3], px[0, h - 1][3], px[w - 1, h - 1][3]]
        size_ok = im.size == size
        alpha_ok = (all(c == 0 for c in corners) if want_alpha
                    else all(c == 255 for c in corners))
        ok &= size_ok and alpha_ok
        print(f"{f:26} size={im.size} {'OK' if size_ok else 'BAD'} "
              f"corners={corners} {'OK' if alpha_ok else 'BAD'}")

    box = ink_box(os.path.join(a.out, "maskable-512.png"))
    if box:
        inside = box[0] >= 51 and box[2] <= 461 and box[1] >= 51 and box[3] <= 461
        ok &= inside
        print(f"maskable 墨迹框 {box} → 中央 80% 内: {'是' if inside else '否'}")

    print("\n结论:", "全部通过" if ok else "有问题，需要调")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
