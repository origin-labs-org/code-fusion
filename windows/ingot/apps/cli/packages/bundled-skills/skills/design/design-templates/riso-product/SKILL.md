---
name: riso-product
description: Risograph  /  /  —  +  +  +  /  + Neobrutalism 。7 （+ / + / + / + /  / + / +）× 4 （ landing / home+ /  / ）。：" / riso  /  /  / "、 landing、、。""。
visibility: public
mode: template
carrier: web-page
scenario: brand-landing
pattern_source: reference.html
source_priority: skill-first
triggers:
  - " riso "
  - ""
  - " landing"
  - ""
  - ""
  - ""
  - ""
related_patterns: saas-landing
---

# riso-product — riso 

 risograph " +  + "。 NOIRLAB （ `reference.html`），** skill ，**。

##  skill

1. ****： Read `reference.html`，、、、。**""。**
2. ****： 7 （），** reference +**。
3. ****： 4 （）；** clone reference  home + 4  + **。
4. ****：CSS （halftone、paper、neobrutalism shadow、riso shade、）。
5. ****：" / "。

##  DNA — 

， riso：

1. ****：，//（ 88–94， 8–18）
2. ****： `body::after`  `radial-gradient(circle at 1px 1px, ...)` 5–8px 、`mix-blend-mode: multiply`、opacity 30–55%。（8–12px）
3. ** hero**：hero /  2-3  `radial-gradient` ellipse （ +  +  ，），`mix-blend-mode: multiply`，
4. **/** + ****：`text-shadow: 4px 4px 0 var(--accent-a), 8px 8px 0 var(--accent-b)`，
5. **Neobrutalism **：/ `box-shadow: Npx Npx 0 var(--ink)`（N=4–8），hover  0， `translate(Npx, Npx)`，2px solid 

##  / （）

****：
- [ ]  1 
- [ ] 
- [ ]  1  hero /  2  radial gradient multiply 
- [ ] / 1  + hover 
- [ ] /（ `--hanli` ），** PingFang / Source Han Sans**
- [ ] ，paper 

****：
- [ ]  reference.html  `<section>` （ → header → hero → USP  → feature → cat-grid → material → process → gallery → counters → testi → faq → news → footer + 4  + 1 ）
- [ ]  #FF3F8E +  #2240FF —  NOIRLAB 
- [ ]  /  /  / emoji / 3D 
- [ ]  overlay（、）
- [ ] ， CSS noise；
- [ ]  NOIRLAB  /  /  / 28dB  NOIRLAB 

## （，）

" +  + （)"。 `:root`。

```css
/* 1.  + （NOIRLAB  — ，）*/
--paper:#F1EBDA; --ink:#1B1A18;  --a:#FF3F8E; --b:#2240FF; --c:#FFD23A;

/* 2.  +  — 、、// */
--paper:#EFEEE5; --ink:#1F2A28;  --a:#FF6B5A; --b:#2BB7A1; --c:#FFC857;

/* 3.  +  — 、、// */
--paper:#F4EFE4; --ink:#16151A;  --a:#F4E04D; --b:#6A2EE8; --c:#FF4D8D;

/* 4.  +  — 、、/// */
--paper:#EFE9D8; --ink:#1E1C18;  --a:#C24A6C; --b:#5C6E2C; --c:#D9A24A;

/* 5.  +  —  riso， */
--paper:#1B1A18; --ink:#F1EBDA;  --a:#FF3F8E; --b:#4DE0C7; --c:#FFD23A;
/* ：、screen  */

/* 6.  +  — 、、、 */
--paper:#EDE8D8; --ink:#1B1B1B;  --a:#3D89C7; --b:#D6A92E; --c:#E0625E;

/* 7.  +  — /// */
--paper:#F0E7D5; --ink:#1F1A16;  --a:#C25538; --b:#2F6B7D; --c:#E4B83B;
```

： reference.html  `var(--pink)`  `var(--a)`，`var(--blue)`  `var(--b)`，`var(--yellow)`  `var(--c)`。****，。

## （，"home + 4  + "）

 riso ，****，。

###  A —  landing
```
[announce marquee] → [hero w/ ] → [3  USP] → [ grid 3-6 ]
→ [ spotlight w/  + ] → [ +  counter]
→ [/ 3 ] → [FAQ 5–7 ] → [] → [footer]
```
****。/。 1–4  SKU 。

###  B — ：home + （ hash ）
```
home: [hero +] → [4  grid] → [ 2 ] → [footer]
detail:  detail.html → [ hero  + ] → [ +  sticky ]
        → [3  dgallery] → [ 3 ] → [ home]
```
 1  +  SKU （ 1  + 3 ）。

###  C — /
```
[： + riso  + / mono]
[ contents：，++]
[：， 6:4 /  7:3 /  1:1 / ]
[：mono   + ]
```
 / brand magazine /  / 。 CTA 。

###  D — （fold-only）
```
：
  ：announce + brand
  ：（ 60% ）+ 
  ： CTA + （ lightbox）
。 waitlist / drop /  / event。
```

##  CSS 

###  + （）
```css
body{
  background: var(--paper);
  color: var(--ink);
  position: relative;
}
/* （）*/
body::before{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:9000;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='320' height='320'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .12 0 0 0 0 .10 0 0 0 0 .08 0 0 0 .35 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
  opacity:.45; mix-blend-mode:multiply;
}
/*  */
body::after{
  content:""; position:fixed; inset:0; pointer-events:none; z-index:8990;
  background-image: radial-gradient(circle at 1px 1px, rgba(27,26,24,.08) 1px, transparent 1.4px);
  background-size: 5px 5px;
  mix-blend-mode: multiply; opacity:.55;
}
```

### 
```css
.headline-riso{
  font-family: var(--hanli);  /*  */
  text-shadow: 4px 4px 0 var(--a), 8px 8px 0 var(--b);
  letter-spacing: .04em;
}
/* ： */
.headline-riso--invert{
  color: var(--paper);
  text-shadow: 3px 3px 0 var(--a), 6px 6px 0 var(--c);
}
```

### /（）
```css
:root{
  --hanli: "", "HakushuReisho", "Yuji Mai", "Yuji Boku",
           "ZCOOL XiaoWei", "STLiti", "", "LiSu", "SimLi", Georgia, serif;
}
/*  CDN  */
/* <link href="https://fonts.googleapis.com/css2?family=Yuji+Mai&family=ZCOOL+XiaoWei&display=swap" rel="stylesheet"> */
/*  local()  */
@font-face{
  font-family:"HakushuReisho"; font-display:swap;
  src: local("HOT-ReishoR-K"), local("Hakushu Reisho R"), local("");
}
```
**** PingFang / Source Han Sans / Microsoft YaHei —— riso 。 Inter /  sans。

### riso （/hero ）
```css
.riso-shade{
  position: absolute; inset: 0; pointer-events: none;
  background:
    radial-gradient(ellipse 55% 65% at 18% 25%, rgba(255,63,142,.55) 0%, transparent 60%),
    radial-gradient(ellipse 50% 55% at 82% 75%, rgba(34,64,255,.50) 0%, transparent 60%),
    radial-gradient(ellipse 30% 35% at 65% 18%, rgba(255,210,58,.40) 0%, transparent 70%);
  mix-blend-mode: multiply;
}
```
****：3  ellipse ****（ /  / ）。 = 。

### Neobrutalism 
```css
.btn-riso{
  display:inline-flex; align-items:center; gap:14px;
  padding:16px 28px; font-weight:600; letter-spacing:.05em;
  border:2px solid var(--ink); border-radius:999px;
  background: var(--ink); color: var(--paper);
  box-shadow: 5px 5px 0 var(--a);
  transition: all .25s cubic-bezier(.2,.8,.2,1);
}
.btn-riso:hover{
  background: var(--a); color: var(--paper);
  box-shadow: 0 0 0 var(--a);
  transform: translate(5px, 5px);
}
```
4 ：`--ink`（）/ `--paper`（）/ `--ghost`（ + ink ）/ `--accent`（）。**hover  0 + translate** ，hover """"。

### Neobrutalism 
```css
.card-riso{
  border: 2px solid var(--ink);
  box-shadow: 6px 6px 0 var(--ink);
  background: var(--paper-2);
  transition: transform .3s, box-shadow .3s;
}
.card-riso:hover{
  transform: translate(-3px, -3px);
  box-shadow: 9px 9px 0 var(--a);  /*  +  */
}
```

### （）
```css
.img-riso{
  position: relative; overflow: hidden;
  border: 2px solid var(--ink); box-shadow: 5px 5px 0 var(--a);
}
.img-riso > img,
.img-riso > .img{
  width:100%; height:100%; object-fit: cover;
  filter: contrast(1.05) saturate(.9);  /* ， */
}
.img-riso::after{
  content:""; position:absolute; inset:0; pointer-events:none;
  background-image: radial-gradient(circle at 1px 1px, rgba(34,64,255,.18) 1px, transparent 1.4px);
  background-size: 5px 5px;
  mix-blend-mode: multiply;
}
```
****： 18% ，； `filter: contrast(1.05) saturate(.9)` 。

### （）
```css
.announce{
  background: var(--a); color: var(--paper);
  border-bottom: 2px solid var(--ink); text-shadow: 1.5px 1.5px 0 var(--b);
  height:40px; display:flex; align-items:center; overflow:hidden;
}
.announce__track{ display:flex; gap:64px; white-space:nowrap; animation: marquee 38s linear infinite; }
@keyframes marquee{ from{transform:translateX(0)} to{transform:translateX(-50%)} }
```

##  webfont （）

 Yuji Mai / ZCOOL XiaoWei  +  webfont，。""：

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" fetchpriority="high"
  href="https://fonts.googleapis.com/css2?family=Yuji+Mai&family=ZCOOL+XiaoWei&display=swap">
<link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Yuji+Mai&family=ZCOOL+XiaoWei&display=swap"
  media="print" onload="this.media='all'">
<noscript><link rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Yuji+Mai&family=ZCOOL+XiaoWei&display=swap"></noscript>
```
 `font-display: swap` + （ `--hanli` ）。

## （）

|  |  |  |
|---|---|---|
|  PingFang  | / |  `var(--hanli)` |
|  /  |  | `text-shadow:4px 4px 0 var(--a),8px 8px 0 var(--b)` |
|  #FFFFFF /  | paper  |  #F1EBDA / #EFE9D8 |
|  | opacity 、 | 5–8px ，opacity 30–55% |
|  |  overlay |  18% + `filter: contrast(1.05) saturate(.9)` |
|  hover  |  | hover  0 +  translate |
|  NOIRLAB + |  |  |
|  4  hash  |  clone  reference  |  A/B/C/D  |

##  reference.html

 skill ，** base64 **（ CSS `:root`  `--img-01..06` ）——  ~2.6MB，。**，**。""，；""， A/B/C/D 。

## 

：
1.  + 
2. 1–6  / 1  / （）
3. （ or ）
4. ： or  picsum 
5. " NOIRLAB"（"" →  A ）

## 

-  HTML（ hash ， A/D ，B/C ）
- （≥1024 / 900 / 520 ）
-  webfont 
-  CSS ，CSS 
