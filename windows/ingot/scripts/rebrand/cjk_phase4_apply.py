"""CJK purge phase 4: apply LLM translations to the collected string literals.

Reads cjk_strings.jsonl ({file, line, text}) + cjk_translations.json (zh -> en),
walks the repo (same traversal as phase 2), and replaces each literal in place
(line-anchored, all occurrences on the line). Leftovers go to
cjk_untranslated.jsonl.
"""
import json
import os
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
OUT = ROOT / "scripts" / "rebrand"
EXCLUDE_DIRS = {"node_modules", ".git", "graphify-out", ".pnpm-store", ".turbo", ".cache"}
EXCLUDE_PARTS = ("cf-old", ".backup_run1", ".backup_run2")
TEXT_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cts", ".mts", ".json", ".jsonc",
            ".md", ".mdx", ".yml", ".yaml", ".html", ".css", ".scss", ".sh", ".ps1", ".py",
            ".toml", ".xml", ".svg", ".txt"}
QUOTES = "\"'"


def fs_safe(p: Path) -> Path:
    """Normalize p, refuse any '..' component, and require p to be inside ROOT."""
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


def iter_files():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        p = Path(dirpath)
        if any(part in EXCLUDE_PARTS for part in p.relative_to(ROOT).parts):
            dirnames[:] = []
            continue
        for fn in filenames:
            f = fs_safe(p / fn)
            if f.suffix.lower() in TEXT_EXT:
                yield f


def lookup(trans: dict, text: str):
    if text in trans:
        return trans[text]
    stripped = text.strip(QUOTES)
    if stripped and stripped in trans:
        return trans[stripped]
    inner = text[1:-1] if len(text) >= 2 and text[0] == text[-1] and text[0] in QUOTES else None
    if inner and inner in trans:
        return trans[inner]
    return None


def is_property_key(line: str, text: str) -> bool:
    """Never translate an object/JSON property key: keys are identifiers, not copy."""
    idx = line.find(text)
    if idx < 0:
        return False
    before = line[:idx]
    after = line[idx + len(text):]
    return bool(re.match(r"\s*:", after) and re.search(r"(^|[{,]\s*)$", before))


def escape_for_quote(value: str, quote: str) -> str:
    """Escape a translation so it can live inside the original quote style."""
    if len(value) >= 2 and value[0] == quote and value[-1] == quote:
        value = value[1:-1]
    if quote == '"':
        return value.replace('\\"', '"').replace('"', '\\"')
    if quote == "'":
        return value.replace("\\'", "'").replace("'", "\\'")
    return value


def main():
    entries = defaultdict(lambda: defaultdict(list))
    for line in fs_safe(OUT / "cjk_strings.jsonl").read_text(encoding="utf-8").splitlines():
        d = json.loads(line)
        entries[d["file"].replace(chr(92), "/")][d["line"]].append(d["text"])

    trans = json.loads(fs_safe(OUT / "cjk_translations.json").read_text(encoding="utf-8"))
    print(f"translations available: {len(trans)}")

    applied = missing = files = 0
    miss_entries = []
    for f in iter_files():
        rel = f.relative_to(ROOT).as_posix()
        by_line = entries.get(rel)
        if not by_line:
            continue
        try:
            content = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, PermissionError):
            continue
        lines = content.splitlines(keepends=True)
        changed = False
        for lineno, texts in by_line.items():
            idx = lineno - 1
            if idx >= len(lines):
                continue
            for t in texts:
                tr = lookup(trans, t)
                if tr is None:
                    miss_entries.append({"file": rel, "line": lineno, "text": t})
                    missing += 1
                    continue
                if t in lines[idx] and is_property_key(lines[idx], t):
                    miss_entries.append({"file": rel, "line": lineno, "text": t})
                    missing += 1
                    continue
                q = t[0] if t and t[0] in QUOTES else ""
                if q:
                    tr = q + escape_for_quote(tr, q) + q
                if t in lines[idx]:
                    lines[idx] = lines[idx].replace(t, tr)
                    applied += 1
                    changed = True
        if changed:
            fs_safe(f).write_text("".join(lines), encoding="utf-8", newline="")
            files += 1

    fs_safe(OUT / "cjk_untranslated.jsonl").write_text(
        "\n".join(json.dumps(m, ensure_ascii=False) for m in miss_entries), encoding="utf-8"
    )
    print(
        f"applied {applied} translations across {files} files; "
        f"{missing} untranslated -> cjk_untranslated.jsonl"
    )


if __name__ == "__main__":
    main()
