# （Checklist）

"" PPT 。，。

 PPT ，；，。

---

## 🔴 P0 · 

### 0. ()

****： layouts.md  HTML,——、、pipeline 、。

****： `template.html`  `<style>` , fallback 。

****：
- ** PPT , `Read` `assets/template.html`**, layouts.md 
- :`h-hero / h-xl / h-sub / h-md / lead / meta-row / stat-card / stat-label / stat-nb / stat-unit / stat-note / pipeline-section / pipeline-label / pipeline / step / step-nb / step-title / step-desc / grid-2-7-5 / grid-2-6-6 / grid-2-8-4 / grid-3-3 / frame / img-cap / callout-src`
- ,** template.html  `<style>` **, inline 
- ,"""pipeline ", 100% 

### 1.  emoji 

****： emoji（🎯 💡 ✅）。

****： Lucide ，CDN ：

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
...
<i data-lucide="target" class="ico-md"></i>
...
<script>lucide.createIcons();</script>
```

：`target / palette / search-check / compass / share-2 / crown / check-circle / x-circle / plus / arrow-right / grid-2x2 / network`

### 2. ，

****： `aspect-ratio` ，（）。

****：** height + overflow hidden**， `object-fit:cover + object-position:top`：

```html
<figure class="frame-img" style="height:26vh">
  <img src="screenshot.png">
</figure>
```

CSS  `.frame-img img`  `object-position:top`，。

****（）：

```html
<!--  -->
<figure class="frame-img" style="aspect-ratio: 16/9">...</figure>
```

****：（） `aspect-ratio + max-height`，。

### 2b.  WebGL = ()

****: light , hero light 。

****:JS  slide  canvas  opacity。 deck  hero dark, bg  light,body  `light-bg` ,`canvas#bg-dark` 。

****:
-  `go()`  `classList` (`light` / `dark`), **slide  `light`  `dark` **。,
- hero  `hero light` / `hero dark`, `light` / `dark`。 `hero` 
-  deck  ** hero  light **, body  `light-bg`

### 2b-2.  deck  light,

****: `hero dark` , `light`——,,。

****:layouts.md  `light`,,。

****:
- **""**: `hero dark` / `hero light` / `light` / `dark` ,
- ****: 3  = ;8  ≥1 `hero dark` + ≥1 `hero light`; `light` —— `dark` 
- ****( layouts.md ""):
  - (Layout 4)、(Layout 8)、(Layout 10)→ **`light` / `dark` **
  - 、、Pipeline、 → `light`(//)
  - 、 → `hero dark`
  -  → `hero dark`  `hero light` 
- ****:`grep 'class="slide' index.html`,

### 2c. chrome  kicker 

****: `.chrome` "Design First · ", `.kicker` "Phase 01 · "——,AI 。

****:
- **chrome =  / **:( "Act II · Workflow"、"Data · Result"、"lukew.com · 2026.04")
- **kicker = **:、、""( "BUT"、",。"、"The Question")
- ,——

### 3.  / 

****：（ 13vw）， 1 ，。

****：
- `h-hero`（）：10vw，** ≤ 5 **
- `h-xl`（）：6vw-7vw
-  `<br>` ，
-  `white-space:nowrap`

****：`。`（6 ） `h-xl` 7.2vw + nowrap，。

### 4. ：、

****：
- 、 quote、 → ****（Noto Serif SC + Playfair Display + Source Serif）
- 、、pipeline  → ****（Noto Sans SC + Inter）
- 、、 → ****（IBM Plex Mono + JetBrains Mono）

 Google Fonts CDN ，。

### 4b.  `align-self:end` 

****：, callout , `<figure>`  `align-self:end`。:
-  grid(),`align-self` ,
-  grid, cell , `.foot`  `#nav` 

****:
- ** `.frame.grid-2-7-5`**( `.grid-2-6-6`/`.grid-2-8-4`)
-  `<figure class="frame-img">`  ** 16/10  4/3 + max-height:56vh**,
-  callout "",**** flex column + `justify-content:space-between`,

### 4c. 

****:`aspect-ratio: 2592/1798` ,。

****:, **16/10 / 4/3 / 3/2 / 1/1 / 16/9**。 `object-fit:cover + object-position:top`,,。

### 5.  / 

****：""， PPT。

****： 1-4px  + ****（）。 `box-shadow`， `border`（ 1px ）。

---

## 🟡 P1 · 

### 6. Hero  hero 

****（25-30 ）：
```
Hero Cover → Act Divider (hero) → 3-4 pages non-hero → Act Divider (hero)
→ 4-5 pages non-hero → Hero Question → ... → Hero Close
```

 2  hero ， 4  non-hero 。

### 7. 

（big numbers / hero question）（pipeline / image grid），。

### 8. /

****： "Skills"， ""， ""，。

****：
- ****（Skills / Harness / Pipeline / Workflow），
- ****，
-  deck  1 

### 9.  chrome 

 `XX / ` （ `05 / 27`）。****（ `.chrome` ）。

---

## 🟢 P2 · 

### 10. WebGL 

**dark hero**： 12-15%（WebGL ）
**light hero**： 16-20%（WebGL ，）
** light/dark **： 92-95%（）

（hero question），；，。

### 11. Light hero  shader 

****：Spiral Vortex、 light ， Windows 98 。

****：light hero  FBM ，/（ #F0F0F0 / #FBF8F3）， subtle（0.05 ）。

### 12. Dark hero 

Dark hero  Holographic Dispersion（） shader，。

### 13. 

-  `justify-content:space-between`：，
-  `align-self:end`：
-  `align-items:start`（ `center` / `end`）

### 14. 

 `.frame-img`  `.frame-img img`  `border-radius:4px`，""。** 8px**， app UI。

---

## 🔵 P3 · 

### 15. 

 `images/` ，HTML  `images/xxx.png`，。

### 16.  `.chrome` 

JS ， `.chrome`  `XX / N` 。/ N。

### 17. 

：← → /  /  /  / Home·End。 JS 。

### 18.  `height:100vh` ， `min-height:80vh`

`100vh` ，、，。 `min-height:80vh + align-content:center` 。

---

## 🧪 

 PPT ，（）：

```
()
  □  template.html  <style>,
  □  Layout(1-10)
  □ "": hero dark / hero light / light / dark
  □ : 3  /  ≥1 hero dark + ≥1 hero light(8 ) /  1  dark 
  □ `<title>`  deck (grep "[]" )


  □ ()
  □  emoji 
  □ Skills / Harness 
  □  kicker +  +  


  □  1  1 
  □  height:Nvh  aspect-ratio
  □ ，
  □ /
  □ Pipeline 


  □ hero  non-hero 
  □ WebGL  hero 
  □ 
  □ 


  □ ← → 
  □ 
  □ chrome 
  □ ESC （）
```

， PPT。
