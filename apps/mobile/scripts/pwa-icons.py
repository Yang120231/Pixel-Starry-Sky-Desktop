# 网页版「添加到主屏幕」的图标（docs/mobile-remote.md §20）：从桌面端的 apps/desktop/build/icon.png（1024px、透明底）生成，
# 底色和安卓图标一样是深夜空蓝，缩小用 LANCZOS、放大用最近邻。改了桌面图标后重跑：python apps/mobile/scripts/pwa-icons.py
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
ICON = ROOT / 'apps/desktop/build/icon.png'
OUT = ROOT / 'apps/mobile/public'
SKY = (20, 32, 58, 255)  # #14203A

src = Image.open(ICON).convert('RGBA')
src = src.crop(src.getbbox())


def fit(size: int, ratio: float) -> Image.Image:
    """图标缩到 size*ratio 以内，放在 size×size 透明画布中央"""
    target = int(size * ratio)
    scale = target / max(src.size)
    w, h = max(1, round(src.width * scale)), max(1, round(src.height * scale))
    icon = src.resize((w, h), Image.LANCZOS if scale < 1 else Image.NEAREST)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(icon, ((size - w) // 2, (size - h) // 2), icon)
    return canvas


def rounded(size: int, ratio: float) -> Image.Image:
    """圆角深空底 + 图标（purpose any：桌面和浏览器里原样显示，四角透明）"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle((0, 0, size - 1, size - 1), radius=size * 0.22, fill=SKY)
    img.alpha_composite(fit(size, ratio))
    return img


def full_bleed(size: int, ratio: float) -> Image.Image:
    """整张铺满的深空底（系统自己裁成圆 / 圆角方）；ratio 取 0.6 以内，图标留在中间 80% 安全区里"""
    img = Image.new('RGBA', (size, size), SKY)
    img.alpha_composite(fit(size, ratio))
    return img


(OUT / 'icons').mkdir(parents=True, exist_ok=True)
rounded(192, 0.78).save(OUT / 'icons/icon-192.png')
rounded(512, 0.78).save(OUT / 'icons/icon-512.png')
# 可遮罩图标：安全区是中间 80% 的圆（直径 0.8），图标最长边 0.64，四角本来就是透明的，实际都在圆内
full_bleed(512, 0.64).save(OUT / 'icons/icon-maskable-512.png')
# iOS 主屏幕图标：要不透明的整方块，系统自己加圆角（透明处会变黑）
full_bleed(180, 0.7).convert('RGB').save(OUT / 'apple-touch-icon.png')
rounded(32, 0.86).save(OUT / 'favicon.png')

print('ok')
