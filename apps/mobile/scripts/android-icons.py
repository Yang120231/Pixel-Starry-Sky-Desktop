# 安卓 App 的图标和启动图（docs/mobile-remote.md §15）：从桌面端的 apps/desktop/build/icon.png（1024px、透明底）生成。
# 底色是深夜空蓝，像素画用最近邻缩放保持清晰。改了桌面图标后重跑：python apps/mobile/scripts/android-icons.py
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
ICON = ROOT / 'apps/desktop/build/icon.png'
RES = ROOT / 'apps/mobile/android/app/src/main/res'
SKY = (20, 32, 58, 255)  # #14203A

DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

src = Image.open(ICON).convert('RGBA')
src = src.crop(src.getbbox())


def fit(size: int, ratio: float) -> Image.Image:
    """图标缩到 size*ratio 以内，放在 size×size 透明画布中央"""
    target = int(size * ratio)
    scale = target / max(src.size)
    w, h = max(1, round(src.width * scale)), max(1, round(src.height * scale))
    # 缩小用 LANCZOS（像素画缩小后边缘更干净），放大用最近邻
    icon = src.resize((w, h), Image.LANCZOS if scale < 1 else Image.NEAREST)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(icon, ((size - w) // 2, (size - h) // 2), icon)
    return canvas


def background(size: int, shape: str) -> Image.Image:
    bg = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(bg)
    if shape == 'circle':
        d.ellipse((0, 0, size - 1, size - 1), fill=SKY)
    else:
        d.rounded_rectangle((0, 0, size - 1, size - 1), radius=size * 0.22, fill=SKY)
    return bg


for name, k in DENSITIES.items():
    folder = RES / f'mipmap-{name}'
    folder.mkdir(exist_ok=True)
    legacy = round(48 * k)
    for file, shape, ratio in (('ic_launcher.png', 'square', 0.82), ('ic_launcher_round.png', 'circle', 0.74)):
        img = background(legacy, shape)
        img.alpha_composite(fit(legacy, ratio))
        img.save(folder / file)
    # 自适应图标的前景：108dp 画布，安全区是中间的 66dp
    fg = round(108 * k)
    fit(fg, 0.6).save(folder / 'ic_launcher_foreground.png')

(RES / 'values/ic_launcher_background.xml').write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#14203A</color>\n</resources>\n',
    encoding='utf-8',
)

# 启动图：每张保持原尺寸，深夜空底 + 图标居中
for splash in RES.glob('drawable*/splash.png'):
    w, h = Image.open(splash).size
    img = Image.new('RGBA', (w, h), SKY)
    side = min(w, h)
    icon = fit(side, 0.42)
    img.alpha_composite(icon, ((w - side) // 2, (h - side) // 2))
    img.convert('RGB').save(splash)

print('ok')
