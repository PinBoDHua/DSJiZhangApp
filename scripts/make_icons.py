from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 2048
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

image = Image.new("RGBA", (SIZE, SIZE), (14, 82, 56, 255))
draw = ImageDraw.Draw(image)

# 轻微的对角渐变，避免纯色死板
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(10 + (28 - 10) * t)
    g = int(48 + (107 - 48) * t)
    b = int(34 + (77 - 34) * t)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

# 右上角柔光，增加一点“轻”的呼吸感
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
for radius in range(900, 0, -12):
    alpha = int(18 * (1 - radius / 900))
    glow_draw.ellipse(
        [SIZE - 220 - radius, -260 - radius, SIZE - 220 + radius, -260 + radius],
        fill=(255, 214, 150, alpha),
    )
image.alpha_composite(glow)

cream = (247, 241, 227, 255)
amber = (233, 161, 59, 255)
green = (12, 49, 36, 255)

cx, cy = 990, 1080
clock_r = 540
stroke = 94

# 表盘
draw.ellipse(
    [cx - clock_r, cy - clock_r, cx + clock_r, cy + clock_r],
    outline=cream,
    width=stroke,
)

# 内侧细线，增加层次但不抢戏
draw.ellipse(
    [cx - 372, cy - 372, cx + 372, cy + 372],
    outline=(247, 241, 227, 26),
    width=6,
)

# 指针
hand_w = 100
draw.line([(cx, cy), (cx, cy - 292)], fill=cream, width=hand_w)
draw.line([(cx, cy), (cx + 250, cy + 130)], fill=cream, width=hand_w)
for point in ((cx, cy - 292), (cx + 250, cy + 130)):
    r = hand_w // 2
    draw.ellipse([point[0] - r, point[1] - r, point[0] + r, point[1] + r], fill=cream)

# 中心轴
draw.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=cream)

# 琥珀色硬币 / 印章
coin_r = 176
coin_cx, coin_cy = 1585, 468
draw.ellipse(
    [coin_cx - coin_r, coin_cy - coin_r, coin_cx + coin_r, coin_cy + coin_r],
    fill=amber,
)
draw.ellipse(
    [coin_cx - 52, coin_cy - 52, coin_cx + 52, coin_cy + 52],
    fill=green,
)

for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")):
    resized = image.resize((size, size), Image.LANCZOS)
    resized.save(OUT / name, optimize=True)

print("icons written:", sorted(p.name for p in OUT.iterdir()))
