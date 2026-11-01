# Finance Lite — Simple Budget & Expense Guide

Load this reference for: simple budgets, expense reports, fee tracking, cost summaries, revenue/expense comparison, personal finance, project cost tracking — any financial table that does **NOT** need DCF, LBO, three-statement linkage, sensitivity analysis, or IB-grade formatting.

For complex financial models → use `scenes/finance.md` instead.

Also load `engines/design.md` for styling (use **standard** design tokens, NOT IB overrides).

---

## When to Use finance_lite vs finance

| Signal | finance_lite ✅ | finance.md ❌ |
|--------|----------------|--------------|
|  / budget | ✅ | |
|  / expense report | ✅ | |
|  / project cost tracking | ✅ | |
|  / revenue vs cost | ✅ | |
|  / personal finance | ✅ | |
|  ROI  / simple ROI calculation | ✅ | |
| DCF / LBO /  (valuation model) | | ✅ |
|  (P&L + BS + CF) | | ✅ |
|  / scenario table | | ✅ |
| IB pitch book level formatting | | ✅ |

---

## Standard Sheet Structure

```
Sheet: "Budget" (or user-specified name)
  Row 1: margin (whitespace)
  Row 2: Title (merged, styled via setup_sheet())
  Row 3: spacer
  Row 4: Headers
  Row 5+: Data rows
  Last row: Totals (if applicable)
```

### Typical Column Patterns

**Budget Table:**
```
Category () | Budget Amount () | Actual Amount () | Variance () | Variance Rate () | Notes ()
```

**Expense Report:**
```
Date () | Category () | Description () | Amount () | Claimant () | Status ()
```

**Revenue vs Cost:**
```
Month () | Revenue () | Cost () | Gross Profit () | Gross Margin ()
```

**Project Cost:**
```
Phase () | Task () | Budget () | Used () | Remaining () | Usage Rate () | Status ()
```

---

## Formula Patterns

```python
# Variance
cell.value = '=C{r}-B{r}'  # Actual - Budget

# Variance percentage (safe division)
cell.value = '=IFERROR((C{r}-B{r})/B{r},0)'

# Running total
cell.value = '=SUM(D$5:D{r})'

# Gross margin
cell.value = '=IFERROR((B{r}-C{r})/B{r},0)'

# Status formula (simple threshold)
cell.value = '=IF(F{r}>1,"Over Budget",IF(F{r}>0.9,"At Risk","On Track"))'

# Subtotal
cell.value = '=SUBTOTAL(9,D{start}:D{end})'

# Grand total
cell.value = '=SUM(D5:D{last_data_row})'
```

---

## Number Formats

Use standard formats from `templates/base.py`:

```python
from templates.base import FORMATS

cell.number_format = FORMATS['currency_cny']  # ¥#,##0.00
cell.number_format = FORMATS['percentage']     # 0.0%
cell.number_format = FORMATS['integer']        # #,##0
cell.number_format = FORMATS['date']           # YYYY-MM-DD
```

For budget-specific formatting (negatives in parentheses):
```python
BUDGET_FORMATS = {
    'currency':    '¥#,##0.00;(¥#,##0.00);"-"',
    'variance':    '#,##0.00;(#,##0.00);"-"',
    'var_pct':     '0.0%;(0.0%);"-"',
}
```

---

## Styling

Use **standard** design tokens (NOT IB overrides):

```python
from templates.base import (
    setup_sheet, style_header_row, style_data_row, style_total_row,
    FONT_NAME, HEADER_BOLD, PRIMARY, ACCENT_POSITIVE, ACCENT_NEGATIVE, ACCENT_WARNING,
    font_body, font_header, fill_header,
)

# Setup
setup_sheet(ws, title="2026", last_col=7)

# Headers at row 4
style_header_row(ws, row_num=4, col_start=2, col_end=7)

# Data rows
for i, row_num in enumerate(range(5, last_row + 1)):
    style_data_row(ws, row_num=row_num, col_start=2, col_end=7, row_index=i)

# Totals
style_total_row(ws, row_num=last_row + 1, col_start=2, col_end=7)
```

---

## Conditional Formatting (Simple)

```python
from openpyxl.formatting.rule import CellIsRule
from templates.base import CF_POSITIVE_FONT, CF_POSITIVE_FILL, CF_NEGATIVE_FONT, CF_NEGATIVE_FILL

# Highlight positive variance (green)
ws.conditional_formatting.add(
    f'D5:D{last_row}',
    CellIsRule(operator='greaterThan', formula=['0'],
               font=CF_POSITIVE_FONT, fill=CF_POSITIVE_FILL)
)

# Highlight negative variance (red)
ws.conditional_formatting.add(
    f'D5:D{last_row}',
    CellIsRule(operator='lessThan', formula=['0'],
               font=CF_NEGATIVE_FONT, fill=CF_NEGATIVE_FILL)
)
```

---

## Quick Templates

### Template: Monthly Budget

```python
headers = ["", "", "", "", "", ""]
# Variance = Actual - Budget
# Var% = IFERROR((Actual-Budget)/Budget, 0)
# Status = IF(Var%>0.1,""(Over Budget),IF(Var%>0,""(Watch),""(Normal)))
```

### Template: Expense Report

```python
headers = ["", "", "", "", "", ""]
# Date format: YYYY-MM-DD
# Amount: currency_cny
# Status: dropdown validation [""(Pending),""(Approved),""(Reimbursed),""(Rejected)]
```

### Template: Project Cost Tracker

```python
headers = ["", "", "", "", "", "", ""]
# Remaining = Budget - Used
# Usage% = IFERROR(Used/Budget, 0)
# Status = IF(Usage%>1,""(Over Budget),IF(Usage%>0.9,""(Warning),""(Normal)))
```
