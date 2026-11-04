from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 2048
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

image = Image.new("RGBA", (SIZE, SIZE), (20, 86, 61, 255))
draw = ImageDraw.Draw(image)

# 轻微的对角渐变，避免纯色死板
for y in range(SIZE):
    t = y / (SIZE - 1)
    r = int(12 + (31 - 12) * t)
    g = int(51 + (105 - 51) * t)
    b = int(36 + (76 - 36) * t)
    draw.line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

cream = (247, 241, 227, 255)
amber = (233, 161, 59, 255)
green = (12, 49, 36, 255)

cx, cy = 990, 1080
clock_r = 540
stroke = 104

# 外圈淡线
draw.ellipse(
    [cx - 675, cy - 675, cx + 675, cy + 675],
    outline=(247, 241, 227, 34),
    width=8,
)

# 表盘
draw.ellipse(
    [cx - clock_r, cy - clock_r, cx + clock_r, cy + clock_r],
    outline=cream,
    width=stroke,
)

# 指针
hand_w = 104
draw.line([(cx, cy), (cx, cy - 292)], fill=cream, width=hand_w)
draw.line([(cx, cy), (cx + 250, cy + 130)], fill=cream, width=hand_w)
for point in ((cx, cy - 292), (cx + 250, cy + 130)):
    r = hand_w // 2
    draw.ellipse([point[0] - r, point[1] - r, point[0] + r, point[1] + r], fill=cream)

# 中心轴
draw.ellipse([cx - 34, cy - 34, cx + 34, cy + 34], fill=cream)

# 琥珀色硬币 / 印章
coin_r = 182
coin_cx, coin_cy = 1585, 468
draw.ellipse(
    [coin_cx - coin_r, coin_cy - coin_r, coin_cx + coin_r, coin_cy + coin_r],
    fill=amber,
)
draw.ellipse(
    [coin_cx - 58, coin_cy - 58, coin_cx + 58, coin_cy + 58],
    fill=green,
)

for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")):
    resized = image.resize((size, size), Image.LANCZOS)
    resized.save(OUT / name, optimize=True)

print("icons written:", sorted(p.name for p in OUT.iterdir()))
