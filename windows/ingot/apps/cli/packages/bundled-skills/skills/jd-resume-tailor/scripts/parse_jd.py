#!/usr/bin/env python3
"""
parse_jd.py — 解析 JD Text，抽取 must-have / nice-to-have / 职责 / 特殊要求

用法：
    python parse_jd.py --jd-file jd.txt --out jd_parsed.json
    python parse_jd.py --jd-text "..." --out jd_parsed.json

Output JSON Structures供Next step的 jd_gap.py 使用，也可以直接ToUser看。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

MUST_PATTERNS = [
    r"必须", r"必备", r"必要条件", r"硬性要求", r"应当", r"需要", r"需具备",
    r"至少\s*\d+\s*年", r"\d+\+?\s*年以上",
    r"required", r"must\s*have", r"mandatory", r"essential",
    r"minimum\s+\d+\s+years",
]
NICE_PATTERNS = [
    r"加分", r"优先", r"加分项", r"熟悉.+者优先", r"有.+经验者优先",
    r"preferred", r"nice\s*to\s*have", r"plus", r"bonus", r"desirable",
]
ACTION_VERBS = [
    "负责", "主导", "推动", "Design", "搭建", "构建", "优化", "Planning", "迭代",
    "孵化", "复盘", "Operations", "Manage", "协调", "execute", "驱动", "落地", "重构",
    "lead", "drive", "build", "design", "architect", "develop", "implement",
    "optimize", "manage", "coordinate", "execute", "own",
]


def split_sentences(text: str) -> list[str]:
    # Chinese按 。！？; 拆，English按 . ; 拆，并Retain bullet 行
    raw = re.split(r"[。！？!?；;\n]+", text)
    return [s.strip(" \t-•·*") for s in raw if s.strip()]


def classify_sentences(sentences: list[str]) -> dict:
    must, nice, resp, others = [], [], [], []
    for s in sentences:
        s_low = s.lower()
        if any(re.search(p, s_low) for p in NICE_PATTERNS):
            nice.append(s)
        elif any(re.search(p, s_low) for p in MUST_PATTERNS):
            must.append(s)
        elif any(v in s_low for v in ACTION_VERBS):
            resp.append(s)
        else:
            others.append(s)
    return {"must": must, "nice": nice, "responsibilities": resp, "others": others}


def extract_special(text: str) -> dict:
    out: dict[str, str] = {}

    # 学历
    edu = re.search(r"(本科|硕a|博a|大专)(?:及以上|以上)?", text)
    if edu:
        out["education"] = edu.group(0)

    # 工作年限
    years = re.search(r"(\d+)\s*[-~–到至]\s*(\d+)\s*年|(\d+)\s*\+?\s*年(以上|及以上)?", text)
    if years:
        out["years"] = years.group(0)

    # 语言
    lang_pat = re.search(
        r"(英语\s*(口语)?\s*(流利|熟练|母语)|CET[-\s]?[46]|雅思\s*\d(\.\d)?|托福\s*\d{2,3}|母语水平|business\s*english)",
        text,
        flags=re.IGNORECASE,
    )
    if lang_pat:
        out["language"] = lang_pat.group(0)

    # City
    cities = re.findall(
        r"(Beijing|上海|广州|深圳|杭州|南京|苏州|成都|武汉|西安|香港|New加坡|remote|hybrid|Remote|海outer)",
        text,
        flags=re.IGNORECASE,
    )
    if cities:
        out["location"] = "/".join(sorted(set(c.lower() for c in cities)))

    # 出差 / 加班LetterNumber
    travel = re.search(r"(出差|派驻|常驻|Project制|加班|999|996|大小周)", text)
    if travel:
        out["working_style"] = travel.group(0)

    # 证书
    certs = re.findall(
        r"(CFA(?:\s*Level\s*[I123]+)?|CPA|FRM|ACCA|PMP|AWS\s*[\w\s]*认证|Azure\s*[\w]*|GCP\s*[\w]*)",
        text,
        flags=re.IGNORECASE,
    )
    if certs:
        out["certificates"] = "/".join(sorted(set(c.strip() for c in certs)))

    return out


def extract_skills(sentences: list[str]) -> list[str]:
    """从所有句子里抽取Skills词候选（短词优先，避免抽出整句）。"""
    text = " ".join(sentences)
    # EnglishSkills（CamelCase or大写开头的词、含 . or +/- 的Label识）
    en = re.findall(r"\b[A-Za-z][A-Za-z0-9+/.\-_#]{1,20}\b", text)
    # Chinese 2~5 Character常见Skills词
    zh = re.findall(r"[One-龥]{2,5}", text)
    raw = en + zh

    stop = {
        # Chinese虚词 / 通用动词
        "公司", "我们", "你k", "Team", "需要", "能够", "具备", "熟悉", "了解",
        "良OK", "优秀", "经验", "Capabilities", "岗位", "职责", "要求", "以上", "E关",
        "进行", "Completed", "负责", "推动", "Implementation", "提升", "并且", "包括", "以下",
        "工作", "Project", "业务", "及其", "or者", "or", "与", "及", "的", "了",
        "并", "对", "在", "等", "以", "等等", "Passed", "k", "其", "之", "至",
        "至上", "本科", "硕a", "博a", "者优先", "根据", "进行", "支持", "参与",
        "主导", "提供", "建立", "搭建", "Design", "驱动", "决策", "Analytics", "推动",
        "迭代", "Planning", "Operations", "协作", "跨部门", "跨Team", "Premium", "资深",
        "若干", "多种", "多元", "多类",
        # English虚词
        "and", "the", "with", "for", "of", "or", "to", "be", "as", "an", "is",
        "are", "in", "on", "at", "by", "all", "you", "we", "us", "our", "your",
        "a", "an", "this", "that", "these", "those", "it", "its",
    }
    # 含CountCharacter的"X年""X个"也过滤
    digit_only = re.compile(r"^\d+$")

    seen = set()
    out = []
    for token in raw:
        key = token.lower()
        if key in seen or token in stop or len(token) < 2 or digit_only.match(token):
            continue
        # Chinese token 不Allow全Yes stop 词的子串
        seen.add(key)
        out.append(token)
    return out[:60]


def main() -> None:
    parser = argparse.ArgumentParser()
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--jd-file", help="JD TextFile路径")
    src.add_argument("--jd-text", help="直接传 JD Text")
    parser.add_argument("--out", help="Output JSON 路径，缺省打印")
    args = parser.parse_args()

    if args.jd_file:
        path = Path(args.jd_file).expanduser()
        if not path.exists():
            print(f"✗ JD File不存在：{path}", file=sys.stderr)
            sys.exit(1)
        text = path.read_text(encoding="utf-8")
    else:
        text = args.jd_text

    sentences = split_sentences(text)
    classified = classify_sentences(sentences)
    special = extract_special(text)
    skills = extract_skills(classified["must"] + classified["responsibilities"])

    result = {
        "must_have": classified["must"],
        "nice_to_have": classified["nice"],
        "responsibilities": classified["responsibilities"],
        "skills_extracted": skills,
        "special_requirements": special,
        "raw_sentence_count": len(sentences),
    }

    payload = json.dumps(result, ensure_ascii=False, indent=2)
    if args.out:
        out_path = Path(args.out).expanduser()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(payload, encoding="utf-8")
        print(f"✓ JD 解析Result已Save：{out_path}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
