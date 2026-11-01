"""Install the user-provided CF brand assets across the app.

Sources (user-provided, RGB on light-gray):
  Interlocking Orange and Charcoal CF Logo.png  (1679x937) -> monogram
  CodeFusion Tech Logo.png                     (1678x937) -> monogram + wordmark

Outputs:
  packages/ui/src/assets/cf-logo.png            (monogram, transparent crop)
  packages/ui/src/assets/cf-wordmark-logo.png   (full lockup, trimmed)
  desktop build icons (rounded-square composites) + .ico + web favicon + public/logo
"""
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
SRC_DIR = Path(r"C:\Users\thaku\Downloads")
MONO_SRC = SRC_DIR / "Interlocking Orange and Charcoal CF Logo.png"
FULL_SRC = SRC_DIR / "CodeFusion Tech Logo.png"


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if np != ROOT and ROOT not in np.parents and np.parent != SRC_DIR:
        raise ValueError(f"path outside allowed roots refused: {p}")
    return np


BG = (204, 205, 204)  # source background tone
BG_TOL = 26


def is_bg(px) -> bool:
    return all(abs(px[i] - BG[i]) <= BG_TOL for i in range(3))


def to_transparent(im: Image.Image) -> Image.Image:
    """Turn the near-uniform source background into full transparency."""
    im = im.convert("RGBA")
    w, h = im.size
    # flood-fill from the borders so interior holes in letters stay opaque
    seen = set()
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    border = []
    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or (x, y) in seen:
            continue
        seen.add((x, y))
        if is_bg(im.getpixel((x, y))[:3]):
            border.append((x, y))
            stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    px = im.load()
    for x, y in border:
        px[x, y] = (0, 0, 0, 0)
    return im


def trim(im: Image.Image, pad: int = 0) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    if pad:
        from PIL import Image as _I

        canvas = _I.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), (0, 0, 0, 0))
        canvas.paste(im, (pad, pad))
        return canvas.crop((0, 0, canvas.width, canvas.height))
    return im.crop(bbox)


mono = trim(to_transparent(Image.open(fs_safe(MONO_SRC))))
full = trim(to_transparent(Image.open(fs_safe(FULL_SRC))))

assets = ROOT / "packages" / "ui" / "src" / "assets"
mono.save(fs_safe(assets / "cf-logo.png"))
full.save(fs_safe(assets / "cf-wordmark-logo.png"))
print("assets written: cf-logo.png", mono.size, "| cf-wordmark-logo.png", full.size)

# ---- app icon: monogram centered on the macOS-light rounded square ----
def rounded_square(size: int, radius: int, fill=(245, 245, 247, 255)) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    sq = Image.new("RGBA", (size, size), fill)
    sq.putalpha(mask)
    return sq


def compose_icon(size: int) -> Image.Image:
    radius = round(size * 0.225)
    icon = rounded_square(size, radius)
    mark_w = round(size * 0.62)
    mark_h = round(mark_w * mono.height / mono.width)
    mark = mono.resize((mark_w, mark_h), Image.LANCZOS)
    icon.alpha_composite(mark, ((size - mark_w) // 2, (size - mark_h) // 2))
    return icon


icons_dir = ROOT / "scripts" / "rebrand" / "icons"
sizes = [16, 32, 48, 64, 128, 256, 512]
for s in sizes:
    compose_icon(s).save(fs_safe(icons_dir / f"icon-{s}.png"))
print("rendered icon PNGs", sizes)

imgs = {s: Image.open(fs_safe(icons_dir / f"icon-{s}.png")).convert("RGBA") for s in [16, 32, 48, 64, 128, 256]}
ico_imgs = [imgs[s] for s in [256, 128, 64, 48, 32, 16]]
ico_imgs[0].save(
    fs_safe(icons_dir / "icon.ico"),
    format="ICO",
    sizes=[(s, s) for s in [256, 128, 64, 48, 32, 16]],
    append_images=ico_imgs[1:],
)

desktop_build = ROOT / "packages" / "desktop" / "build"
fs_safe(desktop_build / "icon.png")
Image.open(fs_safe(icons_dir / "icon-512.png")).save(fs_safe(desktop_build / "icon.png"))
Image.open(fs_safe(icons_dir / "icon-512.png")).save(fs_safe(desktop_build / "icon_installer.png"))
Image.open(fs_safe(icons_dir / "icon-256.png")).save(fs_safe(desktop_build / "icon_windows.png"))
for name in ("icon.ico", "icon_installer.ico"):
    fs_safe(desktop_build / name).write_bytes(fs_safe(icons_dir / "icon.ico").read_bytes())

fs_safe(ROOT / "packages" / "web" / "public" / "favicon.ico").write_bytes(
    fs_safe(icons_dir / "icon.ico").read_bytes()
)
big = Image.open(fs_safe(icons_dir / "icon-512.png")).resize((1024, 1024), Image.LANCZOS)
big.save(fs_safe(ROOT / "public" / "logo" / "icons" / "1024x1024.png"))
big.resize((128, 128), Image.LANCZOS).save(fs_safe(ROOT / "public" / "logo" / "icons" / "128x128.png"))
big.save(fs_safe(ROOT / "public" / "icon_512@2x.png"))
print("desktop icons + favicon + public logo replaced with CF monogram")
