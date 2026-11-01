"""Fix double-prefix from the rebrand codemod: 'cf-cf-' -> 'cf-' (e.g. @origin-ai/cf-cf-cua)."""
import os
import re
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
EXCLUDE_DIRS = {"node_modules", ".git", "graphify-out", ".pnpm-store", ".turbo", ".cache"}
EXCLUDE_PARTS = ("cf-old", ".backup_run1", ".backup_run2", ".obsidian_previous")
TEXT_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc", ".md", ".yml",
            ".yaml", ".html", ".css", ".scss", ".txt", ".sh", ".ps1", ".toml", ".xml"}
RX = re.compile(r"cf-cf-")


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
        if f.suffix.lower() not in TEXT_EXT or f.name in {"pnpm-lock.yaml", "package-lock.json"}:
            continue
        try:
            text = f.read_bytes().decode("utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        new_text, n = RX.subn("cf-", text)
        if n:
            fs_safe(f).write_text(new_text, encoding="utf-8", newline="")
            changed += 1
print(f"fixed {changed} files")
