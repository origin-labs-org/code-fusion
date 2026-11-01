---
name: gaokao-generate-report
description: >-
  、、， HTML 。
  、、。
---

# 

 Skill ****： JSON， HTML 。

## 

- ****：
  - `parsed.json`（）
  - `major_recommendation.json`（）
  - `school_recommendation.json`（）
- ****：`volunteer_report.html`

## 

```bash
cd gaokao-generate-report
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## 

### 1.  analysis.json

```bash
python3 scripts/merge_analysis.py \
  --majors output/major_recommendation.json \
  --schools output/school_recommendation.json \
  -o output/analysis.json
```

`merge_analysis.py`  `generate_html.py`  `analysis.json` 。

### 2.  HTML

```bash
python3 scripts/generate_html.py \
  -i output/parsed.json \
  -a output/analysis.json \
  -o output/volunteer_report.html
```

### 3. 

 `volunteer_report.html` ****，：

1. ****（ + ）
2. ****（//，⭐  / 🔥 ）

## 

|  |  |
|--------|------|
|  | `recommended_majors`  name/code  `parsed.json`  |
|  | `recommended_schools`  name/code  `parsed.json`  |
|  | `intro`、`strategy`、`school_strategy`  |

， Skill  JSON。

## 

- [examples/analysis_merged_example.json](examples/analysis_merged_example.json) — 
