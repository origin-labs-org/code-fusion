#!/usr/bin/env python3
"""
init_tracker.py — 初始化求职投递追踪表

用法：
    python init_tracker.py --format xlsx --output tracker.xlsx
    python init_tracker.py --format md   --output tracker.md

xlsx Mode生成带表头、下拉验证、条件格式的 Excel。
md Mode生成轻量的 Markdown 表格，便于在 Notion / Obsidian / FeishuDocumentation里Paste。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

COLUMNS = [
    "公司",
    "岗位",
    "Source",          # 猎头 / 官网 / inner推 / 招聘网站 / Other
    "JD链接",
    "投递Date",
    "CurrentPhase",       # 投递 / 笔试 / One面 / Two面 / Three面 / HR面 / Offer / Reject / 沉默
    "Next step动作",
    "Deadline",
    "薪资范围",
    "inner推人",
    "备注",
]

STAGE_OPTIONS = [
    "投递", "笔试", "One面", "Two面", "Three面", "HR面", "Offer", "Reject", "沉默",
]

SOURCE_OPTIONS = ["官网", "inner推", "招聘网站", "猎头", "校招", "Other"]


def write_md(path: Path) -> None:
    header = "| " + " | ".join(COLUMNS) + " |"
    sep = "| " + " | ".join(["---"] * len(COLUMNS)) + " |"
    sample = "| Example公司 | Premium产品经理 | inner推 | https://... | 2026-05-07 | 投递 | 等HRFeedback | 2026-05-14 | 40-55k | Zhang San | inner推码 ABC123 |"
    legend_lines = [
        "",
        "## Character段Description",
        "",
        f"- **Source**：{' / '.join(SOURCE_OPTIONS)}",
        f"- **CurrentPhase**：{' / '.join(STAGE_OPTIONS)}",
        "- **Next step动作**：写One句具体可execute的事，比如『5/10 前发感谢Letter』『等 HR Reply，5/15 未回则催』",
        "- **沉默**：超过 7 天没Feedback的Status，提醒自己主动 follow up or放弃",
        "",
    ]
    content = "\n".join([
        "# 投递追踪表",
        "",
        header,
        sep,
        sample,
        *legend_lines,
    ])
    path.write_text(content, encoding="utf-8")
    print(f"✓ Markdown 追踪表已生成：{path}")


def write_xlsx(path: Path) -> None:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.worksheet.datavalidation import DataValidation
        from openpyxl.formatting.rule import CellIsRule
    except ImportError:
        print(
            "✗ Missing openpyxl，请先Install：pip install openpyxl --break-system-packages",
            file=sys.stderr,
        )
        sys.exit(1)

    wb = Workbook()
    ws = wb.active
    ws.title = "投递追踪"

    # 表头
    ws.append(COLUMNS)
    header_fill = PatternFill("solid", fgColor="305496")
    header_font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    # 列宽
    widths = [16, 22, 10, 28, 12, 10, 26, 12, 14, 10, 30]
    for idx, w in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + idx)].width = w

    # Example行
    sample_row = [
        "Example公司",
        "Premium产品经理",
        "inner推",
        "https://example.com/jd/123",
        "2026-05-07",
        "投递",
        "5/14 未回则发邮件 follow up",
        "2026-05-14",
        "40-55k",
        "Zhang San",
        "inner推码 ABC123",
    ]
    ws.append(sample_row)

    # 下拉验证：Source（C 列）
    dv_source = DataValidation(
        type="list",
        formula1=f'"{",".join(SOURCE_OPTIONS)}"',
        allow_blank=True,
    )
    dv_source.add(f"C2:C200")
    ws.add_data_validation(dv_source)

    # 下拉验证：CurrentPhase（F 列）
    dv_stage = DataValidation(
        type="list",
        formula1=f'"{",".join(STAGE_OPTIONS)}"',
        allow_blank=True,
    )
    dv_stage.add(f"F2:F200")
    ws.add_data_validation(dv_stage)

    # 条件格式：F 列 = Offer Green，Reject 灰色，沉默 黄色
    ws.conditional_formatting.add(
        "F2:F200",
        CellIsRule(operator="equal", formula=['"Offer"'],
                   fill=PatternFill("solid", fgColor="C6EFCE")),
    )
    ws.conditional_formatting.add(
        "F2:F200",
        CellIsRule(operator="equal", formula=['"Reject"'],
                   fill=PatternFill("solid", fgColor="D9D9D9")),
    )
    ws.conditional_formatting.add(
        "F2:F200",
        CellIsRule(operator="equal", formula=['"沉默"'],
                   fill=PatternFill("solid", fgColor="FFEB9C")),
    )

    # 冻结首行
    ws.freeze_panes = "A2"

    # 第Two个 sheet：使用Description
    legend = wb.create_sheet("使用Description")
    legend["A1"] = "投递追踪表使用Description"
    legend["A1"].font = Font(bold=True, size=14)
    legend_lines = [
        "",
        "1. 每投递One个岗位，New增One行。",
        "2. 「Source」「CurrentPhase」Yes下拉框，直接选。",
        "3. 「Next step动作」务必写具体可execute的事 + 时间点。",
        "4. Status超过 7 天没动静时，把「CurrentPhase」改成『沉默』，提醒自己跟进or放弃。",
        "5. 拿到 Offer 后，行会变绿；被拒后会变灰，方便区分。",
        "6. 建议Weekly固定One个时间（比如周日晚）回顾One遍这张表。",
        "",
        "如果你想看『有多少在面试Medium / 投递总Count / 沉默率』等统计，",
        "可以让 Claude 帮你做One个看板（artifact）。",
    ]
    for line in legend_lines:
        legend.append([line])

    wb.save(path)
    print(f"✓ Excel 追踪表已生成：{path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="初始化求职投递追踪表")
    parser.add_argument(
        "--format", choices=["xlsx", "md"], default="xlsx", help="Output格式"
    )
    parser.add_argument(
        "--output", required=True, help="Output files路径（含File名）"
    )
    args = parser.parse_args()

    out = Path(args.output).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)

    if args.format == "xlsx":
        write_xlsx(out)
    else:
        write_md(out)


if __name__ == "__main__":
    main()
