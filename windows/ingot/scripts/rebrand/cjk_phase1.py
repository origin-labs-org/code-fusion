"""CJK purge phase 1: delete Chinese-language files outright.

- Markdown files containing CJK under docs/ and apps/cli/docs/ (zcode-era docs;
  CF docs get regenerated fresh).
- zh locale files (zh-CN.ts, *zh*.json mocks, values-zh-rCN android resources).
Everything else untouched. Report counts.
"""
import os
import re
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
CJK = re.compile(r"[\u4e00-\u9fff]")
EXCLUDE_DIRS = {"node_modules", ".git", "graphify-out", ".pnpm-store"}


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


def has_cjk(p: Path) -> bool:
    try:
        return bool(CJK.search(p.read_text(encoding="utf-8", errors="strict")))
    except (UnicodeDecodeError, PermissionError):
        return False


def rm(p: Path):
    p = fs_safe(p)
    if p.is_dir():
        for child in sorted(p.rglob("*"), reverse=True):
            fs_safe(child)
        import shutil

        shutil.rmtree(p, ignore_errors=True)
    elif p.exists():
        p.unlink()


deleted_md = 0
for sub in ("docs", "apps/cli/docs"):
    base = fs_safe(ROOT / sub)
    if not base.is_dir():
        continue
    for f in base.rglob("*.md"):
        if has_cjk(f):
            rm(f)
            deleted_md += 1
print(f"[md] deleted {deleted_md} CJK markdown files")

# zh locale / mock / resource files anywhere (excluding cf-old & node_modules)
targets = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
    p = Path(dirpath)
    if "cf-old" in p.relative_to(ROOT).parts:
        dirnames[:] = []
        continue
    for fn in filenames:
        low = fn.lower()
        if low in {"zh-cn.ts", "zh-tw.ts", "zh.ts"} or "zh-cn" in low or low.endswith(".zh-cn.json"):
            targets.append(p / fn)
    for d in list(dirnames):
        if d.lower() in {"values-zh-rcn", "values-zh", "values-zh-rcn"} or d.lower().startswith("values-zh"):
            rm(p / d)
            dirnames.remove(d)
deleted_loc = 0
for t in targets:
    rm(t)
    deleted_loc += 1
print(f"[locales] deleted {deleted_loc} zh locale files")

# prune now-empty directories left behind under docs/
emptied = 0
for sub in ("docs", "apps/cli/docs"):
    base = ROOT / sub
    if not base.is_dir():
        continue
    for d in sorted(base.rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            fs_safe(d).rmdir()
            emptied += 1
print(f"[dirs] pruned {emptied} empty dirs")
