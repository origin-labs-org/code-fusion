---
name: portfolio-detail
description: Generate a single-file Chinese atelier-style portfolio website (horizontal-row list + hover-reveal thumb interaction, art lishu typography "Alimama DaoLiTi" via CDN, light/dark theme, hash-routed detail pages). Takes a natural-language description of the studio (name, director, discipline, works) and outputs ONE working .html file. Runs in BOTH Claude Code (writes to ~/Desktop) and GLM / online chat (outputs HTML inline). Trigger phrases include "", "", "lishu-portfolio-gen ...", "", or when user drags this skill folder into chat asking for an atelier-style site.
visibility: public
mode: template
carrier: web-page
scenario: portfolio
pattern_source: reference.html
source_priority: skill-first
triggers:
  - ""
  - ""
  - ""
  - ""
  - ""
related_patterns: vr-canvas, digital-eguide
legacy_gen: true
---

# portfolio-detail —  / （）

## 
 + hover  +  +  + light/dark + hash  + /。

##  skill 

| skill |  |  |
|---|---|---|
| `portfolio-gen` |  + tile  |  /  |
| `portfolio-museum-gen` |  +  +  + （） | // |
| `industrial-archive-gen` |  +  +  |  /  /  |
| **`lishu-portfolio-gen`** | ** + hover  +  + ** | ** /  /  / ** |

「 /  /  /  /  /  /  /  /  / 」——。

## 

：
- " /  / "
- " / "
- "" / " Gurgel D'Alfonso "
- "lishu-portfolio-gen ..."

：
- ****（）：、、、、
- ****（）：URL /  / 。（ picsum ）

**** → 。
**** → ： 1  lead + 3  prose + 6-8  specs + 3-6  picsum  +  credits。（ →  /  →  /  →  /  → ）。

## 

###  A · Claude Code / （）
-  `Bash` 、`sips` 
- ：`~/Desktop/{slug}-portfolio.html`（****， URL）
- ： `~/Desktop/{slug}-portfolio-images/`  src 

###  B · GLM / （）
-  zip  4 
- ** HTML **， ` ```html ` 
-  URL →  `https://picsum.photos/id/{id}/{w}/{h}` （ ID）
- 、

：** Read ** →  B。

## 

|  |  |  |
|---|---|---|
| `reference.html` | **** —  BAIWU 6  | ：list 、prose 、specs 、JSON  |
| `template.html` | **** —  CSS/JS/，2  + 20  SWAP  | ， HTML |
| `README.md` |  |  |
| `SKILL.md` | （） | **** |

****： `template.html`； `reference.html` ****（、、tag ），。

## 

### 1.  HTML
-  `reference.html` ""（ `works-data` JSON  prose ）
-  `template.html`  20  SWAP 

** JS /  CSS /  / **。
SWAP  HTML  JSON 。

### 2. 

：
- **ATELIER_NAME_ZH** — （2-4 ，「」「」「」「」「」）
- **PINYIN** — （5-6 ，：BAIWU / SUYUAN / MOJI）
- **CHAR** — Logo （： /  /  /  / ）
- **CITY** — 
- **DIRECTOR_ZH / DIRECTOR_EN** —  + 
- **DISCIPLINE** — 3 （" ·  · "）
- **TAGLINE** — （20-40 ，）
- **YEAR_FOUNDED** — （： / ）

：
- **slug** — URL ID，（`kong-shan-ji` / `wu-ming-shu`）
- **title_zh** — （2-5 ，）
- **title_en** — （：`An Anthology of Empty Mountains`）
- **year** — （` / 2024` / `2025` / ` / 2025`）
- **tag** — ，， `[  ·  ]` / `[  ·  ]`
- **cover** —  URL
- **list  location** — `， · /`（hover ）
- **meta** — 4 （ 4 ）
- **lead** — 30-70 ， `<em></em>` 
- **prose** — 3-4 ， 80-150 
- **specs** — 6-10 （///////）
- **gallery** — 3-6 ，layout ：`g-wide` / `g-half` / `g-third`
- **credits** — 4-7 /

/ → ****：， lead  prose。 reference.html —  marketing ，「 wall-text + 」（、、、）。

### 3.  + （ A）

```bash
ls -la "{works_path}"
sips -g pixelWidth -g pixelHeight "{works_path}/{file}" 2>/dev/null
```

 (filename, w, h, aspect)。 list （4:3 ，）。

### 4.  20  SWAP

| SWAP |  |  |
|---|---|---|
| 1 | `<title>` | `{ATELIER_NAME} {PINYIN} — {DIRECTOR} / Studio` |
| 2 | meta description |  |
| 3 | curtain  | （「」） |
| 4 | logo SVG  |  SWAP-3 |
| 5 | logo SVG  | `{PINYIN}`  |
| 6 |  li |  3 ： /  /  |
| 7 | brand-block  | `{ATELIER_NAME}` （ `&nbsp;&nbsp;`） |
| 8 | brand-block  | `{PINYIN} Studio · {CITY}` |
| 9 | tagline | ，20-40 ， `<br>`  |
| 10 | **list  N ** |  `<a class="item" href="#work/{slug}">`  num/project-name/en-name/location/photo-thumb |
| 11 | **gallery  N ** |  N ， — slug  list  |
| 12 |  | `&nbsp;&nbsp;{name}<span class="en">About</span>` |
| 13 |  | 1-3 （ /  / ）， 60-120  |
| 14 |  | 4-6  li (Founded/Location/Discipline/Director/Hours) |
| 15 |  | `&nbsp;<span class="en">Get in Touch</span>` |
| 16 |  | 1-2  +  |
| 17 |  | 4-6  (E-mail/Phone/Address/Instagram/) |
| 18 | rotating credit | `Site by {WHO}`（） |
| 19 | footer  | © / ICP /  |
| 20 | **works-data JSON** | **N （！）** |

### 5.  works-data JSON（）

 JSON ，**slug  list/gallery  href  `#work/SLUG` **。

JSON ：
```json
{
  "slug": "kong-shan-ji",
  "title_zh": "",
  "title_en": "An Anthology of Empty Mountains",
  "year": " / 2024",
  "tag": "[  ·  ]",
  "cover": "https://picsum.photos/id/143/1800/1100",
  "meta": [
    {"label": "Type / ", "value": ""},
    {"label": "Year / ", "value": "2024"},
    {"label": "Edition / ", "value": " 320 "},
    {"label": "Format / ", "value": "130 × 195 "}
  ],
  "lead": "。——，<em></em>，。",
  "prose": [
    "： / 。80—150 。",
    "： — 、、。",
    "： / 。"
  ],
  "specs": [
    [" / Format", "130 × 195 "],
    [" / Pages", "144 "],
    [" / Paper", " 90gsm"],
    [" / Binding", ""],
    [" / Typeface", "（）· （）"],
    [" / Printing", ""],
    [" / Edition", " 320 "],
    [" / Price", "¥ 388"]
  ],
  "gallery": [
    {"src": "...", "layout": "g-wide", "caption": ""},
    {"src": "...", "layout": "g-half"},
    {"src": "...", "layout": "g-half"},
    {"src": "...", "layout": "g-third"},
    {"src": "...", "layout": "g-third"},
    {"src": "...", "layout": "g-third"}
  ],
  "credits": [
    [" / Design", ""],
    [" / Binding", "（·）"]
  ]
}
```

**JSON  ⚠️**：
-  prose  →  `「...」`  `"..."`（U+201C / U+201D），**** ASCII `"`（ JSON）
-  JSON ； prose 
- `<em></em>`  lead ** HTML **—— innerHTML 
- gallery `layout` ：`g-wide`（）/ `g-half`（）/ `g-third`（ 1/3）

### 6. 
- **picsum **： `id/X`  `seed/X`（）。 ID：0, 20, 40, 51, 64, 76, 88, 91, 96, 119, 121, 130, 143, 145, 158, 164, 165, 175, 177, 180, 187, 195, 200
-  cover / gallery  ID，
-  `?grayscale` （）

### 7. （）
"" →  2  + ：
- ： /  /  /  /  /  /  / 
- ： /  /  /  /  / 
-  " /  / Studio" ，

### 8. 
 cover  .mp4 / .webm / .mov， `<video autoplay muted loop>`  `<img>`。 cover URL 。

### 9. 

** A**：。
>  ~/Desktop/baiwu-portfolio.html — 6 ，hover ，。Light/Dark ，/。

** B**： HTML  + 。
>  `index.html` 。，。 picsum URL 。

## （）

- ****：`@font-face`  woff2 url（）
- **CSS **：light/dark 
- ** JS**：theme toggle、view mode toggle、hover-row 、rotating credit、 hash  `applyRoute()`、`renderDetail()`
- **`<script id="works-data">`** 
- **`<main id="detail-root">`** （）
- **`body[data-view="home/detail"]`  `body[data-mode="list/gallery"]`** 
- **#logo / #main-menu / .theme-toggle / #project-view / #svp-credit** 

## 

- **slug **：list  `#work/kong-shan-ji` ↔ gallery  `#work/kong-shan-ji` ↔ JSON `"slug": "kong-shan-ji"` —— 
- **JSON **：「」 `"..."`， ASCII `"`
- **gallery **： 6 ，
- **prose **： 80-150 ， 200 
- **list / gallery **：（）
- **picsum seed**： `id/X`  `seed/X`， ID 
- ** < 3 **：， 2 
- ** > 8 **：， list 
- ****： `.detail__prose p:first-of-type::first-letter`  — （ `<em>` ）
- ** picsum **：， CSS  `filter: grayscale()`
