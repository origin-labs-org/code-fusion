"""Theme rename: zai-light/zai-dark -> cf-light/cf-dark, theme-zai- -> theme-cf-.

Skips the 3 files that still hold collected CJK strings (renamed after the
translation apply pass, to keep line anchors stable).
"""
import os
import re
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
SKIP = {
    "packages/ui/src/previewPaneOfficeLegacyDocContent.tsx",
    "packages/ui/src/SettingsPage.tsx",
    "packages/desktop/test/e2e/helpers/plugin-management-lifecycle.ts",
}
EXCLUDE_DIRS = {"node_modules", ".git", "graphify-out", ".pnpm-store", ".turbo", ".cache"}
EXCLUDE_PARTS = ("cf-old", ".backup_run1", ".backup_run2")
TEXT_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".html", ".md",
            ".yml", ".yaml"}
RULES = [
    (re.compile(r"zai-light"), "cf-light"),
    (re.compile(r"zai-dark"), "cf-dark"),
    (re.compile(r"theme-zai-"), "theme-cf-"),
]


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


changed = 0
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
    p = Path(dirpath)
    if any(part in EXCLUDE_PARTS for part in p.relative_to(ROOT).parts):
        dirnames[:] = []
        continue
    for fn in filenames:
        f = fs_safe(p / fn)
        rel = f.relative_to(ROOT).as_posix()
        if rel in SKIP or f.suffix.lower() not in TEXT_EXT:
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        new = text
        n = 0
        for rx, rep in RULES:
            new, k = rx.subn(rep, new)
            n += k
        if n:
            fs_safe(f).write_text(new, encoding="utf-8", newline="")
            changed += 1
print(f"theme rename: {changed} files updated")
