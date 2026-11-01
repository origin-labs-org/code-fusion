"""CJK purge phase 3a: translate collected Chinese string literals to English via LLM route.

Reads  scripts/rebrand/cjk_strings.jsonl  ({"file","line","text"})
Writes scripts/rebrand/cjk_translations.json (unique zh -> en map, resume-safe)

Prompt rules: preserve placeholders ({x}, %s, ${y}), backslash escapes, tags,
and any non-Chinese tokens exactly; concise natural English.
"""
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

ROOT = Path(r"C:\Users\thaku\Workspaces\fusion\code-fusion")
OUT = ROOT / "scripts" / "rebrand"
STRINGS = OUT / "cjk_strings.jsonl"
TRANS = OUT / "cjk_translations.json"

BASE = os.environ["ANTHROPIC_BASE_URL"].rstrip("/")
TOKEN = os.environ["ANTHROPIC_AUTH_TOKEN"]
MODELS = [m.strip() for m in os.environ.get(
    "GRAPHIFY_LLM_MODELS",
    "ag/gemini-3.8-flash,ag/gemini-3.8-flash-medium,gemini/gemini-3.1-flash-lite-preview",
).split(",") if m.strip()]

BATCH = 80
_lock = threading.Lock()


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def call(model, texts):
    body = {
        "model": model,
        "max_tokens": 16384,
        "messages": [{
            "role": "user",
            "content": (
                "Translate every Chinese string below to concise, natural English.\n"
                "RULES:\n"
                "- Preserve every placeholder exactly: {x}, %s, %s1, ${y}, <tag>, `code`.\n"
                "- Preserve backslash escapes (\\n, \\t, \\\") exactly as written.\n"
                "- Keep non-Chinese words, identifiers and URLs unchanged.\n"
                "- Keep the surrounding quote characters EXACTLY as given.\n"
                "Return STRICT JSON only: {\"translations\":[{\"zh\":"<exact input>","en":"<translation>"}, ...]}\n"
                "One entry per input string, same order.\n\nINPUTS:\n"
                + "\n".join(texts)
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
    with httpx.Client(timeout=300) as c:
        r = c.post(BASE + "/messages", headers=headers, json=body)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
    data = r.json()
    content = data.get("content") or (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if isinstance(content, list):
        content = "".join(b.get("text", "") for b in content if isinstance(b, dict))
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        raise RuntimeError("no JSON in response")
    parsed = json.loads(content[start:end + 1])
    out = {}
    for item in parsed.get("translations", []):
        zh, en = item.get("zh"), item.get("en")
        if isinstance(zh, str) and isinstance(en, str):
            out[zh] = en
    return out


def main():
    texts = []
    seen = set()
    for line in STRINGS.read_text(encoding="utf-8").splitlines():
        t = json.loads(line)["text"]
        if t not in seen:
            seen.add(t)
            texts.append(t)
    log(f"unique strings: {len(texts)}")

    trans = {}
    if TRANS.exists():
        trans = json.loads(TRANS.read_text(encoding="utf-8"))
        log(f"resuming with {len(trans)} existing translations")

    todo = [t for t in texts if t not in trans]
    batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
    log(f"batches to translate: {len(batches)}")

    def work(batch):
        for model in MODELS:
            try:
                result = call(model, batch)
                if len(result) >= len(batch) // 2:
                    return result
            except Exception as exc:  # noqa: BLE001
                log(f"  model {model} failed: {str(exc)[:120]}")
        return None

    done_batches = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = {pool.submit(work, b): b for b in batches}
        for fut in as_completed(futs):
            result = fut.result()
            if result:
                with _lock:
                    trans.update(result)
                    done_batches += 1
                    if done_batches % 2 == 0 or done_batches == len(batches):
                        TRANS.write_text(json.dumps(trans, ensure_ascii=False, indent=0), encoding="utf-8")
                        log(f"  {done_batches}/{len(batches)} batches, {len(trans)} translations saved")
            else:
                log("  !! a batch failed on all models (will remain for retry)")

    TRANS.write_text(json.dumps(trans, ensure_ascii=False, indent=0), encoding="utf-8")
    log(f"DONE: {len(trans)}/{len(texts)} translated")


if __name__ == "__main__":
    main()
