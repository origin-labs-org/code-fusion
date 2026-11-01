#  → API 

Agent ****， `student.json` ，， API 。

## 

| student.json  | API  |  |  |
|-------------------|----------|------|------|
| `preferred_universities` | `universitys` |  | ， `,` |
| `preferred_provinces` | `provinces` |  | ；， `preferred_cities`  |
| `preferred_cities` | `provinces`（） | — | ； `build_api_request.py`  |
| `preferred_tags` | `tags` |  | ， `985,211,` |
| `preferred_major_classes` | `majorClass` |  | ， `,` |

## Agent 

，** student.json **（ Step1 ， Step2  API ）：

###  → `preferred_universities`

、「」「」。

###  → `preferred_cities` + `preferred_provinces`

-  `preferred_cities`
-  `preferred_provinces`（）

→：/→，→，→，/→，→，→。

###  → `preferred_tags`

|  | tags  |
|----------|---------|
| 985 /  | `985` |
| 211 | `211` |
|  | `` |
|  | `` |
|  | `` |
|  | ， tag  ``（ API ） |

###  → `preferred_major_classes`

 `interests`、`career_direction`、`subject_scores` ：

| / |  majorClass |
|--------------|-----------------|
| 、、AI | `,,` |
| 、、 | `,,` |
| 、 | `,,` |
| 、、 | `,,` |
| 、、 | `,,` |
|  | `` |
| 、 | `,,` |

> ；， 5 。

###  → `notes` + 

「」**** `notes`， Skill ；**** `provinces`。

## 

```
student.json（）
    → Agent / preferred_* 
    → build_api_request.py
    → api_request.json
    → fetch_volunteers.py
    → parsed.json
```

## 

：/AI，， 985，。

```json
{
  "preferred_cities": ["", "", ""],
  "preferred_provinces": ["", "", ""],
  "preferred_universities": ["", ""],
  "preferred_tags": ["985", "211"],
  "preferred_major_classes": ["", "", ""]
}
```

 API ：

```json
{
  "universitys": ",",
  "provinces": ",,",
  "tags": "985,211",
  "majorClass": ",,"
}
```
