# quiz-html · 

 →  HTML 。

## ✨ 

- 📂 ****：（/） + （//）
- 🎯 **4 **： /  /  / 
- 🤖 ****： ≠ ，；
- ⌨️ ****：A/B/C/D · Enter · ← → · Space
- 📝 ****： +  +  + 
- 🧠 ****： `memory_tip` 
- 🌓 ****： / ，localStorage 
- 💾 ****：，
- 📱 ****：

## 🚀 

```bash
# 1.  JSON （）
cat > /tmp/q.json << 'EOF'
[
  {"type":"single_choice","prompt":"1+1=?","options":["A. 1","B. 2","C. 3"],"answer":"B",
   "explanation":"","category":" / ","level":1}
]
EOF

# 2.  HTML
python3 scripts/build_quiz_html.py /tmp/q.json --title "" --open
```

## 📁 

```
quiz-html/
├── SKILL.md                  # skill （ agent ）
├── README.md                 # （）
├── skill.yaml                # skill 
├── scripts/
│   └── build_quiz_html.py    # 
├── templates/
│   └── quiz_template.html    # HTML （ {{}}）
└── examples/
    └── demo.html             # ： demo
```

## 🔗  quiz-mastery 

 skill ，" → "。
/ `quiz-mastery`。：

```
quiz-mastery 
       ↓
    JSON
       ↓
  ："？"
       ↓ 
   quiz-html  ← 
       ↓
   .html
       ↓
  → 
```

## 📝 

|  |  |  |  |
|---|---|---|---|
| `type` | ✅ | string | `single_choice` / `true_false` / `fill_blank` / `short_answer` |
| `prompt` | ✅ | string |  |
| `options` |  | array | `["A. xxx", "B. yyy", ...]` |
| `answer` | ✅ | string |  |
| `explanation` |  | string | （ `****` `**` `\`  \``） |
| `knowledge_point` |  | string | （） |
| `category` |  | string | ， `" / "` |
| `level` |  | int |  1-3 |
| `memory_tip` |  | string | ， |

## ⌨️ 

|  |  |
|---|---|
| `A` `B` `C` `D` |  |
| `T` `F` |  |
| `Enter` |  |
| `←` `→` |  /  |
| `Space` |  |
| `Ctrl/⌘+Enter` |  |

## 🛠️ 

```
python3 build_quiz_html.py <questions.json> [options]

  --output, -o     HTML （：）
  --title         
  --subtitle      （）
  --id             ID（ localStorage ）
  --open          
```

## 🔍 

|  |  |
|---|---|
| 0 |  |
| 1 |  /  /  |
| 2 | JSON  /  |

## 📌 

|  |  |
|---|---|
|  /  /  | `quiz-mastery` |
|  | `study-buddy` |
| **** | **`quiz-html` ( skill)** |
