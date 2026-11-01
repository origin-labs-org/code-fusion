#!/usr/bin/env python3
"""
build_quiz_html.py - 把题目 JSON 注入到Template HTML，生成可Run independently的练习Web。

用法：
    python3 build_quiz_html.py <questions_json> [options]

参Count：
    questions_json   题目 JSON File路径（Required）
                     格式：题目Array，每题Character段见下方"题目Character段"

选项：
    --output <path>  Output HTML 路径（Default：./quiz_<timestamp>.html）
    --title <str>    PagesTitle（Default："题库练习"）
    --subtitle <str> 副Title（Default根据题量Auto生成）
    --id <str>       题库Label识 ID（用于 localStorage Isolated，Default时间戳）
    --open           生成后Auto用Browser打开

题目Character段（来自 quiz-mastery 的Label准 JSON 格式）：
    type            single_choice | true_false | fill_blank | short_answer
    prompt          题干（Required）
    options         选项Array，仅 single_choice 用，格式 ["A. xxx", "B. yyy", ...]
    answer          Label准Answer
    explanation     解析（推荐填，K12 Student很需要）
    knowledge_point 知识点名（用于Sidebargrouping）
    category        分类路径（推荐用"学科 / 子模块"，如"物理 / 电学"）
    level           难度 1-3（Optional）
    memory_tip      Memory口诀（Optional，会用橙色卡片High亮Show）

Exit码：
    0   成功
    1   参CountError / File不存在
    2   JSON 解析Failed / Data格式不对
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import webbrowser
from pathlib import Path
from typing import Any


SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_PATH = SKILL_DIR / "templates" / "quiz_template.html"

REQUIRED_FIELDS = {"type", "prompt", "answer"}
VALID_TYPES = {"single_choice", "true_false", "fill_blank", "short_answer"}


def load_questions(path: Path) -> list[dict[str, Any]]:
    """加载题目 JSON，做基本格式校验。"""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as e:
        print(f"❌ 无法ReadFile：{path} - {e}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"❌ JSON 解析Failed：{e}", file=sys.stderr)
        sys.exit(2)

    if not isinstance(data, list):
        print(f"❌ 题目必须YesArray（list），得到 {type(data).__name__}", file=sys.stderr)
        sys.exit(2)

    if not data:
        print("❌ 题目Array为空", file=sys.stderr)
        sys.exit(2)

    cleaned: list[dict[str, Any]] = []
    for i, q in enumerate(data, 1):
        if not isinstance(q, dict):
            print(f"⚠️ 第 {i} 题不Yes对e，已Skip", file=sys.stderr)
            continue
        miss = REQUIRED_FIELDS - set(q.keys())
        if miss:
            # 容忍 quiz-mastery Output里 prompt 写成 question 的OldCharacter段
            if "prompt" in miss and "question" in q:
                q["prompt"] = q["question"]
                miss.discard("prompt")
        if miss:
            print(f"⚠️ 第 {i} 题缺Character段 {miss}，已Skip", file=sys.stderr)
            continue
        if q.get("type") not in VALID_TYPES:
            print(f"⚠️ 第 {i} 题 type 非法：{q.get('type')}（应为 {VALID_TYPES}），已Skip", file=sys.stderr)
            continue
        # 单选题校验：options 必须存在
        if q["type"] == "single_choice" and not q.get("options"):
            print(f"⚠️ 第 {i} 题（选择题）缺 options，已Skip", file=sys.stderr)
            continue
        cleaned.append(q)

    if not cleaned:
        print("❌ 没有任何合法题目", file=sys.stderr)
        sys.exit(2)

    return cleaned


def auto_subtitle(questions: list[dict[str, Any]]) -> str:
    """根据题目Auto生成副Title：题量 + 涉及分类。"""
    cats = sorted({(q.get("category") or "").strip() for q in questions if q.get("category")})
    type_count: dict[str, int] = {}
    for q in questions:
        t = q.get("type", "?")
        type_count[t] = type_count.get(t, 0) + 1
    type_names = {
        "single_choice": "选择",
        "true_false": "判断",
        "fill_blank": "填空",
        "short_answer": "简Answer",
    }
    breakdown = " · ".join(f"{type_names.get(t, t)}×{n}" for t, n in type_count.items())
    parts = [f"共 {len(questions)} 题"]
    if breakdown:
        parts.append(breakdown)
    if cats:
        # 提取顶级学科（按 "/" 拆）
        top_cats = sorted({c.split("/")[0].strip() for c in cats if c})
        if top_cats:
            parts.append("、".join(top_cats))
    return " · ".join(parts)


def render(questions: list[dict[str, Any]], title: str, subtitle: str, qid: str) -> str:
    """把题目Data注入Template。"""
    if not TEMPLATE_PATH.exists():
        print(f"❌ TemplateFile不存在：{TEMPLATE_PATH}", file=sys.stderr)
        sys.exit(1)

    html = TEMPLATE_PATH.read_text(encoding="utf-8")

    meta = {"id": qid, "title": title, "subtitle": subtitle}
    quiz_json = json.dumps(questions, ensure_ascii=False)
    meta_json = json.dumps(meta, ensure_ascii=False)

    # 顺序替换，避免 title/subtitle inner含 {{...}} 时被Two次解释
    html = html.replace("{{TITLE}}", _safe(title))
    html = html.replace("{{SUBTITLE}}", _safe(subtitle))
    html = html.replace("{{QUIZ_DATA}}", quiz_json)
    html = html.replace("{{META}}", meta_json)
    return html


def _safe(s: str) -> str:
    """HTML 安全转义（仅用于 title/subtitle 这种Plain text占位符）。"""
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _slug(s: str) -> str:
    """生成File名安全的 slug。"""
    s = re.sub(r"[^\w\u4e00-\u9fa5-]+", "_", s).strip("_")
    return s[:40] or "quiz"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="把题目 JSON 注入Template，生成可Run independently的练习Web",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("questions", type=Path, help="题目 JSON File路径")
    ap.add_argument("--output", "-o", type=Path, help="Output HTML 路径")
    ap.add_argument("--title", default="📚 题库练习", help="PagesTitle")
    ap.add_argument("--subtitle", default=None, help="副Title（DefaultAuto生成）")
    ap.add_argument("--id", dest="qid", default=None, help="题库 ID（用于 localStorage Isolated）")
    ap.add_argument("--open", action="store_true", help="生成后Auto用Browser打开")
    args = ap.parse_args()

    if not args.questions.exists():
        print(f"❌ File不存在：{args.questions}", file=sys.stderr)
        return 1

    questions = load_questions(args.questions)
    title = args.title
    subtitle = args.subtitle or auto_subtitle(questions)
    qid = args.qid or f"q_{int(time.time())}"

    html = render(questions, title, subtitle, qid)

    # Output路径：Default到题目File同Table of Contents
    if args.output:
        output = args.output
    else:
        ts = time.strftime("%Y%m%d_%H%M%S")
        output = args.questions.parent / f"quiz_{_slug(title)}_{ts}.html"

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")

    # Output统One JSON，方便 agent 解析
    result = {
        "success": True,
        "output_path": str(output.resolve()),
        "question_count": len(questions),
        "title": title,
        "subtitle": subtitle,
        "id": qid,
        "size_bytes": output.stat().st_size,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

    if args.open:
        webbrowser.open(f"file://{output.resolve()}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
