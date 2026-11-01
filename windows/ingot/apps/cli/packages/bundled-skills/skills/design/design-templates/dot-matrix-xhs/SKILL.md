---
name: dot-matrix-xhs
description: Bayer  /  /  —  + Canvas  Bayer 8×8  +  vignette + （ /  / wordmark / credit）+ Noto Sans JP Black  2×2  + 。4 （ /  /  / ）， cqh 。：" / dither / 1-bit /  /  / Vol  /  / "。NOT ，NOT 。
visibility: public
mode: template
carrier: fixed-image
scenario: social-content
pattern_source: .html
source_priority: skill-first
triggers:
  - ""
  - ""
  - "1-bit "
  - "Vol "
  - ""
  - ""
  - "dither "
related_patterns: social-card-editorial
---

# dot-matrix-xhs — Bayer 

 Bayer 8×8 ，""， +  2×2 。** 1280×1644（）**， container-query (cqh) ，。

##  skill

1. ****： Read `.html`（ / a fire at midnight ）， Bayer dithering 、、。**""。**
2. ****： 4 （ /  /  / ），** clone **（ 2×2 +  +  wordmark ）。
3. ****：Canvas Bayer 、、。
4. ****：" / "。

##  DNA — 

：

1. ** + Canvas  Bayer **： Bayer 8×8 ，** CSS noise， SVG filter， PNG， Canvas **。（、、） `adjustBrightness(-20~-30) + adjustLevels(60~80, 190~210) + bayerDither` 。
2. ****：canvas  `image-rendering:pixelated`，，。
3. ** vignette**：`linear-gradient(180deg, rgba(0,0,0,.55) 0%, transparent 18%, transparent 70%, rgba(0,0,0,.45) 100%)`， wordmark ；** vignette**（）。
4. ****：= (`No 04 / 2026`)、=+、= wordmark、=+credit。** 3 **，； 3 。
5. ****：`Noto Sans JP Black` + `PingFang SC` ，`font-weight:900`，`line-height:1.1`，`letter-spacing:0`（）。** /  /  / **。
6. ** text-shadow**： `text-shadow:0 0 .8cqh rgba(0,0,0,.85)`，。

##  / （）

****：
- [ ] Canvas  Bayer dithering（ CSS 、 SVG noise、）
- [ ]  `aspect-ratio`（ 1280/1644，）
- [ ]  `container-type:size`， `cqh` / `cqw`
- [ ]  3 （、、wordmark、credit  3）
- [ ]  ≥ 800
- [ ]  webfont ""（preconnect + preload + print-onload + noscript）
- [ ] canvas  `image-rendering:pixelated / -moz-crisp-edges / crisp-edges` 

****：
- [ ] "2×2  +  +  wordmark" — 
- [ ]  SVG noise / `filter: contrast` / `background-image: radial-gradient(...dot)`  — 
- [ ] （Bayer  0  255 ，）
- [ ] （、、）—  1-bit 
- [ ]  — 、、
- [ ]  emoji / 3D  /  /  / 
- [ ]  PingFang Regular / Source Han Sans Light —  Heavy / Black 
- [ ] "/// + VOL IV / 2026 +  wordmark +  955873829" — 

## （，""）

 +  DNA，****，。

###  A — （，）
```
[]  Bayer  +  vignette
[]   / + /  wordmark /  credit
[]  hr  + 2×2  + 
[]  
```
：（、、）。1280×1644。

###  B — 
```
[ 60%]  Bayer  +  + 
[ 40%]  ，（）， + 
[]     + wordmark + 
```
：、、（ 2×2 ）。1280×1644  1080×1350。

###  C — 
```
[ 3 ]   Bayer （ /  / ）
               +  01 / 02 / 03
[]         + 
[]         wordmark + 
```
：、、、。 1644×1280  1280×1644。

###  D —  / 
```
[]    +  + hr
[]   sticky  + （ 40% ）
[]   （ p + ）， 1-2  Bayer 
[]    + wordmark
```
：、 essay、（，）。1280×1800+  A4 。

## 

### Bayer 8×8 （，）
```js
function bayerDither(ctx, W, H){
  const d = ctx.getImageData(0,0,W,H), px = d.data;
  const m = [
    [ 0,32, 8,40, 2,34,10,42],[48,16,56,24,50,18,58,26],
    [12,44, 4,36,14,46, 6,38],[60,28,52,20,62,30,54,22],
    [ 3,35,11,43, 1,33, 9,41],[51,19,59,27,49,17,57,25],
    [15,47, 7,39,13,45, 5,37],[63,31,55,23,61,29,53,21]
  ];
  for (let y=0; y<H; y++) for (let x=0; x<W; x++){
    const i=(y*W+x)*4;
    const luma = (0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2]) / 255;
    const t = (m[y%8][x%8] + 0.5) / 64;
    const v = luma > t ? 255 : 0;
    px[i]=px[i+1]=px[i+2]=v; px[i+3]=255;
  }
  ctx.putImageData(d,0,0);
}
```
****：8×8  4×4（）、 Floyd-Steinberg（，""）。 = canvas ：W=600 H=771 ， 900×1158， 400×514。

### ： + （ Bayer ）
```js
function adjustBrightness(ctx, W, H, delta){
  const d = ctx.getImageData(0,0,W,H), px = d.data;
  for (let i=0; i<px.length; i+=4)
    for (let c=0; c<3; c++){ let v=px[i+c]+delta; px[i+c]=v<0?0:v>255?255:v; }
  ctx.putImageData(d,0,0);
}
function adjustLevels(ctx, W, H, lo, hi){
  const d = ctx.getImageData(0,0,W,H), px = d.data, scale = 255 / (hi - lo);
  for (let i=0; i<px.length; i+=4)
    for (let c=0; c<3; c++){ let v=(px[i+c]-lo)*scale; px[i+c]=v<0?0:v>255?255:v; }
  ctx.putImageData(d,0,0);
}
```
****：`drawImage → adjustBrightness(-25) → adjustLevels(70, 195) → bayerDither`。** dither ** — dither ，。

### Canvas 
```html
<canvas class="bg" id="bg" width="600" height="771"></canvas>
<img class="src" id="src" src="YOUR_IMG_URL" crossorigin="anonymous" alt="">
```
```css
canvas.bg{
  position:absolute; inset:0;
  width:100%; height:100%;
  image-rendering:pixelated;
  image-rendering:-moz-crisp-edges;
  image-rendering:crisp-edges;
  z-index:0; display:block;
}
img.src{ display:none }
```
 `<img>`  canvas drawImage，。`crossorigin="anonymous"`  —  getImageData 。

###  Canvas 
```js
(async function(){
  if (document.fonts && document.fonts.ready){ try { await document.fonts.ready; } catch(e){} }
  const img = document.getElementById('src');
  const canvas = document.getElementById('bg');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const ready = (img.complete && img.naturalWidth > 0)
    ? Promise.resolve()
    : new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  try { await ready; } catch(e){ console.warn('img failed', e); return; }

  const ratio = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const dw = img.naturalWidth * ratio, dh = img.naturalHeight * ratio;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);

  adjustBrightness(ctx, W, H, -25);
  adjustLevels(ctx, W, H, 70, 195);
  bayerDither(ctx, W, H);
})();
```

### （）
```css
.frame{
  position:relative;
  height:min(94vh, 1644px);
  aspect-ratio: 1280 / 1644;
  container-type:size;
  background:#000; color:#fff;
  overflow:hidden;
}
.title{ font-size:12cqh; }
.credit{ font-size:.85cqh; letter-spacing:.28em; }
```
** cqh  vh**：vh ，。cqh  `.frame` ，。

###  vignette
```css
.vignette{
  position:absolute; inset:0; z-index:1; pointer-events:none;
  background: linear-gradient(180deg,
    rgba(0,0,0,.55) 0%, rgba(0,0,0,0) 18%,
    rgba(0,0,0,0) 70%, rgba(0,0,0,.45) 100%);
}
```
（.55 vs .45）， credit 、。

### 
```css
.layer{
  position:absolute; inset:0; z-index:2;
  padding:3.6cqh 4.4cqh;
  display:flex; flex-direction:column;
  pointer-events:none;
}
.layer *{ text-shadow:0 0 .8cqh rgba(0,0,0,.85) }
.top{
  display:flex; justify-content:space-between; align-items:center;
  font-size:.95cqh; letter-spacing:.32em; text-transform:uppercase; font-weight:500;
}
.bottom{
  margin-top:auto;
  display:flex; justify-content:space-between; align-items:flex-end;
}
```
`margin-top:auto`  footer ，。

###  2×2 （ A）
```html
<div class="title-grid">
  <div class="col"><span class="sm"></span><span class="sm"></span></div>
  <div class="col"><span class="lg"></span><span class="lg"></span></div>
</div>
```
```css
.title-grid{
  display:inline-flex; align-items:flex-start; gap:0;
  font-family:'Noto Sans JP','PingFang SC','Heiti SC',sans-serif;
  font-weight:900; line-height:1.1; letter-spacing:0;
}
.title-grid .col{ display:flex; flex-direction:column }
.title-grid .sm, .title-grid .lg{ font-size:12cqh }
```
****： 4 ，（/ 、/ ），。3 、5 、6 。

### 
```css
.brackets{
  position:relative; padding:1cqh 2.6cqh;
  font-weight:500; font-size:1.1cqh; letter-spacing:.36em;
  text-transform:uppercase;
}
.brackets::before, .brackets::after{
  content:''; position:absolute;
  width:1.3cqh; height:1.3cqh; border:1px solid #fff;
}
.brackets::before{ top:0; left:0; border-right:none; border-bottom:none }
.brackets::after{ bottom:0; right:0; border-left:none; border-top:none }
```
 +  L ， / 。

##  webfont （）

`Noto Sans JP` Heavy （ fallback），； PingFang/Heiti。""：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" fetchpriority="high"
  href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Sans+JP:wght@900&display=swap">
<link rel="stylesheet" media="print" onload="this.media='all'"
  href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Sans+JP:wght@900&display=swap">
<noscript><link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Sans+JP:wght@900&display=swap"></noscript>
```
 `'PingFang SC','Heiti SC'` ； Inter（italic ）。

## 

：
1. ****（）— URL 。 /  / ，****， dither ；，
2. ** + **（）— `No 04 / 2026` +  (CAMPING / TRAVEL / FOOD…) +  2-4 
3. ****（）—  A  4  + ； B/C/D 
4. **wordmark + credit**（）—  2-4  +  /  /  / 
5. ****（）—  1280/1644， 1080/1350、1644/1280、1×1
6. **dither **（）— " /  / "  canvas  900 / 600 / 400

## （）

|  |  |  |
|---|---|---|
| ， |  adjustLevels  |  `adjustLevels(70, 195)`， |
|  | brightness/levels  | brightness ∈ [-30, -10]，levels lo<80 hi>180 |
|  |  text-shadow /  vignette | `text-shadow:0 0 .8cqh rgba(0,0,0,.85)` +  |
|  |  `image-rendering:pixelated` | canvas  image-rendering  |
|  |  vh  cqh |  `container-type:size`， cqh |
|  |  PingFang Regular / Light |  Noto Sans JP 900 + PingFang Heavy  |
|  |  letter-spacing |  `letter-spacing:0` |
|  1-2  | "" |  3 （ /  / wordmark / credit  3） |
|  emoji /  /  |  1-bit  | ， +  |
|  CSS noise |  Canvas Bayer |  Canvas  `bayerDither`， SVG/CSS  |
|  |  |  B/C/D  |

##  .html

 skill ，「 · a fire at midnight」（ A ）。** Bayer 、cqh 、**，"/// + VOL IV / 2026 +  wordmark +  955873829" — 。

## 

-  HTML（HTML + CSS + Canvas  JS）
-  +  `aspect-ratio`，
-  webfont 
- canvas  `image-rendering` 
-  Bayer  — 
