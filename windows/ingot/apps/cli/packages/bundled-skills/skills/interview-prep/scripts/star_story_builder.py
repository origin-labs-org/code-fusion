#!/usr/bin/env python3
"""
star_story_builder.py — 从简历Text里抽出工作 / Project经历，生成"故事矩阵"骨架

用法：
    python star_story_builder.py --resume resume.md --out stories.md

OutputOne份 markdown，包含：
- 检测到的 N 个经历（按时间倒序）
- 每个经历的 STAR 骨架占位（让User / ModelComplete）
- 每个故事可以Answer的行为题清单
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


COMMON_BEHAVIORAL_QUESTIONS = {
    "ownership": [
        "讲One次你 ownership 体现得最Okay经历",
        "你做过的最有成就感的Project",
        "讲One次你主动推动事情",
    ],
    "collab": [
        "讲One次你跨部门 / 跨Team推动事情",
        "讲One次你and同事意见不合，怎么解决",
        "讲One次你说服别人改变想法",
    ],
    "challenge": [
        "讲One次你在资源 / 时间不足下CompletedTarget",
        "讲One次你做艰难决策的经历",
        "讲One次你打破常规 / 创New的经历",
    ],
    "failure": [
        "讲One次你Failed / 没达成Target的经历",
        "讲One次你犯过的最大Error",
        "讲One次接到负面Feedback，怎么应对",
    ],
    "learning": [
        "讲One次你Fast学会全New领域的经历",
        "你Recent学到的最重要的事Yes什么",
    ],
}


def load_resume_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".md", ".txt"}:
        return path.read_text(encoding="utf-8")
    if suffix == ".docx":
        try:
            from docx import Document
        except ImportError:
            print("✗ Missing python-docx", file=sys.stderr)
            sys.exit(1)
        return "\n".join(p.text for p in Document(str(path)).paragraphs)
    print(f"✗ 暂不支持 {suffix}", file=sys.stderr)
    sys.exit(1)


def extract_experiences(text: str) -> list[dict]:
    """
    简易抽取：找形如 "公司 | 岗位 | 时间" or "Project名 | ..." 的行作为锚点，
    然后取该行后面、下One个锚点之前的inner容作为经历inner容。
    """
    lines = text.splitlines()
    experiences: list[dict] = []
    current = None

    # 匹配锚点（含 | or ｜，且包含Date/年份）
    anchor_re = re.compile(
        r"^(?P<title>[^\n]+?[|｜][^\n]+?[|｜][^\n]+)$"
    )

    for line in lines:
        if anchor_re.match(line.strip()):
            if current and current["bullets"]:
                experiences.append(current)
            current = {"title": line.strip(), "bullets": []}
        else:
            stripped = line.strip()
            if current and stripped.startswith(("-", "*", "•")):
                current["bullets"].append(stripped.lstrip("-*• "))
    if current and current["bullets"]:
        experiences.append(current)

    return experiences


def categorize_story(bullets: list[str]) -> list[str]:
    """根据 bullet 关键词，判断这个故事最适合Answer哪One类行为题。"""
    text = " ".join(bullets).lower()
    cats = []
    if any(k in text for k in ["主导", "owner", "推动", "drive", "lead", "0-1"]):
        cats.append("ownership")
    if any(k in text for k in ["跨部门", "跨Team", "协作", "对接", "合作"]):
        cats.append("collab")
    if any(k in text for k in ["Urgent", "时间紧", "资源", "决策", "突破"]):
        cats.append("challenge")
    if any(k in text for k in ["Failed", "下线", "回滚", "复盘", "教训", "踩坑"]):
        cats.append("failure")
    if any(k in text for k in ["New", "学习", "陌生", "首次", "从零"]):
        cats.append("learning")
    return cats or ["ownership"]


def render(experiences: list[dict]) -> str:
    if not experiences:
        return (
            "# 故事矩阵（未检测到经历）\n\n"
            "无法从简历里Auto抽取出工作 / Project经历。可能Yes因为：\n"
            "1. 简历格式不Yes `公司 | 岗位 | 时间` 的常见Structures\n"
            "2. 经历用Normal paragraph写，没有明显的锚点\n\n"
            "建议：手工告诉我你最有代表性的 3~5 段经历，我来帮你做 STAR 拆解。\n"
        )

    out = ["# 故事矩阵（Story Matrix）", ""]
    out.append(f"从简历里检测到 {len(experiences)} 段经历，按 STAR 拆解如下。")
    out.append("**请Supplement每个 STAR Section里 `[占位]` 的inner容**，PreparationOK后这些故事可以覆盖 80% 的行为面Issue。")
    out.append("")

    for idx, exp in enumerate(experiences[:8], start=1):
        cats = categorize_story(exp["bullets"])
        out.append(f"## 故事 {idx}：{exp['title']}")
        out.append("")
        out.append("**简历Raw bullet：**")
        for b in exp["bullets"][:5]:
            out.append(f"- {b}")
        out.append("")
        out.append("**STAR 拆解（请Complete）：**")
        out.append("- **S（背景）**：[占位 - One句话点明背景 / 痛点]")
        out.append("- **T（Task）**：[占位 - 你的具体TaskandTarget]")
        out.append("- **A（动作）**：[占位 - 分 2~4 步，每步带动词 + 决策依据]")
        out.append("- **R（Result）**：[占位 - 量化Result + One句反思]")
        out.append("")

        question_pool = []
        for cat in cats:
            question_pool.extend(COMMON_BEHAVIORAL_QUESTIONS.get(cat, []))
        out.append(f"**最适合Answer的行为题（{', '.join(cats)}）：**")
        for q in question_pool[:4]:
            out.append(f"- {q}")
        out.append("")
        out.append("---")
        out.append("")

    out.append("## 使用建议")
    out.append("")
    out.append("- 把每个故事的 STAR Section填OK，每段控制在 30~90 秒讲完")
    out.append("- 面试时灵活组合：同One个故事可以从不同角度Answer不同题")
    out.append("- 至少Preparation **3 个Complete故事**（成功 + Failed + 协作 各One个），覆盖 80% 行为题")
    out.append('- 每个故事里Emphasis「我」做了什么，避免大量「我们」')
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", required=True)
    parser.add_argument("--out")
    args = parser.parse_args()

    resume_text = load_resume_text(Path(args.resume).expanduser())
    experiences = extract_experiences(resume_text)
    report = render(experiences)

    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")
        print(f"✓ 故事矩阵已生成：{args.out}")
    else:
        print(report)


if __name__ == "__main__":
    main()
