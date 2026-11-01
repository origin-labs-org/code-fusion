---
name: resume-builder
description: ， docx / pdf / markdown 。 STAR 、 ATS 、（ /  /  / ）。" /  /  /  /  /  /  /  / "， .pdf/.docx ""， skill。""。
---

# Resume Builder（）

 skill ：

1. ****：
2. **STAR **：" X"，" X  Y， Z"
3. **ATS  + **：， docx/pdf/md

：JD （ jd-resume-tailor ，" JD "）

---

## 

- ""
- " /  / "
- " STAR "
- ""
- " PDF / docx "
- " JD " →  skill；" X  / X " →  jd-resume-tailor

---

## 

### Step 1: 

****（.pdf / .docx / .md / .txt）：
- pdf  pdf skill 
- docx  docx skill 
- ：、、、、、

****：
-  AskUserQuestion （ `references/intake_questions.md` ）
-  3~4 ，，

### Step 2: 

 `references/templates/` ：

-  /  / PM → `templates/internet.md`
-  /  /  → `templates/tech.md`
-  /  /  → `templates/finance.md`
-  /  → `templates/general.md`

，，****："？。"

### Step 3:  STAR 

 `references/star_rewrite_guide.md`， /  STAR 。

**STAR **， bullet ：
- ****（）
- ****（，）
- ****（ /  /  / ）

****，："？""？。"

### Step 4: ATS 

：

```bash
python scripts/ats_check.py --resume <resume.md> \
    --industry internet \
    [--jd <jd.txt>]
```

：
1. 
2. （ job-intent-tracker  skill  `references/keywords/`）
3. " / "
4.  ATS （、、、）

**ATS **：
-  word （ ATS ）
- 
- （ ATS ，）
-  / emoji 
-  /  / Arial / Helvetica 

### Step 5: 

 `references/export_guide.md`，：

**docx **（， HR  docx）：
-  docx skill
-  `assets/resume_template.docx` （）

**pdf **（）：
- ： docx →  word/libreoffice  pdf
-  pdf  reportlab ，
-  pdf skill （ / ）

**markdown **（ + GitHub）：
-  .md 

****：， docx + md 。

### Step 6:  & 

（，）：

```
✓ ：< 1 （）/ ≤ 2 （）
✓ （ + ， GitHub/）
✓ 
✓ （vs <industry> ）：__%
✓ ATS ：__/10
⚠ ：<>
```

---

## （）

- ❌ （" 30%"）—— ， `[：]`
- ❌ （"" "" ""）—— 
- ❌  5  bullet ——  HR 
- ❌ "" —— ，1~2  summary 
- ❌  bullet  —— ，
- ❌ " /  / " —— " X  Y"

##  skill 

- "" →  `jd-resume-tailor`
- "" →  `interview-prep`
-  → "？"， `job-intent-tracker`
