"""Swap the inline data-URI favicon in packages/web/index.html for the new CF mark (32px)."""
import base64
import os
import re
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


icon32 = fs_safe(ROOT / "scripts" / "rebrand" / "icons" / "icon-32.png").read_bytes()
new_uri = "data:image/png;base64," + base64.b64encode(icon32).decode("ascii")

page = fs_safe(ROOT / "packages" / "web" / "index.html")
text = page.read_text(encoding="utf-8")
new_text, n = re.subn(r'href="data:image/png;base64,[^"]+"', f'href="{new_uri}"', text, count=1)
if n != 1:
    raise SystemExit(f"expected exactly 1 favicon data URI, replaced {n}")
page.write_text(new_text, encoding="utf-8", newline="")
print("web favicon data URI replaced with CF mark")
