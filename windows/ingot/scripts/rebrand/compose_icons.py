"""Compose final icon artifacts from rendered PNGs (scripts/rebrand/icons/).

Overwrites the desktop build icons and web favicon with the CodeFusion mark,
and removes the stale .icns files (electron-builder regenerates mac icons
from the 512px PNG).
"""
import os
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
SRC = ROOT / "scripts" / "rebrand" / "icons"


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


from PIL import Image  # noqa: E402

sizes = [16, 32, 48, 64, 128, 256]
imgs = {s: Image.open(fs_safe(SRC / f"icon-{s}.png")).convert("RGBA") for s in sizes}
img512 = Image.open(fs_safe(SRC / "icon-512.png")).convert("RGBA")

# multi-resolution ICO
ico_imgs = [imgs[s] for s in sorted(sizes, reverse=True)]
ico_imgs[0].save(
    fs_safe(SRC / "icon.ico"),
    format="ICO",
    sizes=[(s, s) for s in sorted(sizes, reverse=True)],
    append_images=ico_imgs[1:],
)

desktop_build = ROOT / "packages" / "desktop" / "build"
for name, im in (
    ("icon.png", img512),
    ("icon_installer.png", img512),
    ("icon_windows.png", imgs[256]),
):
    im.save(fs_safe(desktop_build / name))
for name in ("icon.ico", "icon_installer.ico"):
    fs_safe(desktop_build / name).write_bytes((SRC / "icon.ico").read_bytes())

# stale mac icons from the old branding
for stale in ("icon.icns", "icon_installer.icns"):
    p = fs_safe(desktop_build / stale)
    if p.exists():
        p.unlink()
        print(f"removed stale {stale}")

# web favicon
fs_safe(ROOT / "packages" / "web" / "public" / "favicon.ico").write_bytes(
    (SRC / "icon.ico").read_bytes()
)

print("icons composed: desktop build icons + web favicon overwritten with CF mark")
