from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path('android/app/src/main/res')
SOURCE = Image.open('public/icons/icon-512.png').convert('RGBA')
PAPER = (244, 241, 232, 255)
PINE = (20, 86, 61, 255)
DENSITIES = {
    'mdpi': 48,
    'hdpi': 72,
    'xhdpi': 96,
    'xxhdpi': 144,
    'xxxhdpi': 192,
}
FOREGROUND = {
    'mdpi': 108,
    'hdpi': 162,
    'xhdpi': 216,
    'xxhdpi': 324,
    'xxxhdpi': 432,
}


def icon(size: int) -> Image.Image:
    return SOURCE.resize((size, size), Image.Resampling.LANCZOS)


def round_icon(size: int) -> Image.Image:
    scale = 4
    canvas = Image.new('RGBA', (size * scale, size * scale), (0, 0, 0, 0))
    art = icon(size * scale)
    mask = Image.new('L', (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    canvas.paste(art, (0, 0), mask)
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


for density, size in DENSITIES.items():
    folder = ROOT / f'mipmap-{density}'
    folder.mkdir(parents=True, exist_ok=True)
    icon(size).save(folder / 'ic_launcher.png')
    round_icon(size).save(folder / 'ic_launcher_round.png')

for density, size in FOREGROUND.items():
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    art_size = int(size * 0.74)
    art = icon(art_size)
    offset = (size - art_size) // 2
    canvas.alpha_composite(art, (offset, offset))
    canvas.save(ROOT / f'mipmap-{density}' / 'ic_launcher_foreground.png')

for splash in ROOT.glob('drawable*/splash.png'):
    target = Image.open(splash).convert('RGB')
    width, height = target.size
    canvas = Image.new('RGB', (width, height), PAPER[:3])
    art_size = max(64, int(min(width, height) * 0.26))
    art = icon(art_size)
    # Slight round mask keeps the splash from looking like a hard square.
    mask = Image.new('L', (art_size, art_size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, art_size - 1, art_size - 1), radius=int(art_size * 0.22), fill=255
    )
    canvas.paste(art, ((width - art_size) // 2, (height - art_size) // 2), mask)
    canvas.save(splash)

background = ROOT / 'values' / 'ic_launcher_background.xml'
background.write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n'
    '<resources>\n'
    '    <color name="ic_launcher_background">#14563D</color>\n'
    '</resources>\n',
    encoding='utf-8',
)
print('Android icons and splashes generated')
