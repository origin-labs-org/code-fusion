#  API 

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
| batch | string | ✓ |  |
| subjects | string \| null |  |  |
| gradeType | string \| null |  |  /  |
| rank | integer \| null | |  |
| universitys | string \| null | | ，`,`  |
| provinces | string \| null | |  |
| tags | string \| null | |  |
| majorClass | string \| null | |  |
| universityNum | integer | | ， 30 |
| majorNum | integer | | ， 6 |
| isAdjust | boolean | |  |
| volunteerType | string | | ACADEMY_GROUP / ACADEMY_MAJOR / MAJOR_GROUP |
| returnUniversityNum | integer | |  |
| intentionNum | integer | |  |

## 

 [gaokao-fetch-volunteers/reference.md](../gaokao-fetch-volunteers/reference.md) 。 `student.json`  `classify` / `subjects` / `gradeType`：

|  |  | classify | subjects | gradeType |
|------|------|----------|----------|-----------|
|  |  | / |  |  |
| 3+1+2 | 23 | / | ****（， `,,`） |  |
| 3+3 |  |  | （） | ：/ |

****：。 ****：score ， rank。

** batch（， batch/list API）**：

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
