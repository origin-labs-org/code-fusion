---
name: Version Management Skill
description:  Skill：。**** .html/.jsx/.tsx/.vue ，**** Skill（），；""""。（、、）。
---

# 

> **：** ** Skill + `send_file` **； Git、。Agent  git 。 git ； tool ，****。

> **：** （git 、meta.json 、），。： + send_file 。，" V{n}"，。

---

## ⚠️ （，）

** Skill ，。** （`.html` / `.jsx` / `.tsx` / `.vue`）， `/{}/` 。

### 

「」****， `send_file`  `file_path`  `//{}/...` 。 `mkdir` / `cd` / ，（）；**** `pwd`  `/...`——「」。

### （）

```bash
# 1. （ §1.2）
# 2. ，
cd {}
mkdir -p "/{}/assets"
# 3. ，【】
cd "/{}"
# 4.  index.html / prototype.html 
# 5.  §1  git / meta.json / send_file 
```

### （，）

- 、`~/Desktop`、`/tmp` ，
- ，
- 

### （）

，：**「， `/{}/` ？」**  → ，，。

---


## 0.  Design Skill （）

 Skill  Design Skill ****（ Design Agent ）：Design Skill ， Skill 。 HTML 。

> ** Design Skill。**  Skill ：****（.html / .jsx / .tsx / .vue） Skill， Design Skill ——、 HTML /（ quality-gate，  → git → meta.json → send_file）。

### （ Design Skill ）

```text
Design Skill  →  skill（portfolio / deck / prototype ）
→ 【】 Skill 「」 /{}/
→  .html / .jsx / .tsx / .vue → 【】/{}/（）
→ quality-gate.md 
→  Skill（ → git → meta.json → send_file）
```

**** Design Skill  quality gate  commit  `send_file`。
**** Design Skill  Skill ， HTML （、、 `/` ）。

### Design Skill  /  Skill 

|  | Design Skill |  Skill |
|------|--------------|----------|
| 、、、 | ✅ | — |
| quality-gate、Design Compliance  | ✅ | — |
| 、assets 、git  | — | ✅ |
| `meta.json`、`send_file`  | — | ✅ |
|  |  | 「 V{n}」 |

### commit 

`git commit -m`  `meta.json`  `summary` ，，：

- `V2:  hero （portfolio）`
- `V3:  V1：（landing-page）`

### 

Design ：`SKILL.md` § Version Management Handoff。、git、`meta.json`、`send_file`  Skill （design 、）。

---

## 0.1 （，）

|  |  |  |
|------|------|----------|
|  HTML （，html） |  OSS ， HTML ， OSS， html  | ****， |
|  |  OSS， tag  | ****， |
|  `.js``.css``assets/` () HTML  |  HTML  OSS  |  |

**Agent ：**  `send_file` ；。

---

## 1. 

### 1.1 

：`.html`、`.jsx`、`.tsx`、`.vue` → ****/（ Skill ）。
 image、doc、ppt、JSON、design spec、 → ，。

**（）：** 「」「 Desktop 」； HTML/。

### 1.2 （）

** web_project  `/{}/` 。 workspace root、Desktop、。**

****：「⚠️ 」，。 commit / `send_file` ****：

1. ****：、
2. **commit / send_file **：； → ** `mv` **，
3. ****：、（ ``、``）

```bash
# （）
cd {}

# (a) （ index.html，prototype.html ）
ls "/{}/"*.html "/{}/"*.jsx \
   "/{}/"*.tsx "/{}/"*.vue 2>/dev/null | grep -q . \
  || { echo "ERROR: /{}/ ， commit / send_file"; }

# (b) 
find . -maxdepth 2 -not -path ".//*" \
  \( -name '*.html' -o -name '*.jsx' -o -name '*.tsx' -o -name '*.vue' \) \
  | while read -r f; do
      echo "STRAY: $f →  mv \"$f\" \"/{}/\" "
    done
```

 ERROR / STRAY → **** commit  `send_file`，。

### 1.3 

**：，（ +  + export ） Git 。**

- ** vs ：** （ JS/CSS），。：
  - 、H5、 →  `index.html`
  - /、 → （ `index.html` + `style.css` + `main.js`）
- **：** `upload/`；：`/{}/assets/`
- ****：`assets/{}`， `upload/` （ OSS ，Agent  OSS ）
- （ `hero-banner.png`），
- `assets/` ** Git **——，，

#### （upload → assets，）

**** HTML  `assets/xxx` （：， `upload/` ）。

1.  `upload/` （、`find upload`、`ls -lt upload` ）
2. `mkdir -p /{}/assets`
3. `cp upload/{} /{}/assets/{}`——`{}`  HTML  `assets/{}` ****（HTML ）
4. / HTML ； cp
5. ****（ MISSING  commit / send_file）：

```bash
cd /{}
grep -ohE 'assets/[a-zA-Z0-9_.-]+' index.html 2>/dev/null | sort -u | while read -r ref; do
  [ -f "$ref" ] || echo "MISSING: $ref"
done
```

6.  MISSING  §3  `send_file`

#### （，）

|  |  | Agent  |  |
|------|----------|------------|------------|
| **** |  HTML  /  HTML |  `upload/` `cp`  `assets/`，； HTML  |  cp、 → ❌； HTML  → ✅ |
| **Agent ** | 、Agent  |  `assets/{}`（ URL）；/ HTML  | ✅ |
| **Agent ** | 、Agent  |  `assets/{}`（ `assets/xxx` ）； HTML | ✅ |

**：**  HTML  `assets/` ，；， MISSING commit。
** HTML ：** /，**** `assets/xxx`； Agent  cp。

#### （）

 `assets/` ，** /  / **：

- ****、**** → **** `assets/`  HTML  `assets/...` ，、、
- 、、 → ， `assets/`（）
- `git add .`  `assets/` （Git ，），

#### 

（ HTML ）， HTML  `/{}/` ， `style-samples.html`；， `style-samples-2.html`、`style-samples-3.html`，。 `index.html` 。 `send_file` 。`style-samples*.html`  `.gitignore` ， Git 、。/。

### 1.4 

（** 1–3 **，「⚠️ 」）：

1. 
2. ；「」：`mkdir -p /`
3.  assets：`mkdir -p /{}/assets`， `cd` ，****
4.  `upload/` cp  `assets/`， HTML； `assets/` 
5. Git ：

```bash
cd /{}
git init
echo -e "meta.json\nstyle-samples*.html" > .gitignore
git add .
git commit -m "V1: {}"
git tag v1
# ↑ ， meta.json， send_file  V1
```

6.  `meta.json`（ §5）
7.  `send_file` （ §3.4），`title` = （ ``）

### 1.5 

```
upload/                  ← （ Git）

/
└── {}/
    ├── .git/
    ├── .gitignore       ←  meta.json  style-samples*.html
    ├── meta.json        ← （ Git）
    ├── style-samples*.html ← ，（ Git，，）
    ├── index.html       ← （ Git，）
    ├── ...              ← （ Git）
    ├── assets/          ← （ Git，）
    └── export/          ← export （ Git，）
```

---

## 2. 

### 2.1 

：

1. 
2.  tab （，）
3.  session 
4.  →  `/` ， `meta.json`，

### 2.2 

 `meta.json`，：「：{}， V{n}」

### 2.3 

。

---

## 3. 

### 3.1 

|  |  |  |
|---------|------|------|
| （） | MD  | MD （） |
| （） | MD  | MD （） |
| （） |  |  |
| 「」 |  | （ §4 ） |

**：。**

： §2 （ >  >  > ）。

：

|  |  |
|------|----------|
| （「 V2 」、「「{}」V2」） |  → §4  |
|  |  |
|  |  |

。；。

#### 

（）， MD  Agent。MD ********，Agent ：

1.  MD  →  `/{}/`
2.  MD  →  `V{n}`
3.  `meta.json`  `latest_version`，：
   - ** = ** →  →  §3.3 
   - ** ≠ （）** → **** §4.4 （ `git checkout v{n} -- .` ，， commit ）。****， Agent ，。
4.  HTML ，
5.  §3.3 / §4.4  git  +  `meta.json` + `send_file`

> **MD 。**  Skill  MD ；、、、 Agent 。

### 3.2 

|  |  |  |
|--------|-------------|------|
|  | ✅ V1 |  |
|  | ✅ |  |
|  | ✅ |  |
|  | ✅ | 、、 |
|  | ✅ |  §4 |
|  | ✅ | §4 ， |
| 、 | ❌ |  `assets/`， commit |
|  Agent  | ✅ |  commit + `send_file` |
| （ `light.html`） | ✅ |  |
|  `style-samples*.html` | ❌ |  Git、， `send_file`  |

### 3.3  Git 

，：

```bash
cd /{}
LATEST_TAG=$(git tag --sort=-v:refname | head -n 1)
NEXT_NUM=$((${LATEST_TAG#v} + 1))
NEXT_TAG="v${NEXT_NUM}"
git add .
git commit -m "V${NEXT_NUM}: {}"
git tag $NEXT_TAG
# ↑ ， meta.json， send_file 
```

### 3.4 （send_file）

， `send_file`。

#### 3.4.1 ：

|  |  |
|------|-----|
| `ext` |  `web_project` |
| `title` | ， ``；****（ `version` ）；（ index、main ） |
| `file_path` | ， `///index.html` |
| `project_name` |  `meta.json`  `project_name`  |
| `version` | ， `V3` |

：
```json
{"title": "", "ext": "web_project", "file_path": "///index.html", "project_name": "", "version": "V3"}
```

#### 3.4.2 （）

** HTML **（ `index.html` + `light.html`，）：

1. ** commit **（`git add .` ）
2. **send_file ：**
   - ****（），
   -  Skill （ prototype ），
   - ： HTML  git 
3. **** `ext=directory` 

（`index.html` ，`light.html` ）：
```bash
#  commit 
git add index.html light.html assets/
git commit -m "V4:  light "
git tag v4
```

send_file ：
```json
{"title": "", "ext": "web_project", "file_path": "///index.html", "project_name": "", "version": "V4"}
```

#### 3.4.3 Prototype （）

 Skill  `prototype.md` （ + ）：

1. **（）**
    HTML （ `prototype.html`  `flow.html`），。
2. **（）**
    `send_file` ****，：
   - ：`prototype.html`
   - ：`flow.html`
3. ****
    `title` ，（title ）：
   - `{}-prototype`
   - `{}-flow`
4. ****
   -  `prototype.html + flow.html` 
   -  prototype 

（ V4，）：
```json
{"title":"-prototype","ext":"web_project","file_path":"///prototype.html","project_name":"","version":"V4"}
{"title":"-flow","ext":"web_project","file_path":"///flow.html","project_name":"","version":"V4"}
```

#### 3.4.4 （，）

 `fixed-image` （、、），：

1. ** HTML**（）→  `/{}/`
2. ** export**  →  `/{}/export/`
3. **：** HTML  `export/`  Git ， commit
4. **send_file （）：**
   - **：**  HTML （`ext: web_project`）
   - **：**  export 
     - ：`ext: `（ `png`、`jpg`），`file_path: //{}/export/xxx.png`
     - （）：`ext: directory`，`file_path: //{}/export/`

**：**
- HTML  export ****
- **（commit）**
-  export 

（，V2）：
```bash
# 
cd /
git add .
git commit -m "V2: "
git tag v2
```

send_file （）：
```json
{"title":"","ext":"web_project","file_path":"///index.html","project_name":"","version":"V2"}
{"title":"-export","ext":"directory","file_path":"///export/"}
```

### 3.5 「」

- ****（ UI ）；Agent 
- **** `send_file` 「」（）
- ，：**「「{}」V{n}」**（：`「」V2`； `V` + ， `send_file.version` ）
- Agent  →  §4 ****（ `V{n}`  `TARGET_TAG=v{n}`）
- ****；（，Agent ）

> **：** 「」；。

---

## 4. 

### 4.1 

****（ + `assets/`  + `export/` ）。`git checkout` ，。

### 4.2 

「」。：

|  |  |
|------|------|
| 「 V2」 | Agent  §4.3  |
| 「 V2 」 | Agent  §4.4 （ +  = ） |
| 「」 | 「「{}」V{n}」→  → Agent  §4.4  |
|  / （） | MD  → Agent  §4.4  |

### 4.3 （，）

 = checkout +  + send_file，。 checkout 。
：

```bash
cd /{}
TARGET_TAG="v{}"
LATEST_TAG=$(git tag --sort=-v:refname | head -n 1)
NEXT_NUM=$((${LATEST_TAG#v} + 1))
NEXT_TAG="v${NEXT_NUM}"
git checkout $TARGET_TAG -- .
git add .
git commit -m "V${NEXT_NUM}:  V{}"
git tag $NEXT_TAG
# ↑ ， meta.json， send_file 
```

**：** （ + `assets/` + `export/`）+ `meta.json` ；。

 Agent ：
- 
- /
- （"， V3 "）
-  `send_file` （ §3.4）。

（V4  V2 →  V5）。。

### 4.4  + （）

：（「「{}」V{n}」）。

**：** ，**** +1 （ V8 →  V9）。****（ `V4-light`、`V4-dark`、`V2-new` ），。****、 tag——，。

：
```bash
cd /{}
TARGET_TAG="v{}"
git checkout $TARGET_TAG -- .
# ↓ （）， commit
LATEST_TAG=$(git tag --sort=-v:refname | head -n 1)
NEXT_NUM=$((${LATEST_TAG#v} + 1))
NEXT_TAG="v${NEXT_NUM}"
git add .
git commit -m "V${NEXT_NUM}:  V{}：{}"
git tag $NEXT_TAG
# ↑ ， meta.json， send_file 
```

---

## 5. meta.json 

，。 `.gitignore` ，。

```json
{
  "project_name": "",
  "latest_version": "v3",
  "is_published": false,
  "published_version": null,
  "domain": null,
  "versions": [
    {
      "id": "v1",
      "timestamp": "2026-05-01T14:30:00+08:00",
      "based_on": null,
      "summary": " + "
    },
    {
      "id": "v2",
      "timestamp": "2026-05-05T10:30:00+08:00",
      "based_on": null,
      "summary": ""
    },
    {
      "id": "v3",
      "timestamp": "2026-05-06T14:30:00+08:00",
      "based_on": "v1",
      "summary": " V1："
    }
  ]
}
```

|  |  |  |
|------|------|------|
| project_name | string | ，Agent ， |
| latest_version | string | （ "v5"） |
| is_published / published_version / domain |  false / null |
| versions[].id | string | （ "v1"） |
| versions[].timestamp | string | （ISO 8601 ） |
| versions[].based_on | string \| null | ，； null |
| versions[].summary | string | Agent  |

---

## 6. 

|  |  |
|--------|--------|
| 「 XX 」 | **** `/{}/` →  → §1 （git init + V1）→ `send_file` |
| 「（prototype）」 | **** →  `prototype.html` + `flow.html` →  commit（ Git）→  §3.4.3  `send_file` |
| 「」（） |  → §3.3  → `send_file` |
| 「 light 」 |  `light.html` →  commit → `send_file`  |
| 「 V2 」 / 「「{}」V2」 | §4  → `send_file` |
|  /  |  MD + →  §3.1  §3.3  §4.4 → `send_file` |
| （`upload/`） | `cp` → `assets/` →  HTML → §1  →  §3.3 |
|  HTML  |  HTML  `cp`； commit， |
| Agent / |  `assets/` →  → §1  → §3.3 |
| 、 |  `assets/`， commit |
| / | ，** assets ** → §3.3 → `send_file` |
| 「 V2」 | §4 （ + assets ）→ `send_file` |
| 「」 |  → §4  → `send_file` |
| ""/"" | （） |
| 「」 |  |
|  |  `/` →  |
|  /  |  HTML →  → export  `export/` →  commit → HTML `send_file` + export `send_file` |
| （「」） |  `style-samples.html` →  `/{}/` → `send_file`  →  →  commit、 |

---

## 7. ：（Agent ）

- **：** HTML  `assets/xxx.png` ； `link` / `script` 
- **：**  OSS ；Agent **** OSS URL
- **Git ：**  + `assets/`  + `export/`  Git；`meta.json`  `style-samples*.html`  `.gitignore` 
- **：**  JS/CSS 、—— §0.1，
