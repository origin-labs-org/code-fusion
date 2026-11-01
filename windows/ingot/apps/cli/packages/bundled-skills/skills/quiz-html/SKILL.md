---
name: quiz-html
description: ****（HTML ）。 quiz-mastery 「」「」，""， skill ， HTML 。"/HTML/"。****：（→ quiz-mastery）、（→ quiz-mastery）、（→ study-buddy）。
---

#  (Quiz HTML Builder)

 JSON → ** HTML **，：
- 📂 （ / ）+ （ /  / ）
- 🎯 4 ： /  /  / 
- 🤖 ，（）
- ⌨️ （A/B/C/D · Enter ·  · Space）
- 📝 （ +  + ）
- 🌓  · localStorage  · 

## 

###  1：quiz-mastery / ⭐
 skill ****。 `quiz-mastery` ：
- 「」：`generate_from_material.py` →  JSON → `service.import_questions()` 
- 「」：`import_quiz.py` →  JSON → 

quiz-mastery 、，****：
> "～ ？，，、 🎯"

" /  /  /  / " →  skill。
" /  / " → 。

###  2：
：
- ""、" HTML "、""
- ""、""
- " HTML"

## 

### 
```bash
python3 scripts/build_quiz_html.py <JSON> [--title "..." --open]
```

### 

1. ** JSON**（，）
   -  A：quiz-mastery  LLM （）
   -  B：
   -  C：（quiz-mastery  `data/sessions/<sid>/questions.json`）

2. ** JSON **：
   ```python
   import json, tempfile
   from pathlib import Path
   tmp = Path(tempfile.mkdtemp()) / "questions.json"
   tmp.write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")
   ```

3. ****：
   ```bash
   python3 ~/Desktop/studybuddy_4.0/skills/quiz-html/scripts/build_quiz_html.py \
       /tmp/xxx/questions.json \
       --title "📚  · " \
       --output ~/Desktop/quiz__20260518.html \
       --open
   ```

4. ** JSON**：
   ```json
   {
     "success": true,
     "output_path": "/Users/.../quiz_xxx.html",
     "question_count": 8,
     "title": "📚  · ",
     "subtitle": " 8  · ×5 · ×2 · ×1 · ",
     "id": "q_1779091201",
     "size_bytes": 63752
   }
   ```

5. ****： HTML ，「， ✨」

##  JSON 

 quiz-mastery ，**** `category` / `memory_tip`：

|  |  |  |
|---|---|---|
| `type` | ✅ | `single_choice` / `true_false` / `fill_blank` / `short_answer` |
| `prompt` | ✅ | 。 `question` （） |
| `options` |  | `["A. xxx", "B. yyy", ...]` |
| `answer` | ✅ | ； `"True"`/`"False"`；/ |
| `explanation` |  | （，K12 ） |
| `knowledge_point` |  | （） |
| `category` |  | ，**" / "**：`" / "`、`" / "` |
| `level` |  |  1-3 |
| `memory_tip` |  | ，（K12 ） |

### 
```json
[
  {
    "type": "single_choice",
    "prompt": "，（    ）。",
    "options": [
      "A. ",
      "B. ",
      "C. ",
      "D. "
    ],
    "answer": "B",
    "explanation": "，****：I = I₁ + I₂ + ...",
    "knowledge_point": "",
    "category": " / ",
    "level": 1,
    "memory_tip": "🧠 ：、，"
  }
]
```

## 

### 1.  category，
 `category` ，（）。""，。

### 2. category " / "
- ✅ `" / "`、`" / "` →  4  chip
- ❌ `""` →  1 ，，

### 3. 
- `category` = （/），** chips **
- `knowledge_point` = ，****

### 4. 
 JSON ， `quiz_<title_slug>_<>.html`。
** `--output`**， `~/Desktop/` 。

## （quiz-mastery ）

```python
# 1. quiz-mastery ，
questions = [
    {"type": "single_choice", "prompt": "...", "options": [...], "answer": "A",
     "explanation": "...", "knowledge_point": "...", "category": " / "},
    # ...
]

# 2. agent ："？"
# 3. ：""
# 4. agent  +  skill

import json, subprocess, tempfile
from pathlib import Path

tmp_dir = Path(tempfile.mkdtemp(prefix="quiz_"))
qjson = tmp_dir / "questions.json"
qjson.write_text(json.dumps(questions, ensure_ascii=False), encoding="utf-8")

output = Path.home() / "Desktop" / "quiz_.html"

result = subprocess.run([
    "python3",
    str(Path.home() / "Desktop/studybuddy_4.0/skills/quiz-html/scripts/build_quiz_html.py"),
    str(qjson),
    "--title", "📚  · ",
    "--output", str(output),
    "--open",
], capture_output=True, text=True)

info = json.loads(result.stdout)
# info["output_path"] = "/Users/.../Desktop/quiz_.html"
```

：
> 「～  ✨
> ：`~/Desktop/quiz_.html`
> ，，"" 💪」

##  skill 

|  |  |
|---|---|
|  | **quiz-mastery** |
|  | **quiz-mastery** |
| 、、 | **quiz-mastery** |
|  | **quiz-html**（ skill） |
| 、 | **study-buddy** |

## 

- `exit 1`： /  /  → ，
- `exit 2`：JSON  /  → ，
-  skip ：， stderr ，「 N ， XXX」
