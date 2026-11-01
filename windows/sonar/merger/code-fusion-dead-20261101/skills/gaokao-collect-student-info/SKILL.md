---
name: gaokao-collect-student-info
description: >-
  ：，、、 API 、
  、，， student.json。
  、、。
---

# 

 Skill ****， `student.json`， API、。

## ：

**，。** 、****， gap。

|  |  |
|------|------|
| ✅  | `interests`、`family_situation`、`career_direction`、`notes` ，****，、、 |
| ✅  | 、、； `notes` ，「」 |
| ✅  | `province`、`score`、`classify`、`subjects`  API ，（、） |
| ✅  | `preferred_*` ****、、、； |
| ❌  | 「」「」；；/ |

，****，。

## 

- ****：
- ****：[gaokao-fetch-volunteers](../gaokao-fetch-volunteers/SKILL.md)  Skill ， API 

## 

### API （ `student.json` ）

|  |  |  |
|------|------|------|
| `province` |  |  |
| `classify` | //// |  |
| `score` | （） | 650 |
| `batch` |  |  |
| `subjects` | 3+1+2：****（+）；3+3：； `null` | `,,` |
| `gradeType` | //：/ |  |
| `rank` | ， `null` | 5000 |

### （，）

|  |  |  |
|------|------|----------|
| `interests` |  | ****，， |
| `family_situation` |  | ****，、、 |
| `career_direction` | / | ****，， |
| `subject_scores` |  | ， |
| `preferred_cities` |  | **** |
| `preferred_provinces` |  | ；， |
| `preferred_universities` |  | ****， |
| `preferred_tags` |  | ****（「 985」）， |
| `preferred_major_classes` |  | ****/， |
| `notes` |  | ****、、 |

 API  [gaokao-fetch-volunteers](../gaokao-fetch-volunteers/SKILL.md) ；**** API  `preferred_*`。

## 

1. ，；。
2. ** API **（ [reference.md](reference.md)）。
3. ****； API 。
4.  `output/student.json`，****。

###  classify / subjects / gradeType（SOP）

|  |  | classify | subjects | gradeType |
|------|------|----------|----------|-----------|
|  |  |  ****  | `null`（） | `null` |
| 3+1+2 |  |  ****  | ****：`,,`（，） | `null` |
| 3+3 |  | ****（/） | ； `` | ：``/`` |

****：

- ****（），****（3+1+2），（3+3  `classify=`）。
- **3+1+2  `subjects` **（）， `classify` ，、。
- ****（ 450 ）。
-  **score**；。
- ****：，。
- `batch` 「」， batch/list 。

## 

 [examples/student_template.json](examples/student_template.json)、[examples/student_shandong.json](examples/student_shandong.json)。

```json
{
  "province": "",
  "classify": "",
  "subjects": ",,",
  "score": 650,
  "batch": "",
  "rank": null,
  "gradeType": null,
  "interests": "，",
  "career_direction": "，",
  "family_situation": "，",
  "preferred_cities": ["", "", ""],
  "preferred_provinces": ["", "", ""],
  "preferred_universities": [""],
  "preferred_tags": ["985", "211"],
  "preferred_major_classes": ["", ""],
  "notes": ""
}
```

## 

- `batch`  batch/list ，「」。
- **classify **（：）。 [gaokao-fetch-volunteers/reference.md](../gaokao-fetch-volunteers/reference.md)。
- （） `notes`，**** `preferred_provinces`，。
- ****， Agent 。
- 。

## 

- [reference.md](reference.md) —  batch 
- [preference_mapping.md](../gaokao-fetch-volunteers/preference_mapping.md) —  → API 
