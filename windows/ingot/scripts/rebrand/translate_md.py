"""Translate remaining Chinese markdown files to English via the LLM route.

Targets: root docs (UI_PLUGIN, NOTICE, AGENTS, CONTEXT, DESIGN, config/README,
third-party/README), the design skill docs, and any other *.md with CJK outside
cf-old/node_modules/graphify-out. Chunks by paragraphs (~5k chars), preserves
markdown structure, code blocks, links and frontmatter. Resume-safe via a
processed-files list.
"""
import json
import os
import re
import time
from pathlib import Path

import httpx

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
OUT = ROOT / "scripts" / "rebrand"
DONE_LIST = OUT / "md_translated.txt"
CJK = re.compile(r"[\u4e00-\u9fff]")
EXCLUDE_PARTS = {"cf-old", "node_modules", "graphify-out", ".git", ".turbo", ".cache"}

BASE = os.environ["ANTHROPIC_BASE_URL"].rstrip("/")
TOKEN = os.environ["ANTHROPIC_AUTH_TOKEN"]
MODELS = [m.strip() for m in os.environ.get(
    "GRAPHIFY_LLM_MODELS",
    "ag/gemini-3.8-flash,ag/gemini-3.8-flash-medium,gemini/gemini-3.1-flash-lite-preview",
).split(",") if m.strip()]

CHUNK = 5000

# UI_PLUGIN.en.md is translated INTO UI_PLUGIN.md (single English source).
SPECIAL_TARGETS = {ROOT / "UI_PLUGIN.en.md": ROOT / "UI_PLUGIN.md"}


def fs_safe(p: Path) -> Path:
    np = Path(os.path.normpath(str(p)))
    if ".." in np.parts:
        raise ValueError(f"path traversal refused: {p}")
    if np != ROOT and ROOT not in np.parents:
        raise ValueError(f"path outside ROOT refused: {p}")
    return np


def call(text: str) -> str | None:
    body = {
        "model": MODELS[0],
        "max_tokens": 16384,
        "messages": [{
            "role": "user",
            "content": (
                "Translate the following Markdown from Chinese to concise, natural English.\n"
                "RULES:\n"
                "- Preserve the Markdown structure exactly: headings, lists, tables, links,"
                " frontmatter, and especially fenced code blocks (leave code blocks unchanged).\n"
                "- Keep URLs, file paths and identifiers unchanged.\n"
                "- If a passage is already English, keep it as is.\n"
                "Return ONLY the translated Markdown, no commentary.\n\n"
                + text
            ),
        }],
        "stream": False,
    }
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "x-api-key": TOKEN,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    for model in MODELS:
        body["model"] = model
        try:
            with httpx.Client(timeout=300) as c:
                r = c.post(BASE + "/messages", headers=headers, json=body)
            if r.status_code != 200:
                continue
            data = r.json()
            content = data.get("content") or (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
            if isinstance(content, list):
                content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
            if content.strip():
                return content
        except Exception:  # noqa: BLE001
            continue
    return None


def chunk_markdown(text: str):
    paras = text.split("\n\n")
    buf = ""
    for p in paras:
        if len(buf) + len(p) + 2 > CHUNK and buf:
            yield buf
            buf = p
        else:
            buf = buf + "\n\n" + p if buf else p
    if buf:
        yield buf


def main():
    done = set()
    if DONE_LIST.exists():
        done = {l.strip() for l in DONE_LIST.read_text(encoding="utf-8").splitlines() if l.strip()}

    targets = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_PARTS]
        p = Path(dirpath)
        if any(part in EXCLUDE_PARTS for part in p.relative_to(ROOT).parts):
            dirnames[:] = []
            continue
        for fn in filenames:
            if fn.endswith(".md"):
                f = fs_safe(p / fn)
                if str(f) in done:
                    continue
                try:
                    text = f.read_text(encoding="utf-8")
                except (UnicodeDecodeError, PermissionError):
                    continue
                if CJK.search(text):
                    targets.append((f, text))

    print(f"[{time.strftime('%H:%M:%S')}] md files to translate: {len(targets)}", flush=True)
    ok = fail = 0
    for f, text in targets:
        pieces = []
        good = True
        for chunk in chunk_markdown(text):
            out = call(chunk)
            if out is None:
                good = False
                break
            pieces.append(out)
        if not good:
            print(f"  FAIL: {f.relative_to(ROOT)}", flush=True)
            fail += 1
            continue
        dest = SPECIAL_TARGETS.get(f, f)
        fs_safe(dest).write_text("\n\n".join(pieces), encoding="utf-8", newline="")
        if dest != f:
            f.unlink()  # UI_PLUGIN.en.md folded into UI_PLUGIN.md
        with open(DONE_LIST, "a", encoding="utf-8") as fh:
            fh.write(str(f) + "\n")
        ok += 1
        print(f"  ok: {dest.relative_to(ROOT)}", flush=True)

    print(f"DONE: {ok} translated, {fail} failed", flush=True)


if __name__ == "__main__":
    main()
