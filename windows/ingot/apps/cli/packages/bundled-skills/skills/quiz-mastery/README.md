# Quiz Mastery Skill

OpenClaw agent //。

## Features

- ****： PDF / Word / Markdown （L1/L2/L3）
- ****：，
- ****： + 
- ****：
- ****： ≥ 3 → （****，）
- ****：（1/2/4/7/15 ）

## Architecture

```
quiz-mastery/
├── SKILL.md                          # Skill metadata (LLM )
├── README.md                         # （）
├── skill.yaml                        # Skill 
├── scripts/
│   ├── generate_from_material.py     # 
│   ├── import_quiz.py                # 
│   ├── run_quiz.py                   #  prompt
│   └── submit_answers.py             #  + 
├── src/quiz_mastery/                 # 
└── data/
    ├── knowledge_points/             # 
    ├── user_progress/                # （、）
    └── sessions/                     # 
```

## Quick Start

### 1. 

```bash
python3 scripts/generate_from_material.py <file_path> <document_id>
```

 prompt（JSON）。 `prompts.system_prompt`  `prompts.user_prompt`  LLM， `service.save_knowledge_points()` 。

### 2. 

```bash
python3 scripts/import_quiz.py <file_path> <document_id> <user_id>
```

 prompt（JSON）。 prompt  LLM ， `service.import_questions()` 。

### 3. 

```bash
python3 scripts/run_quiz.py <user_id> <document_id>
```

， prompt（JSON）。

### 4. 

```bash
python3 scripts/submit_answers.py <user_id> <document_id> <session_id> '<answers_json>'
```

：`score`、`total`、`accuracy`、 `results`。

## （ OpenClaw agent ）

 skill ** `memory/`**， USER.md  3 ""。 agent ， SKILL.md。

|  |  |  |
|------|------|--------|
| 、、 |  skill | `data/`  |
| （ ≥ 3） |  skill | USER.md  3 （=`quiz-mastery`） |
| 、DAY  | study-buddy（ agent） | USER.md  2  |

## 

|  |  |
|------|------|
| L1 | （） |
| L2 | （、） |
| L3 | （、） |

-  L1 
- （ L3），（ L1）

## Workflow

1. **Generate / Import**： + 
2. **Run**：
3. **Submit**： →  →  / 
4. **Sync**： USER.md  3 
