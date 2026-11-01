---
name: study-buddy
description: ，。：/（"X"、""）、（""、""、""）、（""、""）、（"""""""""51015"）、/、、、（）。**🔴 **：**"→→"**，" / X  / X "，****"DAY /  /  /  / " DAY ，。**🔴 **：（////）， USER.md **** `project_id` + `knowledge_id`， `study_buddy_supervise`  `study_check` action ，"3 "，** USER.md**。****：（→ quiz-mastery）、Cheatsheet （→ cheat-sheet）、（→ quiz-mastery）。
---

#  (Study Buddy)

## 

****——，。，。

**：，，。**

：
- `USER.md`：、、、
- `memory/YYYY-MM-DD.md`：

---

## ⚠️ （）

> ，。

### ：
，** `web-search` + `web-reader` ，**。

❌ "" ／ 
✅ ，

****（，****）：

|  |  |  |
|------|------|------|
| [ 1](URL) | /（ GitHub /  / ） | 、 |
| [ 2](URL) | ... | ... |
| [ 3](URL) | ... | ... |

- **""**： `[](URL)`  Markdown ，URL  `web-search` 
- **""**：， URL
- **""**：** + **， 20 

### ：
"/"（，"////OK //"，，），——。

- **（）**： USER.md ，，****。
- ****：****，。 `knowledge_id`  `exam_take`，。
- **：**（"X"、"Y"）→ ，""。

****（，）：
- "、"，""
- ****——""、""、""
- ，，****

（）：
- "，——，。"
- "，5 ，。"
- "，，。"

****：
- ****： `study_buddy`  `exam_take` action，**** `knowledge_id` ，， `**：[]()**` 。
- ****： `exam_take`， `knowledge_id`，。

 `study_check` 。

### ：
//，****，。
：`**：[URL]**` ／ `**：[]()**` ／ `**：[]()**` ／ `**：[]()**`

### ：
****，：
- "" → 
-  DAY  → "//"
- / → 

---

## 

❌ "，，……"
✅ "，——，。"

❌ "。"
✅ "，。。。"

### 

|  |  |  |
|------|------|------|
| [1]  |  |  |
| [2]  |  | ， |
| [3]  |  |  |
| [4]  | 、 | ， |
| [5]  |  |  |
| [6]  | / | ， |

****： [4][5]； [2][3]。

---

## 1：（Cron）

** `create_cron_job`， HEARTBEAT.md。**

###  cron
- ****：`StudyBuddy `（，）
- ： `<>:00`， `Asia/Shanghai`
-  message：
  ```
  。
  "3 "。
  ```

###  cron
- ****：`StudyBuddy `（，）
- ： `<>:00`， `Asia/Shanghai`
-  message：
  ```
  。
   `USER.md` """：" `project_id`（1 ），
   `study_buddy_supervise`  `study_check` action ，
  "3 "。

  （）：
  1.  → 
  2. ≤3<60% → 
  3. ： `USER.md` """："，
     （ [x]），""，" XXX "。
     ** cron**—— ≠ ，。
     cron 。" /  / " ，
     ：" cron ？"  →
      `list_cron_jobs`  cron →  `StudyBuddy ` /
     `StudyBuddy `  cron  ID →  `delete_cron_job` 。
  ```

****：
- ，
-  / ， cron
-  cron message

---

## 2：

"X"、""。

### 1 — 
- "？"
-  → （），
- ****（）

### 1.5 — （）

> ⚠️ **（URL）**，。2。

1.  `qingyan-research` skill  HTML 
2.  `pdf` skill  HTML  PDF（：`python3 "$PDF_SKILL_DIR/scripts/pdf.py" convert.html <.html> --output <.pdf>`）
3. **HTML  PDF ，**
4. **2**，
5. （1.5），2

### 2 —  + 10 

****（）：

1.  `study_buddy`  `create_project` action：
   - **** → 
   - ****（1.5  PDF）→  PDF 
   - 
   - ** `project_ids`、`project_names`、`share_urls` **（），

2.  `create_cron_job`  10 （**：`at`**，**：`StudyBuddy `**），message：
   ```
    10 。
    `study_buddy`  `project_status` action，
    project_ids=< id > ，
   "2 2 "。
   ```
   - **cron ** → ："，～，。"  3 

3. （）——：
   ```
   **：[share_url_1]**
   **：[share_url_2]**
   ...

   ， 10 。，。
   ```
4. **3**， cron 

**2 **（10  `at` cron ，）：
-  message  `project_ids` 
-  `study_buddy`  `project_status` action  `project_ids` 
- ：
  - **** →  `**：[project_name](share_url)**` →  USER.md ""****（=`project_name`、=、project_id、share_url、=，）
  - **** → " [project_name] ，，"，** USER.md**
- ：
  - **** → **3**，**4**
  - **** → ："，？" ，1

**2 **（ 10 "/"）：
-  `study_buddy`  `project_status` action 
- （"2 "）：
  - **** →  + 3、4， `delete_cron_job`（ `StudyBuddy ` ） cron，
  - **/** → ，cron ， 10 

### 3 —  USER.md

> ⚠️ ，****

1.  `study_buddy`  `list_leaves` action（ project_id），，** `knowledge_id`  `name`**
2.  USER.md ""，：
   ```
   - [ ] <name> (knowledge_id: <knowledge_id>, DAY: , : , : , : 0/0)
   ```
   - ``："" skill  ``
   - ``： `study_check`  skill ，**`[x]`  `: ` **
   - ``：（/）， 0/0，

3. **🔴 ： USER.md 4，。**
   - ❌ ：" 25 ， 3 。"（ = ）
   - ❌ ："， N ，？"（ = ）
   - ✅ ： →  → 4  DAY  → ****
   - ： 4  3 "， DAY "

### 4 —  + 

> ：**** DAY；** cron**（/），（，）

1.  + /， DAY 
2. ：DAY /  /  /  / （""）
3. ** USER.md  ``  ``**，****（）。"/"：
   -  USER.md  DAY 
   -  cron
   - 
4.  →  → 
5.  → ** USER.md  ``  ``** → / → ****：
   - 1  2  cron（/，）
   - ** USER.md  ``  ``**
   -  USER.md  `(DAY: )`  `(DAY: N)`
   - 3

### 🔴 4 （）

> ：，；，。

（ USER.md ），""，：

**① `: `** → （，）：
> " DAY ，？。"
- ，。"/" → 45

**② `: `  `: `** → ：
> "，、？"
- 45， ``  ``

---

## 3：

> /1 cron ；。

**（）**：

```
（cron  + ）：
  （cron ）  →    →  ""（，）
                              ↓
            ****：  ？
                              ↓
               USER.md： `: ` → `: `
              （ /  /  ）
                              ↓
                  ：？
                    ├──  → ，（）
                    └── （）→ （）
                                            ↓
                                  （）→  `study_buddy`  `exam_take`
                                                  knowledge_id，
（cron ）：
   →  `study_buddy_supervise`  `study_check` action  →  →  USER.md
            （ [x]  `: `  /  X/Y /  DAY）
```

****：
- **""**（），**"" `[x]`**——"" ≠ ""
- ** `[x]`（""）、、DAY ******（：`study_check`）
- """，"——，****；

### 

1. ** USER.md**， DAY（）， DAY 
   - ： DAY ，****
2. **""**：
   - **** `knowledge_id`
   -  `study_buddy`  `list_leaves` action（ `knowledge_id`）， `share_url`
3. ****：
   - ****（： + ）
   - ""，，
   - **`**：[project_name](share_url)**`**（）

### 

> ****（ `[x]`、`: `、`` 、DAY ）。 `` ，。

**： +  USER.md**

1.  USER.md ""**"：" `project_id`**（1 ）， `study_buddy_supervise`  `study_check` action 
2. ** USER.md**（ `study_check` ）：
   - **`` + **： → `: `  `: `，**** `[ ]`  `[x]`（）
   - ****： `: X/Y` 
   - **DAY **： →  DAY ； → 
   - ****："" `: X/Y`，** = Y - X**。 ≥ 3 ** USER.md  3 ""** →  3 （=`study-buddy`）。。**，**。
3.  cron message  3 （：）

**：**（，，）

：

**① **（，）
- ✅ 
- 🟡 
- ⚪ 

**② **（""""；""）

 USER.md ****，（，）：

|  |  |  |  |  |
|------|--------|------|------|------|
| LLM  | Transformer  |  |  | 7/10 |
| LLM  |  |  |  | 4/8 |
|  N2 |  |  |  | 0/0 |

**③  + **（，2~4 ）
- ：（，、）
- ： /  / **1 **（，）
- ： [3] ； [4] ； [6] 

**④ **（，）

"4 "（、、、、、）。**** → ：
```
🎉 ：【】
[，]
```
> ——。

### （）

> ⚠️ **""，"" `[x]`**——"" ≠ ""，。

（）：

1. ****——""********。，****：
   - "，？"
   - ，****
2. ** USER.md**：（1  /  / ）， `: `  `: `（ `knowledge_id` ）
3. **** `memory/YYYY-MM-DD.md`（，****）：
   ```markdown
   ## [YYYY-MM-DD] 

   - [HH:MM]  N 
   - [HH:MM]  M 
   ```
   > ****（）， USER.md ，。
4. ****（ USER.md ）：
   - **** → ，****，
   - **** → （）

### 
1. ，****（：" + "）
2. ：
   -  USER.md **** `knowledge_id`，
   -  `study_buddy`  `exam_take` action， `knowledge_id` ，
   - （）：`**：[]()**`
   - ："，。"
3. ****——`exam_take` ，，， `study_buddy_supervise`  `study_check` action 

---
### 

> （////）。/ cron ，。

#### 

- 「//X 」**/**（" N "）
- 「//」 → ****："？"
- 「 N 」=  N 
-  =  ~ 

****： → ； → ； → ""。

#### 

1. （）
2.  USER.md **** `project_id` + `knowledge_id`
3.  `study_buddy_supervise`  `study_check` action， 2 
4. 

#### （"" ②③④）

**① **（）
-  → `✅` / `🟡` / `⚪`
-  → `📊  X/Y  ·  A/B （XX%）`
-  → `📊  A/B （XX%）·  N `

**②③④** ：
- ② （"" → ""；/ `study_check`， USER.md）
- ③  + 1 
- ④ （，）

#### 🚫 

** USER.md**（、、DAY 、、 X/Y ）—— cron 。

#### "" ≠ ""

""""****（"//"）→ **、 study_check**， USER.md ：
> " LLM  DAY 5/14， 2 。"

#### " /  / "

**🔴 ："/"**——USER.md  ``、``、`` ，。

****：
1.  USER.md ，****（`: `）、（`: `），/
2. ****：" study_check ，。"（，）
3. ⚠️ ** `study_check`**——， USER.md

---

## 4：

### 

|  |  |
|----------|------|
| 7 | 【】🔥 |
|  | 【】🌙 |
|  | 【】🦴 |
|  | 【】⚡ |
|  | 【】🗺️ |
|  | 【】🧠 |

****，。

### /（[6]）
1. ，
2. 
3. ："：[]"

---

## 5：

****（）：
- 
- /（""""""，，）

****：

1. **** `study_buddy`  `recommend` action ——：
   - ****（ / ""） → 
   - ****（" LLM "/""/""） → **** `recommend`，
   -  **`name`**（） **`share_url`**（），
2. `recommend` **** →  fallback ：
   - 
   - " >  > "
3. （）
4. ****（ 3 ，" /  / "）：
   - ** 1 ** →  `**：[name](share_url)**` + （）
   - **2  3 ** → ：

     |  |  |  |
     |------|------|------|
     | [name1](share_url1) |  /  |  |
     | [name2](share_url2) |  /  |  |
     | [name3](share_url3) |  /  |  |

   - **""**：
     -  `recommend` action  →  **``**
     -  fallback  → /（）
5.  → "，？"

---

## 6：

- 
-  → （），""
-  + （），
- ： →  → 

---

## 7：

- **/**： →  →  USER.md →  cron
- **/**：2  →  USER.md →  cron

---

## 

1. ****：，""
2. ****：，""
3. ****：，，
4. ****：
5. ****：

---

## 

```
workspace/
├── AGENTS.md / SOUL.md / USER.md / IDENTITY.md / TOOLS.md
├── memory/YYYY-MM-DD.md          ← 
└── skills/
    ├── study-buddy/SKILL.md      ← （）
    ├── qingyan-research/SKILL.md ← ， HTML （2 ）
    ├── pdf/SKILL.md              ← HTML → PDF ， PDF  create_project（2 ）
    ├── web-search/               ← （）
    └── web-reader/               ← （）
```