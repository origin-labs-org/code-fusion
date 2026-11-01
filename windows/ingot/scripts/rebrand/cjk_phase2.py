"""CJK purge phase 2: strip Chinese comments from source; collect Chinese string literals.

Order per file: collect nothing -> strip comments -> then collect remaining CJK
string literals (so strings inside deleted comments are not collected).

Comment handling (syntax-safe, conservative):
- full-line  // <CJK>          -> delete line
- trailing   code // <CJK>     -> strip the comment (requires whitespace before //)
- block      /* <CJK> */       -> remove whole comment (incl. JSX {/* */})
- HTML       <!-- <CJK> -->    -> remove
- # comments (.py/.sh/.toml/.yml) -> delete line

Writes: scripts/rebrand/cjk_strings.jsonl  ({"file","line","text"}) for LLM translation.
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
CJK = re.compile(r"[\u4e00-\u9fff]")
EXCLUDE_DIRS = {"node_modules", ".git", "graphify-out", ".pnpm-store", ".turbo", ".cache"}
EXCLUDE_PARTS = ("cf-old", ".backup_run1", ".backup_run2")
TEXT_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".cts", ".mts", ".json", ".jsonc",
            ".md", ".mdx", ".yml", ".yaml", ".html", ".css", ".scss", ".sh", ".ps1", ".py",
            ".toml", ".xml", ".svg", ".txt"}
EXCLUDE_FILES = {"package-lock.json", "pnpm-lock.yaml", "cjk_strings.jsonl", "leftovers.txt"}

LINE_CMT = re.compile(r"^[ \t]*(//[^\n]*|#[^\n]*)\n", re.MULTILINE)
TRAIL_CMT = re.compile(r"[ \t]+//[^\n]*")
BLOCK_CMT = re.compile(r"/\*[\s\S]*?\*/", re.MULTILINE)
HTML_CMT = re.compile(r"<!--[\s\S]*?-->", re.MULTILINE)
STR_SQ = re.compile(r"'([^'\\\n]*(?:\\.[^'\\\n]*)*)'")
STR_DQ = re.compile(r'"([^"\\\n]*(?:\\.[^"\\\n]*)*)"')


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


def strip_comments(text: str, ext: str):
    lines_removed = 0

    def rm_line(m):
        nonlocal lines_removed
        if CJK.search(m.group(0)):
            lines_removed += 1
            return ""
        return m.group(0)

    def rm_block(m):
        nonlocal lines_removed
        if CJK.search(m.group(0)):
            lines_removed += 1
            return ""
        return m.group(0)

    def rm_trail(m):
        nonlocal lines_removed
        if CJK.search(m.group(0)):
            lines_removed += 1
            return ""
        return m.group(0)

    text = BLOCK_CMT.sub(rm_block, text)
    text = HTML_CMT.sub(rm_block, text)
    if ext in {".py", ".sh", ".toml", ".yml", ".yaml"}:
        text = LINE_CMT.sub(rm_line, text)
    else:
        text = LINE_CMT.sub(rm_line, text)
        # trailing // comments only when preceded by whitespace (not a URL protocol)
        text = TRAIL_CMT.sub(rm_trail, text)
    # collapse >2 consecutive blank lines left by removals
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text, lines_removed


def collect_strings(text: str, rel: str, out):
    for i, line in enumerate(text.splitlines(), 1):
        if not CJK.search(line):
            continue
        for rx in (STR_SQ, STR_DQ):
            for m in rx.finditer(line):
                if CJK.search(m.group(1)):
                    out.append({"file": rel, "line": i, "text": m.group(0)})


def main():
    files_changed = 0
    comments_removed = 0
    strings = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        p = Path(dirpath)
        if any(part in EXCLUDE_PARTS for part in p.relative_to(ROOT).parts):
            dirnames[:] = []
            continue
        for fn in filenames:
            f = fs_safe(p / fn)
            if f.name in EXCLUDE_FILES or f.suffix.lower() not in TEXT_EXT:
                continue
            try:
                text = f.read_bytes().decode("utf-8")
            except (UnicodeDecodeError, PermissionError):
                continue
            if not CJK.search(text):
                continue
            new_text, n = strip_comments(text, f.suffix.lower())
            collect_strings(new_text, str(f.relative_to(ROOT)).replace(chr(92), "/"), strings)
            if n and new_text != text:
                fs_safe(f).write_text(new_text, encoding="utf-8", newline="")
                files_changed += 1
                comments_removed += n

    out = fs_safe(ROOT / "scripts" / "rebrand" / "cjk_strings.jsonl")
    with open(out, "w", encoding="utf-8") as fh:
        for s in strings:
            fh.write(json.dumps(s, ensure_ascii=False) + "\n")
    print(f"[comments] {files_changed} files cleaned, {comments_removed} comment blocks removed")
    print(f"[strings] {len(strings)} CJK string literals collected -> cjk_strings.jsonl")
    uniq_files = len({s['file'] for s in strings})
    print(f"[strings] across {uniq_files} files")


if __name__ == "__main__":
    main()
