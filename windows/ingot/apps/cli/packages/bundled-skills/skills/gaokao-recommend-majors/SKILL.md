---
name: gaokao-recommend-majors
description: >-
   API ， Agent 、，
   major_recommendation.json。、、。
---

# 

 Skill ****： Agent ，。、、 `parsed.json` ，。

## 

- ****：`student.json` + `parsed.json`（）
- ****：[gaokao-recommend-schools](../gaokao-recommend-schools/SKILL.md)  `major_recommendation.json`

## 

1. `student.json` — 
2. `parsed.json` — // `majors`（ `claim` 、）

## Agent 

1.  [career_reference.md](career_reference.md) （**，**）。
2. 、、、、， 2–4 ****（`major_directions`）。
3.  `parsed.json`  **8–15 **， `recommended_majors`。
4.  `intro`  `strategy`（）。

## 

`recommended_majors`  `university_name`、`university_code`、`major_name`、`major_code`  `parsed.json` ****， 🔥 。

 `parsed.json` 。

## 

 `output/major_recommendation.json`， [examples/major_recommendation_template.json](examples/major_recommendation_template.json)。

```json
{
  "student": { "......" },
  "intro": "（HTML  <strong>）",
  "strategy": "（）",
  "major_directions": [
    { "icon": "🧑‍💻", "title": "...", "match_level": "", "description": "..." }
  ],
  "recommended_majors": [
    {
      "major_name": "...",
      "major_code": "...",
      "university_name": "...",
      "university_code": "...",
      "modal": { "title": "...", "body": "<h4>...</h4><ul>...</ul>" }
    }
  ]
}
```

## 

-  JSON 
-  Top 

## 

- [career_reference.md](career_reference.md) — /
