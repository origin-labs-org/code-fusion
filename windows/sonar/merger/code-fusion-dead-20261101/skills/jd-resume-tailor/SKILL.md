---
name: jd-resume-tailor
description:  JD ，"JD  + "。 JD 、、； gap ；，、、。" / "" JD"""" X """， JD  + ， skill。** skill ""**—— resume-builder 。
---

# JD ⇄ Resume Tailor（JD  + ）

 skill ：**" JD + ，"**。

：
- （ `resume-builder`）
-  / （ `job-intent-tracker`）
- （ `interview-prep`）

---

## 

：
-  JD  / JD  +  → ****
- ""
- " JD"
- " X  Y ，"
- ""

（）：
-  JD  → "？，（resume-builder）"
- "" → " JD ？ JD  resume-builder "

---

## 

### Step 1:  JD

：
- （）
- （**** fetch， JD ； fetch， web_fetch）
- （ OCR / ，）
- doc/pdf 

：

```bash
python scripts/parse_jd.py --jd-file <jd.txt> --out jd_parsed.json
```

 JD ：
- ** must-have**（"" / "" / " X " ）
- ** nice-to-have**（"" / "" / "" ）
- ****（ /  /  /  ）
- ** + **（" X" / " Y" / " Z"）
- ****（ /  /  /  / ）

，** / **（ must-have ）。

### Step 2: 

：（.pdf / .docx / .md / .txt）。

 skill ：
- pdf → pdf skill
- docx → docx skill

：、、 / （、、、 bullet）、。

### Step 3: Gap 

：

```bash
python scripts/jd_gap.py --jd jd_parsed.json --resume resume.txt --out gap.md
```

：

1. ****（JD must-have ）
2. ****（JD  X， X ， → ""）
3. ****（JD ）

""：
- ****：， → " X ？"
- ****： → ****， cover letter  summary  transferable skill

### Step 4: 

：

**a. **： JD  / （，" / "）

**b.  bullet**：
-  JD "" bullet（ JD " ___ "，""""——）
- （" 100 "，）
-  JD （ JD "A/B "，""，"A/B （）"）

**c.  Summary**： 2~3 ，** JD  must-have**

**d. **： JD （）

**e. **：
- 、、、 —— 
- 、、 —— ，

### Step 5:  + 

：
1. `resume_tailored_<>_<>.md`（）
2. `gap_analysis.md`（gap ）
3.  ATS ：" X% →  Y%"

：** bullet **，。

---

## （）

- ❌ （""——，）
- ❌  JD （ HR ， ATS ）
- ❌ （，HR ）
- ❌ """" → 
- ❌  gap， → ""

##  skill 

- "" →  `interview-prep`， JD + 
- "" →  `job-intent-tracker`
- "，" →  `resume-builder`
