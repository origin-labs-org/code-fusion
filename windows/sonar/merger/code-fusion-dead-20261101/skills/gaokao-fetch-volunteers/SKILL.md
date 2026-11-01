---
name: gaokao-fetch-volunteers
description: >-
   API，//（ API ）
  ， parsed.json。、、 API 。
---

# 

 Skill ****： `student.json`，** API **，， `parsed.json`。

## 

- ****：[gaokao-collect-student-info](../gaokao-collect-student-info/SKILL.md) → `student.json`
- ****：[gaokao-recommend-majors](../gaokao-recommend-majors/SKILL.md)、[gaokao-recommend-schools](../gaokao-recommend-schools/SKILL.md)、[gaokao-generate-report](../gaokao-generate-report/SKILL.md)

## 

```bash
cd gaokao-fetch-volunteers
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## 

### 1. （Agent ）

 `student.json`， [preference_mapping.md](preference_mapping.md) /：

|  |  API |
|------|-----------|
| `preferred_universities` | `universitys` |
| `preferred_provinces` / `preferred_cities` | `provinces` |
| `preferred_tags` | `tags` |
| `preferred_major_classes` | `majorClass` |

：`interests`、`career_direction`、`preferred_cities`、`notes` //。

 Step1 ，；** API **（）。

### 2.  API 

```bash
python3 scripts/build_api_request.py \
  -i output/student.json \
  -o output/api_request.json \
  --summary output/preference_summary.json
```

 `preferred_*`  API ；`preferred_cities`  `provinces`（ `preference_mapping.md`）。

`build_api_request.py`  `province_config.validate_classify`  `classify` 。

### 2.5 （）

 API ， [reference.md](reference.md)  `student.json` / `api_request.json`：

|  |  |
|--------|------|
| `classify` | →/；3+1+2 →/；3+3 →。**** |
| `subjects` | 3+1+2：****（+， `,,`）；3+3：；； |
| `gradeType` | **//**； `null`  |
| `score` | ****（， rank ） |
| `batch` | 「」/「」， batch/list  |
|  | ， |

** batch**： `` / ``， batch/list （ → ``）。 [reference.md](reference.md) 。

### 3.  API（： → ）

```bash
python3 scripts/fetch_volunteers.py \
  --config output/api_request.json \
  -o output/parsed.json
```

（）：

```bash
python3 scripts/fetch_volunteers.py \
  --student output/student.json \
  -o output/parsed.json
```

 `batch/list`  `batch`  `volunteerType`，。 `scripts/province_config.py` 。 `--no-auto-batch` 。

** SOP**：

```
1. GET  batch/list  →   + volunteerType
2. POST intelligenceVolunteer  →   batch / volunteerType 
```

 1  `gradeType`（ score / batch ）。

### 4. 

 `preference_summary.json`  `parsed.json`  `stats`，：

- （///）
- //

## API 

| API  |  |  |
|----------|------|------|
| `universitys` |  | `preferred_universities` |
| `provinces` |  | `preferred_provinces`  |
| `tags` |  | `preferred_tags`（985/211 ） |
| `majorClass` |  | `preferred_major_classes` |

 API  [reference.md](reference.md)。

## （parsed.json）

|  |  |
|------|------|
| `profile` |  |
| `stats` | // |
| `schools_by_type` |  |
| `request` |  API （） |
| `batch_resolution` | 、 |

## 

|  |  |
|------|------|
|  |  `api_request.json`  |
|  |  [reference.md](reference.md)； classify  |
|  | classify （ 3+3 ）—  |
|  | ， |
|  500 |  reference：gradeType/subjects  |
|  subjects | 3+3/3+1+2 ；/ |
| subjects  | 3+1+2 ****（/），, |
|  |  Step1/ `preferred_*`  |

## 

- [preference_mapping.md](preference_mapping.md) —  → API 
- [reference.md](reference.md) — API、、
- [scripts/province_config.py](scripts/province_config.py) —  classify/subjects/gradeType 
- [scripts/test_batch_api.py](scripts/test_batch_api.py) — 31 
- [examples/api_request_shandong.json](examples/api_request_shandong.json) — 
