---
name: quiz-mastery
description: 、、、。**""、""、"" skill**。"/"：/PDF/（" PDF "）、（"，"）、（""、""、""、""）、、。**🔴 **：/，****"？"， →  quiz-html skill。****：、（→ study-buddy）。
---

#  (Quiz Mastery)

## 

### ：
1. （.md / .txt / .docx / .pdf / .ppt / .pptx）
2.  `generate_from_material.py`  prompt
3.  prompt  LLM， JSON
4.  `service.save_knowledge_points()` 
5.  `run_quiz.py`  prompt
6.  prompt  LLM， JSON
7. **⭐ **（""）
   -  →  `quiz-html` skill  HTML 
   -  → 
8. ，
9.  `submit_answers.py` 

### ：
1. （.md / .txt / .docx / .pdf / .ppt / .pptx）
2.  `import_quiz.py`  prompt
3.  prompt  LLM， JSON
4.  `service.import_questions()`  session
5. **⭐ **（""）
   -  →  `quiz-html` skill  HTML 
   -  → 
6. ，
7.  `submit_answers.py` 

## （）

1. ****：""、""、""、""、""
2. **""、""、""**：
3. ****：

> ⚠️ ** study-buddy ""**—— study-buddy  `exam_take`， skill。

## 

"" `data/user_progress/` （/）：
- ****——
- ："，？"
- "："

## 

|  |  |  |
|------|------|------|
| L1 |  | ， |
| L2 |  | ，、 |
| L3 |  | ，、 |

- ****： L1 
- ****：（ L3）
- ****：（ L1）

## 

|  |  |  |  |  |
|------|--------|--------|--------|--------|
| L1 | 70% | 30% | - | - |
| L2 | 50% | 20% | 30% | - |
| L3 | 40% | 20% | 20% | 20% |

## 

- ** 3 **（ 3 ，）
-  **15 **（）
- ，（ `needs_review`， LLM/）

## 

- ****： ≥ 3
- ****：，
-  `data/user_progress/`（、）
- ** USER.md  3 ""**（ skill ，=`quiz-mastery`）：
  |  |  |  |  |
  -  → 
  -  → 

## 

， **1 → 2 → 4 → 7 → 15** ：
- ：review_stage +1（）
- ：review_stage  0（）
- ： +  3 

## 

### 1. 

```bash
python3 scripts/generate_from_material.py <file_path> <document_id>
```

 prompt（JSON）， prompts.system_prompt  prompts.user_prompt  LLM。

### 2. 

```bash
python3 scripts/import_quiz.py <file_path> <document_id> <user_id>
```

 prompt（JSON）， prompts.system_prompt  prompts.user_prompt  LLM。

### 3. 

```bash
python3 scripts/run_quiz.py <user_id> <document_id>
```

， prompt（JSON）。

### 4. 

```bash
python3 scripts/submit_answers.py <user_id> <document_id> <session_id> '<answers_json>'
```

：
- `answers_json`：JSON ， `{"q_001": "A", "q_002": "True"}`

：score、total、accuracy、 results。

## （ study-buddy ）

1. （ or ）
2. /
3.  `run_quiz.py`  prompt
4. ** 3 **（，，），
5. （ 3 ）
6.  `submit_answers.py` 
7.  study-buddy， memory 

⚠️ ** skill  USER.md  3 ""**（=`quiz-mastery`）；， `memory/`。 study-buddy 。

## 

```
skills/quiz-mastery/data/
├── knowledge_points/     ← （ document_id）
├── sessions/             ← 
└── user_progress/        ← （、）
```

## ⭐ （ quiz-html ）

 JSON （"" 7、"" 5），****：

> "～ ？，，、 🎯"

### 

|  |  |  |
|---|---|---|
| " /  /  /  /  /  / " | ✅  |  `quiz-html` |
| " /  /  /  / " | ❌  |  |
|  /  |  ❌  | ， |

###  quiz-html 

```python
import json, subprocess, tempfile
from pathlib import Path

# 1.  JSON 
tmp_dir = Path(tempfile.mkdtemp(prefix="quiz_"))
qjson = tmp_dir / "questions.json"
qjson.write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")

# 2. （ ~/Desktop）
output = Path.home() / "Desktop" / f"quiz_{title_slug}.html"

# 3. 
result = subprocess.run([
    "python3",
    str(Path.home() / "Desktop/studybuddy_4.0/skills/quiz-html/scripts/build_quiz_html.py"),
    str(qjson),
    "--title", page_title,        #  "📚  · "
    "--output", str(output),
    "--open",                     # 
], capture_output=True, text=True)

info = json.loads(result.stdout)  # {"success": true, "output_path": "...", ...}
```

### 

，（）：
- `category`：**，**（ 2-6 ）， chip。
  - ✅ ：`` / `` / `` / `` / `` / ``
  - ❌ ：` / 1.（19981229…）` 、//
  - ， `/` ：` / `
- `knowledge_point`：（， quiz-mastery  KP title ，）
- `memory_tip`：（，K12 ）

、、。

### 

|  |  |
|---|---|
| 、 |  skill (quiz-mastery) |
| 、 |  skill (quiz-mastery) |
| ** → ** | **quiz-html** |

 quiz-html ，** quiz-mastery **——， mastery  `submit_answers.py` 。。

