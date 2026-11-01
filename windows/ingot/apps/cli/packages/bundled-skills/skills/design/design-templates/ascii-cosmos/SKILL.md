---
name: ascii-cosmos
description: Generate a single-file product landing page with a layered ASCII cosmos hero (rotating ASCII planet, drifting irregular asteroids, comet trails, nebula gas clouds — each in its own harmonious color) plus full marketing sections (about / features grid / showcase / spec / pricing / CTA / footer). Takes a natural-language description of one product (any kind — a note app, a coffee subscription, a CLI tool, an indie hardware, a hosting service…) and outputs ONE working .html file with deep-space dark or warm-letterpress theme. Runs in BOTH Claude Code (writes to ~/Desktop) and GLM / online chat (outputs HTML inline). Trigger phrases: "", " ASCII ", "ascii-cosmos-gen ...", " / ", or when user drags this skill folder into chat asking for an atmospheric product landing page.
visibility: public
mode: template
carrier: web-page
scenario: marketing-landing
pattern_source: reference.html
source_priority: skill-first
triggers:
  - ""
  - " ASCII "
  - ""
  - ""
  - "ascii "
  - "ascii hero"
legacy_gen: true
---

# ascii-cosmos — ASCII 

## 

 HTML ，hero  ASCII ：

- ****（，）
- ****（， ★ ✦ ）
- ** ASCII **（， 3 ）
- ****（，6  ASCII ， + ）
- ****（，）

 marketing ： /  6  /  2  /  /  3  / CTA / 。"hover -"（`.pt` ）。

：、/、 AI、CLI、、、SaaS、、、" /  / "。

## 

：
- ""
- " ASCII "
- " —  ..."
- "ascii-cosmos-gen ..."
-  skill 

：
- ** + **（）
- ** / **（ —  6 ）
- ****（ —  3 ： /  / ）
- ****（ —  /  /  /  …， `styles.md` 。）

****： 6 、3 、。、， marketing 。

## 

###  A · Claude Code / （）
- ：`~/Desktop/{slug}.html`（****， unsplash URL ）
- slug 
- ： +  + 

###  B · GLM / （）
-  HTML  ` ```html ` 
-  `https://images.unsplash.com/photo-XXX?...`  `https://picsum.photos/seed/{slug}-NN/W/H` 
- 、
- ： .html 

：** Read ** →  B。

## 

### 1. 
 skill  `template.html`。，：
-  CSS（ + 5  ASCII  +  /  /  / hero  …）
-  JS（5  ASCII 、、、、、）
- 12  `<!-- SWAP-N -->` 

**JS / CSS **（ styles ）。

### 2. 
 `styles.md`：5 。， CSS  `:root`。 6 （`--bg / --fg / --dim / --accent / --accent2 / --accent3 / --line / --paper`）+ 5  ASCII （`#ascii-nebula / -stars / -planet / -asteroids / -comets`）。

> ：5  ASCII ** + **。 → ； → 。

### 3. 

：
- **PRODUCT_EN** —  logo ， ASCII （ hero  ASCII title）
- **PRODUCT_CN** — 1-2 （hero ，）
- **TAGLINE** — （30-50 ）
- **VERSION / TYPE / PLATFORM** — 3  meta 
- **ABOUT_PARAGRAPH** — 80-150 ，3-5  `<span class="pt">` 
- **3 HIGHLIGHT** — 3  cell（ + ）
- **6 FEATURES** — 6 ： URL + ASCII overlay（5-6 ） +  +  + 1-2  + （ai/write/graph/sync ）
- **2 SHOWCASE** — 2 （ URL + mini-ascii  +  `<em>`  + 2  60-100 ）
- **10 SPEC ROWS** — 10 （ /  /  /  /  …）
- **3 PRICING** — 3 （ /  /  /  / 5-6  / CTA ）。** `featured` **
- **CTA_BIG** —  CTA （ `<em>` ）+  + 3  + 6-7 

### 4.  12  SWAP

| SWAP |  |  |
|---|---|---|
| 1 | `<title>` | `{PRODUCT_CN}{PRODUCT_EN} — {TAGLINE}` |
| 2 | header logo + 5  nav | logo  + （： /  /  /  / ） |
| 3 | hero ASCII title | `PRODUCT_EN`  ANSI Shadow  ASCII（ https://patorjk.com/software/taag ，5 ） |
| 4 | hero  + tagline + 3 meta | `PRODUCT_CN` + `TAGLINE` + 3  meta span |
| 5 | intro  + 3 cells | `ABOUT_PARAGRAPH`（ `<span class="pt">` ）+ 3  `<div class="cell">` |
| 6 | 6  features  | ：`data-cat` + `<img src>` + ASCII overlay +  + small + tags |
| 7 | 4  filter tag |  chip（all +  3-4 ， data-cat） |
| 8 | 2  showcase | ： + mini-ascii + h3（ em） + 2  p（ pt ） |
| 9 | 10  spec table | ：`<b>`  + `<span class="pt">`  |
| 10 | 3  pricing | name / num / desc / ul li / btn |
| 11 | info  CTA | info-big （ em）+ hero-sub  + 3  + platforms |
| 12 | footer |  +  |

****（）：
-  `<script>` （5  ASCII  /  / scramble /  /  / ）
- `.pt` （ `<span class="pt" data-text="...">...</span>`）
- 5  ascii-layer  `<pre id="ascii-...">` 
- `<pre id="info-ascii">` 
- 6  data-cat 
- featured 

### 5.  ASCII （SWAP-3）

 ANSI Shadow / ANSI Regular  5  ASCII 。 ╗╔═║║║╝╚═╝ 。 INKWEAVE ：
```
██╗███╗   ██╗██╗  ██╗██╗    ██╗███████╗ █████╗ ██╗   ██╗███████╗
██║████╗  ██║██║ ██╔╝██║    ██║██╔════╝██╔══██╗██║   ██║██╔════╝
██║██╔██╗ ██║█████╔╝ ██║ █╗ ██║█████╗  ███████║██║   ██║█████╗
██║██║╚██╗██║██╔═██╗ ██║███╗██║██╔══╝  ██╔══██║╚██╗ ██╔╝██╔══╝
██║██║ ╚██╗██║██║  ██╗╚███╔███╔╝███████╗██║  ██║ ╚████╔╝ ███████╗
╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝ ╚══╝╚══╝ ╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝
```

** 8 ** →  8 （ `INTERSTELLAR` → `STELLAR`）， ANSI （ `▌▐█`）。

**** →  5  ASCII，。

### 6.  ASCII overlay（SWAP-6 ）

 4-5  ASCII ，。：
- "" → `╭─────╮ │ ... │ ╰──→──╯`
- "" → `●─●─● │\\ │/│ ●─●`
- "" → `┌─────┐ │ ⌕  │ │  3  │ └─────┘`
- "" → `▣ ⇄ ▢ ╲ ╱ ⇅ ╱ ╲ ▤ ⇄ ▥`
- "" → `←─◆─◆─◆─→ ░░▒▒▓▓██`

 5 ， 14 。

### 7.  `<span class="pt" data-text="...">` 

"hover "：
```html
<span class="pt" data-text=""></span>
```
- intro  3-5 
- showcase p  1-2 
- spec  `<span class="pt">`
- pricing btn  `pt`
-  `<span class="em">...</span>`（ `pt`）

### 8. （）
， `styles.md` ：
- `:root` 8 
- `.hero` background 
- 5  `#ascii-{layer}` 
- （ `hue-rotate(200deg) brightness(.7)`， `sepia(.3) saturate(.85)`）

> ****："" — 「 → 」。

### 8.5  ASCII  motif（！）

 hero （ +  +  + ）。** motif ** — ， app 。

****： `<script>`  `// SWAP-13 · ASCII ` ， `SCENE = { ... }`。 JS 。

`SCENE` 11 ：

|  | （） |  /  |
|---|---|---|
| `floaters` | 6  ASCII （） |  + "" |
| `centerShade` | `" .,:;-~+*=%#@█"` | （→ 14 ） |
| `diffuseChars` | `"·∙∶⋮⋯░▒"` | ""（→） |
| `sparkRare` | `"★"` |  (4% ) |
| `sparkBright` | `"✦"` |  (15%) |
| `sparkDim` | `".∙"` |  |
| `streakHead` | `"☄"` | ""（） |
| `streakTailNear/Mid/Far/End` | `"*","∙","·","."` |  4  |
| `centerSats` | `"◉◎○"` |  3 ""， |
| `orbitDots` | `".∙•"` | 3 ， |

#### Motif （）

|  | floaters  | centerShade | diffuseChars | sparks | streakHead/tail | centerSats |  |
|---|---|---|---|---|---|---|---|
| ** /  / ** |  /   | `" .'-=+oO0@#"` | `"·~,'\""` () | `★ ✧ . ∙` | `"☕"`  + `"*∙·."`  | `"●◐○"` () |  +  +  +  |
| ** /  / ** |  /   | `" .,;:!|tT#"` () | `"~^,'\""` () | `"⁂"`  + `"·"`  | `"𓅯"`  + `"~~~~"`  | `"❀✿✾"` () |  +  +  +  +  |
| ** /  / ** |  /  | `" .─=≡▪▫■□"` | `"·∶⋮⁞"` () | `"♪♫"` + `"·"` | `"♬"`  + `"~∼≈"`  | `"◉◎○"` () |  +  +  +  |
| ** / CLI / ** | `{}` `[]` `()` `<>`  ASCII  | `" 01[](){}<>#"` | `"·.,:|"` | `"★ ✦ . _"` | `"_"`  + `"   "` () | `"◉⊞⊟"`  |  +  commit +  +  |
| ** /  / ** |  /  /  /  | `" .·°*+x#X@"` | `"·:.,"` () | `"✦ ▪ ▫"` | `"→"`  + `"-—"`  | `"◉○⊙"` () |  +  +  +  |
| ** /  / ** |  /  /   | `" ··∘○●"` | `"~∼≈"` () | `". ∙ °"` | `"◌"`  + `"·· ··"`  | `"◯◌○"` () |  +  +  +  |
| ** / ** |  /  (`├┤├ ┐└┘`) | `" .·•◊◆■"` | `"⋅¨"` () | `"⚡"`  + `"·"` | `"►"`  + `"==="`  | `"⊙⊚⊛"` (LED) | PCB +  +  |
| ** /  / ** | `"…"` `"——"` `"§"`  | `" .,;:!?¶§"` | `"··¨"` | `". ∶ ⋮"` | `"✒"`  + `"~~~"`  | `"◉◯●"` () |  +  +  +  |
| ** /  / 80s** |  /  | `" .░▒▓█"` | `"·:|"` | `"◆ ◇ ▰"` | `"◉"`  + `"━━"`  | `"■□▣"` |  CRT +  +  |
| ** /  / ** |  /  /  /  | `" .~≈≋"`  | `"~∼≈≋"` () | `"·°"` () | `"⛵"`  + `"~~~"`  | `"◐◑◯"` () |  +  +  +  |

####  floaters 

 3-4  ASCII， 8-12 。：
- （ `,/^\,` `(   )` `'\_/'` ）
- ， 3-6 
- ，
-  1  padding 

****：
```js
floaters: [
  [" ,-^-, ",
   "|     |",
   " '---' "],
  ["  /\\\\  ",
   " /  \\\\ ",
   " \\__/ "],
  ["  *_*  ",
   " /...\\\\ ",
   " '___' "]
]
```

****：
```js
floaters: [
  ["  ♪    ",
   " /|    ",
   "♪ |____♪"],
  ["    ♫  ",
   "    /\\\\ ",
   "♪__/  \\\\"],
  ["  ♩    ",
   "  |    ",
   "  o    "]
]
```

****： SCENE ， `JSON.stringify(SCENE)`  OK。

#### 

** 10 ** →  motif，：
1. **floaters**  3-6 （""）
2. **centerShade** 14 ，（` .,`），（`@#█`），
3. **diffuseChars** 5-8 ""（ /  /  / ），
4. **streak** ""
5. **sat / orbitDots**  3 ，

> ：**、3 ，。**

### 9.  → （）

|  |  |  |
|---|---|---|
|  /  /  /  /  /  | ****（） | `#8be9ff`  |
|  /  /  /  /  /  /  | **** | `#660125`  |
|  /  / AI / Web3 /  /  | **** | `#ff00aa`  |
| CLI /  /  /  80s / phosphor | **** | `#00ff66` |
|  /  /  /  /  | **** | `#7fe3c4`  |
|  /  /  /  /  /  | **** | `#ff8b3d`  |
|  /  /  /  /  |  | `#4fc3f7`  |
|  /  /  /  /  |  | `#d4af37`  +  |

：
1. **** →  `styles.md` 
2. **，** → 
3. **** → 

### 10. 

** A**：。
>  ~/Desktop/{slug}.html — {}，6  + 3 ，。。

** B**： HTML  + 。
>  `{slug}.html` 。 URL 。 ASCII  `<pre class="ascii-title lg">` 。

## 

- **5  ASCII **： 5 。、
- **ASCII **：5  ANSI Shadow  5-6 ， 3 
- **`<pre>` **， `\n` 
- ** data-cat  filter ** → 。
- **pricing  `featured`** → 
- **JSON / **：ASCII overlay  `""`
- ** `<pre id="ascii-comets">` ** → JS 。5 
- ** URL** →  unsplash （`?auto=format&fit=crop&w=900&q=70`） picsum
