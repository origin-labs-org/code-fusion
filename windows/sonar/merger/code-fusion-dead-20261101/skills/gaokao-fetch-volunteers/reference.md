#  API 

## 

`fetch_volunteers.py` ，：

1. **** `GET /zp/volunteer/batch/list?province=&classify=&score=651`
2. **** `POST /zp/volunteer/intelligenceVolunteer`（ `batch`、`volunteerType`  1 ）

`classify` ：``、``、``、``、``，（）。

： →  `gradeType`/· → 。

 `parsed.json`  `batch_resolution` ，。

## 

|  |  |
|----|-----|
|  | `GET /zp/volunteer/batch/list` |
|  | `province`、`classify`、`score`； `gradeType` |
|  | `{ status, message, result: [{ batch, score, gradeType, type, ... }] }` |

`result[].type`  `volunteerType`（ `MAJOR_GROUP`）。`gradeType` ；****。

## 

|  |  |
|----|-----|
|  | `POST /zp/volunteer/intelligenceVolunteer` |
| Content-Type | `application/json` |
|  | （ skill-test ） |
|  BASE_URL | `https://publicapi.chatglm.cn/chatglm_public/skill-test` |
|  | `{BASE_URL}/zp/volunteer/intelligenceVolunteer` |

## 

|  |  |  |  |
|------|------|------|------|
| province | string | ✓ |  |
| classify | string | ✓ | //// |
| score | integer | ✓ |  |
| batch | string | ✓ | （ batch/list ） |
| subjects | string \| null |  |  |
| gradeType | string \| null |  |  /  |
| rank | integer \| null | |  |
| universitys | string \| null | | ，`,` ； `student.preferred_universities` |
| provinces | string \| null | | ； `preferred_provinces`  `preferred_cities`  |
| tags | string \| null | | ； `preferred_tags`（ 985,211） |
| majorClass | string \| null | | ； `preferred_major_classes` |
| universityNum | integer | | ， 30 |
| majorNum | integer | | ， 6 |
| isAdjust | boolean | |  |
| volunteerType | string | | ACADEMY_GROUP / ACADEMY_MAJOR / MAJOR_GROUP |
| returnUniversityNum | integer | |  |
| intentionNum | integer | |  |

## （）

### （）

|  |  |
|------|-----|
| classify | ``  ``（，//） |
| subjects |  `null`（**** `"null"`） |
| gradeType |  |
| score | ****（， rank ） |

### 3+1+2（23 ）

,,,,,,,,,,,,,,,,,,,,,,

|  |  |
|------|-----|
| classify | ``  ``（ 3+1+2 ） |
| subjects | ****，：`,1,2`。 `classify` ，**** |

：`classify=`，`subjects=,,`（✓）；`subjects=,`（✗ ）

：、、、。
| gradeType |  |

### 3+3（6 ）

,,,,,

|  |  |
|------|-----|
| classify |  `` |
| subjects | ； `` |
| gradeType | ****：`` / `` |

****：/ 750； 900； 660；/ 750； 450。

###  gradeType 

 `batch/list` **** `gradeType`：

```
GET .../batch/list?province=&classify=&score=650&gradeType=
```

：`batch=` → ；`score≤450` → ； → 。

|  | subjects | gradeType |
|------|----------|-----------|
|  | `,,` | `` |
|  |  `"null"`（API ， JSON null） | `` |
| // |  |  |

### 

****， classify  `status=500`，。。

### （）

|  |  |  |
|------|------|------|
| `status=0`  `result=[]` | classify （ ``） |  classify |
|  500（） |  `gradeType` | ， |
|  500（） |  `subjects`  | 3+1+2 ****（/） |
|  500（） | `subjects`  `"null"` |  subjects  |
|  500 | subjects  JSON null  |  `"null"` |

`scripts/province_config.py` ；`scripts/test_batch_api.py`  31 。

### （batch/list ）

|  | batch |
|------|-------|
|  | A |
|  |  |
|  |  |
| 、 | B |
|  |  |
|  | B |
|  |  |
|  | （2222010 ） |

## 

 skill-test  `{ status, message, result }`（`status=0` ），。

```json
{
  "status": 0,
  "message": "success",
  "result": {
    "province": "...",
    "schoolList": [
      {
        "universityName": "",
        "universityCode": "",
        "universityMajorGroup": "",
        "enrollProbability": 20,
        "type": "CHONG",
        "majorList": [ { "majorName": "", "claim": "", "type": "CHONG" } ]
      }
    ]
  }
}
```

 `{ code, msg, body }`（`code=200`）。

`type` ：`CHONG` 、`WEN` 、`BAO` 、`NAN` 、`YI` 。

`score` / `parityScore`  JSON ， `[{"2025":"660,2153,60"}]`（,,）。
