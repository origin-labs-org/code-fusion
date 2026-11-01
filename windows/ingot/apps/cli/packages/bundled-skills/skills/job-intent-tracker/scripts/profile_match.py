#!/usr/bin/env python3
"""
profile_match.py — 把UserSkillslist vs 关键词库做匹配，Output匹配度Report

用法：
    python profile_match.py --skills "SQL,Python,产品Planning,A/BTests" \
                            --library internet \
                            [--out report.md]

library 取Value：internet / tech / finance / general
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

LIB_MAP = {
    "internet": "keywords_internet.md",
    "tech": "keywords_tech.md",
    "finance": "keywords_finance.md",
    "general": "keywords_general.md",
}


def extract_keywords(md_path: Path) -> list[str]:
    """简单解析 markdown，把所有 bullet 后面的MediumEnglish词汇CollectFrom来。"""
    text = md_path.read_text(encoding="utf-8")
    # 匹配 - 开头的行
    bullets = re.findall(r"^\s*[-*]\s+(.+)$", text, flags=re.MULTILINE)
    keywords: set[str] = set()
    for line in bullets:
        # 去掉括Numberinner的解释、占位符、markdown 控制Characters
        clean = re.sub(r"[（(][^)）]*[)）]", "", line)
        clean = re.sub(r"_{2,}", "", clean)
        clean = clean.replace("**", "").replace("__", "")
        for token in re.split(r"[、,，/／\s]+", clean):
            token = token.strip().strip("：:。.\"\"''`*").lower()
            # 过滤掉只含Label点 / 短横 / CountCharacter 的词
            if not re.search(r"[One-龥A-Za-z]", token):
                continue
            if 1 < len(token) < 30:
                keywords.add(token)
    return sorted(keywords)


def match_score(user_skills: list[str], lib_keywords: list[str]) -> dict:
    """Back匹配Hit、缺失、Hit率。模糊匹配：包含即算Hit。"""
    user_lower = [s.strip().lower() for s in user_skills if s.strip()]
    hits, missing = [], []
    for kw in lib_keywords:
        if any(kw in u or u in kw for u in user_lower):
            hits.append(kw)
        else:
            missing.append(kw)
    rate = len(hits) / len(lib_keywords) if lib_keywords else 0
    return {
        "hits": hits,
        "missing": missing,
        "rate": rate,
        "user_skills": user_lower,
    }


def render_report(result: dict, library: str) -> str:
    rate_pct = f"{result['rate'] * 100:.1f}%"
    # 缺口前 20 个，避免太Long
    top_missing = result["missing"][:20]
    lines = [
        f"# 岗位画像匹配Report — {library}",
        "",
        f"- **Hit率**：{rate_pct}（{len(result['hits'])} / {len(result['hits']) + len(result['missing'])}）",
        f"- **User提供Skills**：{', '.join(result['user_skills'])}",
        "",
        "## ✅ Hit的关键词",
        "",
        ", ".join(result["hits"]) if result["hits"] else "（无）",
        "",
        "## ⚠️ 缺口（前 20 个，按Character典序）",
        "",
        ", ".join(top_missing) if top_missing else "（无）",
        "",
        "## 解读",
        "",
        "- Hit率 < 20%：方向不匹配，建议重New评估Target岗",
        "- Hit率 20-50%：可投但需要补关键缺口",
        "- Hit率 > 50%：核心匹配，可以重点投",
        "",
        "注意：本ToolsYes关键词级别的粗筛，不能替代真实 JD 对照（用 jd-resume-tailor 做精准对比）。",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skills", required=True, help="UserSkillslist，逗Number分隔")
    parser.add_argument(
        "--library", choices=list(LIB_MAP), required=True, help="关键词库"
    )
    parser.add_argument("--out", help="Output markdown Report路径，缺省直接打印")
    parser.add_argument(
        "--references-dir",
        default=str(Path(__file__).resolve().parent.parent / "references"),
        help="references Table of Contents路径",
    )
    args = parser.parse_args()

    lib_path = Path(args.references_dir) / LIB_MAP[args.library]
    if not lib_path.exists():
        print(f"✗ 找不到关键词库：{lib_path}", file=sys.stderr)
        sys.exit(1)

    lib_keywords = extract_keywords(lib_path)
    user_skills = [s for s in args.skills.split(",") if s.strip()]
    result = match_score(user_skills, lib_keywords)
    report = render_report(result, args.library)

    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
        print(f"✓ Report已生成：{args.out}")
    else:
        print(report)


if __name__ == "__main__":
    main()
