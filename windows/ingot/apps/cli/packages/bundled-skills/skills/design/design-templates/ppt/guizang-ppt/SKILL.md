---
name: guizang-ppt
description: " × " PPT（ HTML ）， WebGL 、 + 、、、。 /  /  PPT，" PPT"、"horizontal swipe deck"、"editorial magazine"、"e-ink presentation"。
visibility: public
mode: template
carrier: deck
scenario: marketing
pattern_source: assets/template.html, assets/pattern-slides.html
source_priority: skill-first
triggers:
  - "ppt"
  - "deck"
  - "slides"
  - "presentation"
  - "magazine"
  - ""
  - " PPT"
  - "horizontal swipe"
  - "horizontal swipe deck"
  - "editorial magazine"
  - "e-ink presentation"
  - " PPT"
  - ""
  - " PPT"
od:
  default_for: deck
  upstream: "https://github.com/op7418/guizang-ppt-skill"
  preview:
    type: html
    entry: index.html
  design_system:
    requires: false
  example_prompt: " PPT —— ' ·  AI '，25 ， + 。（Monocle / WIRED / Kinfolk / Domus / Lab）。"
---

# Magazine Web Ppt

##  Skill 

** HTML** PPT，：

- ** + **
- **WebGL  /  / **（hero ）
- **（Noto Serif SC + Playfair Display）+ （Noto Sans SC + Inter）+ （IBM Plex Mono）**
- **Lucide **（ emoji）
- ****（ ← →、、、、ESC ）
- ****： hero  shader 

 skill " PPT"，" UI"—— *Monocle* 。

## 

****：
-  /  / 
- AI  / demo day
- 
- "，" slides

****：
- 、（ PPT）
- （）
- （ HTML）

## 

### Step 0 · (Direction · )

** 6 , 5  magazine **。" /  layout / chrome  /  slide ",。

 `references/styles.md`,**** 5  1-line summary,:

```
1. Monocle Editorial ·  ✦ 
2. WIRED Tech ·  + 
3. Kinfolk Slow ·  / 
4. Domus Architectural ·  / 
5. Lab / Reference ·  + 
```

","——** Monocle Editorial**,。"AI / benchmark / "—— WIRED;" /  / "—— Kinfolk;" /  / portfolio"—— Domus;" /  / "—— Lab。

, `.md`, +  +  + ( `styles.md` )。****—— = 。

### Step 1 · (****)

** + **, Step 2。

****, 6 。 slide——,:

#### 6 

>  5  Step 0 (→)。 5 , 5 。

| # |  |  |
|---|------|-----------|
| 1 | **??**( /  / demo day / ) |  |
| 2 | **?** | 15  ≈ 10 ,30  ≈ 20 ,45  ≈ 25-30 ( `styles.md`) |
| 3 | **?**( /  /  PPT / ) | , |
| 4 | **??** | "" |
| 5 | ~~**?**~~ | ✓  Step 0  |
| 6 | **?**( XX  /  YY) |  |

#### ()

"",:

```
(Hook)       → 1    :  /  / 
(Context)    → 1-2  :  /  / 
(Core)       → 3-5  : , Layout 4/5/6/9/10 
(Shift)      → 1    :  / 
(Takeaway)   → 1-2  :  /  / 
```

 +  + ( `layouts.md`),**** Step 2。

 `.md`  `-v1.md`,。

#### ()

:

- ****:`/XXX/ppt/images/` ( `index.html` )
- ****:`{}-{}.{ext}`, `01-cover.jpg` / `03-figma.jpg` / `05-dashboard.png`
  - 
  - ,、、
- ****:
  -  ≥ 1600px ()
  - JPG /,PNG  UI/
  -  10MB ()
- ****:****(HTML );, `images/` 
- ****:,,; layout 4/5/10 

### Step 2 · 

 `assets/template.html` （ `/XXX/ppt/index.html`）， `images/` 。

```bash
mkdir -p "/XXX/ppt/images"
cp "<SKILL_ROOT>/assets/template.html" "/XXX/ppt/index.html"
```

`template.html` ****——CSS、WebGL shader、 JS、/ CDN ， `<main id="deck">`  3  slide（、、）。

#### 2.1 · （****）

， Tab "[]  PPT "：

|  |  |  |
|------|------|--------|
| `<title>` | `[]  PPT  · Deck Title` |  deck ( ` · Luke Wroblewski`) |

 template.html :grep "[]" 。

#### 2.2 · (5  · )

 skill ** 5 **, hex ——,。

| # |  |  |
|---|------|------|
| 1 | 🖋  |  /  /  |
| 2 | 🌊  |  /  /  /  |
| 3 | 🌿  |  /  /  /  |
| 4 | 🍂  |  /  /  /  |
| 5 | 🌙  |  /  /  /  |

****:
1. ,
2.  `references/themes.md`, `:root` 
3. **** `assets/template.html`() `:root{` ""(`--ink` / `--ink-rgb` / `--paper` / `--paper-rgb` / `--paper-tint` / `--ink-tint`)
4.  CSS  `var(--...)`,

****:
-  deck ,
-  hex —— 5 
- ( ink 、paper )——

### Step 3 · 

#### 3.0 · : template.html （****）

****。layouts.md (`h-hero` / `h-xl` / `stat-card` / `pipeline` / `grid-2-7-5` ), `assets/template.html`  `<style>` , fallback ——、、pipeline 、。

** slide :**

1. ** Read `assets/template.html`**( `<style>` )
2. ** layouts.md  Pre-flight **, `<style>` 
3. :** template.html  `<style>` **, slide  inline 
4. **template.html **——, `style="..."` inline

():
`h-hero` / `h-xl` / `h-sub` / `h-md` / `lead` / `kicker` / `meta-row` / `stat-card` / `stat-label` / `stat-nb` / `stat-unit` / `stat-note` / `pipeline-section` / `pipeline-label` / `pipeline` / `step` / `step-nb` / `step-title` / `step-desc` / `grid-2-7-5` / `grid-2-6-6` / `grid-2-8-4` / `grid-3-3` / `grid-6` / `grid-3` / `grid-4` / `frame` / `frame-img` / `img-cap` / `callout` / `callout-src` / `chrome` / `foot`

#### 3.0.5 · （****)

****, class(`hero dark` / `hero light` / `light` / `dark`)。 `references/layouts.md` ""。

****:

-  section  `light` / `dark` / `hero light` / `hero dark` , `hero`
-  3  = ,
- 8  ≥1  `hero dark` + ≥1  `hero light`
-  deck  `light` , `dark` 
-  3-4  1  hero (///)

****:`grep 'class="slide' index.html` ,。

#### 3.1 · 

** slide**。 `references/layouts.md`, 10 , `<section>` :

| Layout |  |
|---|---|
| 1.  |  1  |
| 2.  |  |
| 3.  |  |
| 4. (Quote + Image) |  /  |
| 5.  |  /  |
| 6. (Pipeline) |  |
| 7.  /  |  /  |
| 8. (Big Quote) |  / takeaway |
| 9. (Before / After) |  vs  |
| 10. (Lead Image + Side Text) |  |

 layout,,。** 3.0 **。

#### 3.2 · 

****,( `2592/1798`):

|  |  |
|------|---------|
|   | 16:10  4:3 + `max-height:56vh` |
| () | ** `height:26vh`**, aspect-ratio |
|  +  | 1:1  3:2 |
|  | 16:9 + `max-height:64vh` |
|  | 3:2  3:4 |

** `align-self:end`**—— cell 。 grid  + `align-items:start`(template );, flex column + `justify-content:space-between`。

(、、、、callout、stat-card ) `references/components.md`。

### Step 4 · 

 `references/checklist.md`，。****，P0 （emoji、、、）。

：

1. ****——,99%  Step 3.0 ,`h-hero`  template.html 
2. ** `height:Nvh`, `aspect-ratio`**()
3. ****—— `align-self:end`, grid + `align-items:start`( Step 3.2)
4. ****(16:10 / 4:3 / 3:2 / 1:1 / 16:9),
5. ** ≤ 5  `nowrap`**( 1  1 )
6. ** Lucide, emoji**
7. **,,**

### Step 5 · 

 `index.html` 。macOS ：

```bash
open "/XXX/ppt/index.html"
```

。 `images/xxx.png`。

### Step 6 · 

—— CSS ，90%  inline style（ `font-size:Xvw` /  `height:Yvh` /  `gap:Zvh`）。

---

## 

```
magazine-web-ppt/
├── SKILL.md              ← 
├── assets/
│   ├── template.html     ← （）
│   └── pattern-slides.html ← 9  deck（ Examples ）
└── references/
    ├── styles.md         ← 5  magazine （Monocle / WIRED / Kinfolk / Domus / Lab）
    ├── components.md     ← （、、、、callout、stat、pipeline...）
    ├── layouts.md        ← 10 （）
    ├── themes.md         ← 5 （）
    └── checklist.md      ← （P0/P1/P2/P3 ）
```

****：
1.  `SKILL.md`()
2. **Step 0 , `styles.md`**——5  +  layout + chrome 
3. Step 1 ,, `themes.md` 
4. ** Read `assets/template.html`  `<style>` **——,
5.  `layouts.md` ( Pre-flight )
6.  `components.md` 
7.  `checklist.md` ( P0-0 )

## （）

> "" PPT  5 。，。

1. **** — WebGL  hero ，
2. **** — 、、 padding box，** +  + **
3. **** —  = ， = ， = lead， = body， = 
4. **** — ，； `height:Nvh` ， `aspect-ratio` 
5. ** hero ** — hero  non-hero ，
6. **** — Skills  Skills，

## 

 skill ：

-  "： AI " （2026-04-22，27 ）
- *Monocle* 
- YC  Garry Tan "Thin Harness, Fat Skills"  demo

。
