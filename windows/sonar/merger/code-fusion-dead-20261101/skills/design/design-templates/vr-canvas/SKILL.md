---
name: vr-canvas
description: Generate a single-file VR-style portfolio website — works are tiled on the inside of a 3D cylinder/sphere (concave wraparound, like an immersive headset), with mouse-controlled head tilt, long-press to drag and browse the infinite canvas, click to open work detail. Includes overlays for About / CV / Contact / Filter. Takes a natural-language description of the studio and works (images + brief copy); outputs ONE working .html file. Runs in BOTH Claude Code (writes to ~/Desktop) and GLM / online chat (outputs HTML inline). Trigger phrases: " VR ", "", "", "vr-canvas-gen ...", or when user drags this skill folder into chat asking for a wraparound/immersive portfolio site.
visibility: public
mode: template
carrier: web-page
scenario: portfolio
pattern_source: reference.html
source_priority: skill-first
triggers:
  - " VR "
  - ""
  - ""
  - ""
  - ""
related_patterns: portfolio-detail, digital-eguide
legacy_gen: true
---

# vr-canvas — VR 

## 
「 VR 」/「 /  / 」/「」/「vr-canvas-gen ...」，：
- ****（，）— GLM 
- ****（ +  — ，）

## 
：
- **works_path**（A ）：
- **bio_text**（）： + 。：、、、、、、
- ****（）：「/」；「 /  /  / 」 `:root` 

「 VR 」 → ****。
 → ****，/。

## （）

### A. Claude Code / （）
-  `Bash` 、`sips` 、`cp` 
-  `~/Desktop/{slug}-vr-canvas/index.html` + `images/`
-  `images/work-NN.jpg`
-  `images/p-01-color-macro.jpg ... p-18-magazine.jpg`  18 （≈2.2MB）， open template.html  VR 

### B. GLM / （）
- ** HTML **（ ```html ）
-  URL →  `https://picsum.photos/seed/{-}/1080/1080` 
-  URL →  `<img src="https://...">`
- 、（「 index.html」）

：** Read ** →  B。

## 

|  |  |  |
|---|---|---|
| `reference.html` | ****（ 20  +  about/cv/contact/filter ）| ：tile 、tag 、desc 、about/cv 、 |
| `template.html` | ****（ CSS/JS，2  +  SWAP ）| ， HTML |

****： `template.html`； `reference.html` ****，（、、 …… ）。

## 

### 1.  HTML
-  `template.html`， SWAP （ 12 ）
-  `reference.html`，、about/cv 

** JS、 .work / .frame / .sphere / .viewport / .overlay  CSS、 #sphere / #viewport / .splash **。

### 2.（ A ） + 
```bash
ls -la "{works_path}"
sips -g pixelWidth -g pixelHeight "{works_path}/{file}" 2>/dev/null
```

 +  (Read ) → (title, brand, year, tags, desc)。

### 3.  bio_text 

****（ fallback）：
- **STUDIO_NAME_CN / STUDIO_NAME_EN**（「 / Xubai」「 / Mingchuan」）
- **STUDIO_TYPE**（「」「」「」「」）
- **TAGLINE**（： + ， `，、`）
- **LOCATION_PRIMARY / SECONDARY**（「 · 」「 · 」；）
- **TIMEZONE_PRIMARY / SECONDARY**（「 UTC+8」、 JST/EST ）
- **YEAR_FOUNDED**（ 2017）
- **CTA_TEXT**（「。」，「Let's Talk」「」）
- **TAB_LABELS**（ ` /  / `，）
- **CAPABILITIES**（4—5 ， about overlay）
- **TEAM**（3—5 ， about overlay；）
- **CV_YEARS**（）
- **AWARDS**（3—8 /）
- **CONTACT_EMAILS**（new project / press / hiring ）
- **OFFICE_ADDRESSES**（1—2 ）
- **SOCIAL**（IG /  / Twitter / Behance ）
- **FILTER_CATEGORIES / YEARS**（ filter overlay ， WORKS ）

****：
- **id**（'01'—'NN' ）
- **brand**（「」「」）
- **title**（4—12 ）
- **year**（YYYY ）
- **tags**（，1—3 ， Identity / Editorial / Web / Installation / Poster / Sound / Motion / Print / Type / Packaging / Exhibition / Light）
- **img**（，1080×1080 ）
- **hero**（，1600×1000 ）
- **g1, g2**（，800×600）
- **desc**（ ~20—50 ，）
- **long**（，2—3 ， 60—120 ）
- **spec**（4 ：`[['Client','xxx'],['Year','xxx'],['Scope','xxx'],['Duration / Pages / Edition','xxx']]`）

 bio_text  → ****，****（ 'Personal' / '' / ``）。

### 4. WORKS 
-  **8 **（）， 8 ： `workFor()`  mod 
-  **30 **（，）
-  **15—25 **

### 5.  12  SWAP

| SWAP |  |  |
|---|---|---|
| 1 | `<title>` | `{STUDIO_NAME_CN} — {STUDIO_TYPE} · Index {YEAR}` |
| 2 | `.brand-block`（ logo + ）|  SVG logo  + 「 []」 |
| 3 | `.tagline`（）| `{TAGLINE}`  + `<br>` +  |
| 4 | `.col-meta`（ location）| 1—2  `<div class="row"><span class="loc-dot live"></span>{LOCATION}</div>` |
| 5 | `.col-times`（）| ` UTC+8` / `<div id="time1">`  JS  /  `<div id="time2">`  |
| 6 | `.cta`  | `{CTA_TEXT}` |
| 7 | `.bottombar .tabs` |  `<button class="tab">` （ ` /  / `） |
| 8 | `#overlay-about` |  about ：eyebrow +  +  +  +  |
| 9 | `#overlay-cv` |  + / |
| 10 | `#overlay-contact` |  /  /  /  6  contact-cell |
| 11 | `#overlay-filter` |  /  /  checkbox（ WORKS ） |
| 12 | `const WORKS = [...]` |  WORKS  |

### 6. （）

（「 / 」）：
```css
--bg: #0d0c0b;
--ink: #f0e9df;
--ink-soft: #8a8278;
--accent: #c89a5a;
```

：
- ** / ** → bg `#f4f1ec`、ink `#1a1714`、accent `#8a4a1a`
- **** → bg `#ffffff`、ink `#0a0a0a`、accent `#666666`
- **** → bg `#0a0612`、ink `#e8d8ff`、accent `#9b6dff`
- **** → bg `#1f1610`、ink `#e8d4b6`、accent `#c8895a`

 `:root` ； layout / JS。

### 7.  /  HTML

** A（Claude Code）**：
```
~/Desktop/{slug}-vr-canvas/
├── index.html
└── images/
    ├── work-01.jpg ... work-NN.jpg
    └── (hero / g1 / g2  -hero / -g1 / -g2)
```
slug （xubai / mingchuan / li-ming）。

** B（GLM）**：
 HTML， ```html 。 `<img src>`  picsum  URL。

：
>  `index.html` 。， WORKS  `img / hero / g1 / g2` 。

### 8. 

** A**： +  + 。
>  ~/Desktop/xubai-vr-canvas/index.html — 18 ，「」。， VR ，，。

** B**： HTML  + 。

## （）

-  JS（ /  /  / hash  / splash / time tick / mouse tilt）
- `.work / .frame / .cell-head / .cell-foot / .num / .brand / .proj`  CSS
- `.viewport / .sphere`  CSS  DOM 
- `SPHERE_R = 1700 / STEP_DEG = 11 / ROW_HALF = 6`（； VR  R）
- `.overlay / .overlay-close / .info-pane / .info-section` （only ， class）
- `mix-blend-mode: difference`  topbar （）

## 

- ****： 1080×1080  `img`（ cell ）； hero  1600×1000 
- **WORKS **： 8 ； bio 「 / 」
- **** long（300 +）— 
- **** `font-family: "Noto Serif SC"` （）
- **about / cv / contact  overlay **：， bio ； overlay
- **filter overlay  checkbox** （ JS）， WORKS 
- ****（）：team ；office addresses 「 ·  」
