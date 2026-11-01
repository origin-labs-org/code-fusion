---
name: industrial-archive
description: Generate a single-file industrial-archive product landing page (Nordic museum aesthetic, hash-routed detail pages). Takes a natural-language description of one or more "exhibit-style" products (objects, tools, hardware, watches, kitchenware, lighting, audio, instruments, anything with a designed/forged/restrained quality); outputs ONE working .html file. Visitors see a black-framed cover that flips between exhibits, sidebar index, side meta column (material/origin/year/dimension), and click any exhibit → full detail page (giant italic title, spec table, hero image, lead + 3 prose paragraphs, gallery, prev/next). Runs in BOTH Claude Code (writes to ~/Desktop) and GLM / online chat (outputs HTML inline). Trigger: "", "", "industrial-archive-gen ...", or when user drags this skill folder into chat asking for a product page in the Nordic-industrial archive style.
visibility: public
mode: template
carrier: web-page
scenario: brand-landing
pattern_source: reference.html
source_priority: skill-first
triggers:
  - ""
  - ""
  - ""
  - "industrial archive"
  - ""
related_patterns: portfolio-detail
legacy_gen: true
---

# industrial-archive —  / 

"" HTML，** / **：

- ，
- 
-  4  meta （ /  /  / ）
- 
-  CTA → （、、、 + 3 、6 、/）
-  splash

## 

" /  / industrial-archive-gen ..."，：
- ****（）：， 1—N 、、、、
- ** URL**（）： 1 、 3—6 。（ picsum ）
- ****（）：， styles.md 

**/** → ，（ /  /  /  /  / ...）。

**** → ： 1  lead + 3  prose + 4-6  spec。 `reference.html`：** wall-text**  — 、、， marketing 。

## 

###  A · Claude Code / （）
- ：`~/Desktop/{slug}-archive.html`（****， URL）
- ， URL 

###  B · GLM / （）
- ** HTML **， ` ```html ` 
-  URL →  `https://picsum.photos/seed/{slug}-{nn}/{w}/{h}?grayscale` 
- 

：** Read ** →  B。

## 

|  |  |  |
|---|---|---|
| `reference.html` | **** — "" 4  | ：lead 、prose 、spec 、tagline 、maker  |
| `template.html` | **** —  CSS/JS/，2  + 17  SWAP  | ， HTML |
| `styles.md` |  |  |
| `README.md` |  |  |
| `SKILL.md` | （） | **** |

****： `template.html`； `reference.html` ****（、、），。

##  — reference  SVG，template  `<img>`

- `reference.html`  4 ** SVG**（ /  /  / ），
- `template.html`  SVG  `<img src="cover URL">`， URL  URL， picsum
-  SVG。""， SVG  `coverHTML()`

## 

### 1.  HTML
-  `reference.html` ""， `exhibits-data` JSON  prose （、、）
-  `template.html`  17  SWAP （ `SWAP-`）

** JS /  CSS / **。
SWAP  HTML  JSON 。

### 2. 

#### （17  SWAP  1-15、17）
- **COLLECTION_TITLE / COLLECTION_SUB** —  + 。" /  1948—1988"。SWAP-1
- **INTRO_VOLUME_TAG** —  tag，" · Vol.01"。SWAP-2
- **INTRO_TITLE_HTML** — splash ，2-4  +  `<span class="accent">·</span>` 。 `<span class="accent">·</span>`。SWAP-3
- **INTRO_TITLE_EN** — splash ， + em-dash， `Restrained Objects — A Nordic Industrial Archive 1948 — 1988`。SWAP-4
- **INTRO_QUOTE** — ，60—100 ，。SWAP-5
- **INTRO_ATTRIBUTION** — ，`—  / Curatorial Note`。SWAP-6
- **HEAD_GLYPH** —  logo 。1-2  serif ， `Æ` `Ø` `` `` `ʘ`。SWAP-7
- **HEAD_GLYPH_SUB** — logo ，` /  N°01—04`。SWAP-8
- **HEAD_CENTER_CN / HEAD_CENTER_EN** — 。SWAP-9, 10
- **HEAD_RIGHT_TOP / HEAD_RIGHT_BOTTOM** — ：/ + /。SWAP-11, 12
- **CURATOR_NAME / CURATOR_EMAIL** —  + 。SWAP-13, 14
- **CRUMB_ROOT / CRUMB_VOLUME** — 。SWAP-15
- **TICKER_TAIL** — 。SWAP-17

#### （SWAP-16，）
```json
{
  "slug": "iron-kettle",
  "num": "N°01",
  "title": "",
  "en": "IRON KETTLE",
  "year": "1958",
  "place": " · ",
  "maker": "Carl Hansen Værksted / ·",
  "material": " · <br/>",
  "origin": " · <br/>Carl Hansen Værksted",
  "dim": " 18 cm ·  1.2 L<br/> 14 cm",
  "tagline": "FORGED ESSENTIAL / ",
  "lead": "<em></em>——，，。",
  "spec": [
    ["", "1958 · K-04"],
    ["", " + "],
    ["", " / "],
    ["", "1.86 kg"],
    ["", " 240  ·  31"]
  ],
  "prose": [
    " 80—160 。///。",
    " 80—160 。//。",
    " 80—160 。//。"
  ],
  "cover": "https://example.com/kettle-cover.jpg  picsum URL",
  "gallery": [
    {"src": "...", "layout": "f-3", "caption": ""},
    {"src": "...", "layout": "f-2", "caption": ""},
    {"src": "...", "layout": "f-2", "caption": ""},
    {"src": "...", "layout": "f-2", "caption": ""},
    {"src": "...", "layout": "f-4", "caption": ""},
    {"src": "...", "layout": "f-6", "caption": ""}
  ]
}
```

### 3.  SWAP

 `template.html`  17  `{{...}}` 。
****：`{{INTRO_TITLE_HTML}}`  HTML ， `<span class="accent">·</span>`。

### 4.  exhibits-data JSON（）

 `<script id="exhibits-data" type="application/json">`  2 **** N 。

#### 
-  1 （ — JS  N=1 ）
-  3—6 
-  8 ，

#### 
- `title`  2-4 （""、""、""）。，， `"title": ""`、`tagline: "MARITIME RANGEFINDER / "`
- `en` ，2 

#### tagline 
：` + / + `，：
- `FORGED ESSENTIAL / `
- `PIVOT & LIGHT / `
- `FOUR LEGS, NO MORE / ，`
- `MEASURED HORIZON / `

#### lead 
30—80 。** `<em>...</em>`**——CSS 。
：`。` ←  em，
：`<em></em>——，。`

#### prose 
3 ， 80—160 。：** wall-text** — 、、， marketing 。
- ： / （、、、）
- ： / （、、）
- ： / （、、）

#### spec 
4-6 ，。
-  `["", "{} · {}"]`
- /：`["", " 240  ·  31"]`（JS " / EXTANT"）

#### gallery layout 
- `f-3` — ，16:10， 1/2 （ 6  3 ）
- `f-2` — ，4:5， 1/3 
- `f-4` — ，16:9， 2/3 
- `f-6` — ，21:8

****：1  f-3 + 3  f-2 + 1  f-4 + 1  f-6 = 6 ，。

####  URL
 A  URL →  URL；
 B  →  picsum：`https://picsum.photos/seed/{slug}-{}/{w}/{h}?grayscale`
- cover  `1600/1000`
- f-3  `900/600`
- f-2  `600/750`
- f-4  `1200/675`
- f-6  `1600/610`
-  `?grayscale` 

### 5. （）
， `styles.md`  `:root`  8  CSS 。，""。

### 6. 

** A**：。
>  `~/Desktop/{slug}-archive.html` — N ，。， CTA 。 cover/gallery  picsum URL 。

** B**： HTML  + 。
>  `index.html` 。， ← → 。 picsum URL 。

## （）

-  JS：translate / flip 、`coverHTML()` 、`renderSidebar()`、`applyMeta()`、`renderDetail()`、 /  / cursor
-  CSS（ `:root`）
- `<script id="exhibits-data" type="application/json">` 
- `<div id="proj-list" class="proj-list">` （**** li， `renderSidebar()` ）
- `<div id="cover-stage">`  flipper 
- `<main class="stage">` 9 

## JSON 

- ****：prose / lead ""， `"..."` (U+201C / U+201D)，**** ASCII `"`（ JSON）
- ****：JSON （）， `\n`。 prose ； `<br/>`
- **`<em>` **： lead ** HTML ** `<em>...</em>`—— innerHTML ，CSS 
- **slug **： slug ，（`iron-kettle`  `IronKettle`  `iron_kettle`）
- **gallery layout **： `f-3` `f-2` `f-4` `f-6` ，
- **picsum seed **： seed，
- **num **：`N°01`  N  ° （° U+00B0）， `No.01`  `N01`
- **maker "/"**：`" / "`，JS  `/` 

##  / 

- title ≤ 4 ， tagline 
- lead ≤ 80 （）
- prose  80—160 （150 ）
- spec 4-6 
- gallery 3-6 （ 3 ， 6 ）
-  1—8 （ 3—6）
- ticker  — JS  DATA 

## 

→：
-  / "" / "" / "" → （ template ）
- "" / "" / "" / "" → styles.md `warm-leather`
- "" / "" / "" → styles.md `night-iron`
- "" / "" / "report" → styles.md `paper-press`
- "" / "" → styles.md `navy-blueprint`
