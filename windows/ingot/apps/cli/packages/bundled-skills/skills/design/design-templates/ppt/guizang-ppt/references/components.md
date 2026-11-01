#  · Components

 `magazine-web-ppt` skill 。template.html ，"、"。

## 

- [ Slide ](#-slide-)
- [ Typography](#-typography)
- [Chrome & Foot](#chrome--foot)
- [Callout ](#callout-)
- [Stat ](#stat-)
- [Platform ](#platform-)
- [Rowline ](#rowline-)
- [Pillar ](#pillar-)
- [Tag & Kicker](#tag--kicker)
- [Figure ](#figure-)
- [Icons ](#icons-)
- [Ghost ](#ghost-)
- [Highlight ](#highlight-)

---

##  Slide 

 `<section class="slide ...">`。 `data-theme` （`light`  `dark`），JS 。

```html
<section class="slide light" data-theme="light">   <!--  -->
<section class="slide dark" data-theme="dark">     <!--  -->
<section class="slide light hero" data-theme="light">  <!-- Hero ： +  WebGL -->
<section class="slide dark hero" data-theme="dark">    <!-- Hero ： +  -->
```

**light vs dark ：**， 2-3 ， 3 。 WebGL  shader 。

**hero **：（、、、）。 `hero`  12-16%，WebGL ， hero 。

---

##  Typography

，。

| Class |  |  |
|---|---|---|
| `.display` | （Hero ） | Playfair Display 700, 11vw |
| `.display-zh` |  | Noto Serif SC 700, 7.8vw |
| `.h1-zh` |  | Noto Serif SC 700, 4.6vw |
| `.h2-zh` |  | Noto Serif SC 600, 3.2vw |
| `.h3-zh` |  | Noto Serif SC 500, 1.9vw |
| `.lead` | （ body ） | Noto Serif SC 400, 1.9vw |
| `.body-zh` | **/（）** | Noto Sans SC 400, 1.22vw |
| `.body-serif` | （） | Noto Serif SC 400, 1.3vw |
| `.kicker` | （） | IBM Plex Mono, 12px uppercase |
| `.meta` |  | IBM Plex Mono, 0.88vw uppercase |
| `.big-num` |  | Playfair Display 800, 10vw |
| `.mid-num` |  | Playfair Display 700, 5.5vw |

****：
- ****（`serif-zh` / `serif-en`）：、、 —— ""
- ****（`sans-zh`）：、 —— ""
- ****（`mono`）：kicker、meta、foot  —— ""

****：
- `<em class="en"></em>` ——  Playfair Display （）
- `<em style="opacity:.65"></em>` —— ，

---

## Chrome & Foot

。。

```html
<div class="chrome">
  <div class="left">
    <span> · </span>
    <span class="sep"></span>
    <span>Act I</span>
  </div>
  <div class="right"><span>02 / 27</span></div>
</div>

<!-- ...  ... -->

<div class="foot">
  <div class="title"> · CodePilot　|　github.com/codepilot</div>
  <div>Act I · Dev Numbers</div>
</div>
```

****：
- `chrome.right`  `NN / TOTAL` （TOTAL ）
- `foot.title` ，`foot.right`  act 
- chrome  foot ""

---

## Callout 

 /  / 。

```html
<div class="callout" style="max-width:80vw">
  <div class="q-big">"，<br>。"</div>
  <span class="cite">— </span>
</div>
```

：
-  cite： `<span class="cite">` 
- ：`<em class="en">"Thin Harness, Fat Skills."</em>`
-  hero ： `style="position:relative;z-index:2"`（）

---

## Stat 

， `.grid-6` / `.grid-4` 。

```html
<div class="grid-6">
  <div class="stat">
    <span class="m">Duration</span>
    <span class="n">64<em style="font-size:.4em;opacity:.5;font-style:normal"> </em></span>
    <span class="l"> 0 </span>
  </div>
  <!-- ...  stat ... -->
</div>
```

：`.m`  → `.n`  → `.l` 。 `<em>`  0.4em，opacity 0.5。

****：
- `.grid-6` — 3×2 （，6  stat）
- `.grid-4` — 2×2 （4  stat）
- `.grid-3` — 3 （3  stat / pillar）

---

## Platform 

 /  + 。

```html
<div class="plat">
  <div class="sub">Weibo</div>
  <div class="name"></div>
  <div class="nb">289K</div>
</div>
```

（）：
```html
<div class="body-zh" style="font-size:max(11px,.8vw);opacity:.5;margin-top:.6vh">
  
</div>
```

**"Also On" **（）：
```html
<div class="plat" style="border-top-style:dashed;opacity:.72">
  <div class="sub">Also On</div>
  <div class="body-zh" style="font-weight:600;margin-top:.8vh">
    B 　·　
  </div>
</div>
```

---

## Rowline 

，。

```html
<div class="rowline">
  <div class="k">CLAUDE.md</div>
  <div class="v"> ——  +  + </div>
  <div class="m">EMPLOYEE · HANDBOOK</div>
</div>
```

：`.k`  · `.v`  · `.m` （）。 rowline 。

**：2 **：`style="grid-template-columns:1fr 3fr"`  `.m` 。

---

## Pillar 

，""。

```html
<div class="grid-3">
  <div class="pillar">
    <div class="ic">01</div>
    <div class="t"><br></div>
    <div class="d">CLAUDE.md<br>+ <br>+ </div>
  </div>
  <!-- ...  pillar ... -->
</div>
```

** pillar（）**：
```html
<div class="pillar" style="padding:4vh 2vw;border:1px solid currentColor;border-color:rgba(10,10,11,.2)">
  <div class="ic"><i data-lucide="compass" class="ico-lg"></i></div>
  <div class="t"></div>
  <div class="d">。<br>、、。</div>
</div>
```

`.ic` （`01 / 02 / 03`  `A. / B. / C.`）， Lucide 。

---

## Tag & Kicker

**Kicker** （、、）：
```html
<div class="kicker"> 64  · </div>
<div class="h1-zh">，。</div>
```

**Tag** （）：
```html
<div style="display:flex;gap:1.6vw;flex-wrap:wrap">
  <div class="tag"> 10 </div>
  <div class="tag"> / </div>
  <div class="tag"> · </div>
</div>
```

---

## Figure 

**，**。

### 

```html
<figure class="tile">
  <div class="frame-img" style="height:26vh">
    <img src="/xxx.png" alt="">
  </div>
  <figcaption class="frame-cap">
    <span class="pf"> · Twitter</span>
    <span class="nb">137K</span>
  </figcaption>
</figure>
```

### （，）

1. ** `height:Nvh` **， `aspect-ratio`。
   - ： aspect-ratio ，。
   - ：`height:18vh` () / `22vh` () / `26vh` () / `28vh` ()。

2. **`object-position:top center`（ CSS ）**，。
   -  —— 。

3. **， grid  `grid-3`**：
   ```html
   <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1vh 1.2vw">
     <figure class="tile">...</figure>
     <figure class="tile">...</figure>
     <figure class="tile">...</figure>
   </div>
   ```

4. ****：figure  `align-self:end` 。

### Frame Caption 

```html
<!-- ： figure ， -->
<figcaption class="frame-cap">
  <span class="pf"> · Twitter</span>
  <span class="nb">137K</span>
</figcaption>

<!--  -->
<figcaption class="frame-cap">
  <span class="idx">01</span>
  <span class="pf">AI </span>
  <span>Polish</span>
</figcaption>
```

### （）

，：
```html
<div class="img-slot r-4x3">  <!-- r-4x3 / r-16x9(default) / r-3x2 / r-1x1 -->
  <span class="plus">+</span>
  <span class="label">GitHub </span>
</div>
```

---

## Icons 

** emoji**。 Lucide via CDN（template.html ）。

```html
<i data-lucide="compass" class="ico-lg"></i>     <!-- （pillar ） -->
<i data-lucide="target" class="ico-md"></i>      <!-- （） -->
<i data-lucide="check-circle" class="ico-sm"></i>  <!-- （inline ） -->
```

** Lucide **（）：

- ：`compass`, `target`, `crosshair`, `search-check`
- ：`share-2`, `users`, `network`, `link`, `handshake`
- ：`crown`, `gem`, `award`, `star`, `badge-check`
- ：`workflow`, `route`, `arrow-right-left`, `repeat`
- ：`grid-2x2`, `bar-chart-3`, `trending-up`, `activity`
- ：`palette`, `brush`, `eye`, `sparkles`
- ：`check-circle`, `x-circle`, `check`, `x`
- ：`arrow-right`, `arrow-up-right`, `corner-down-right`

** inline **：
```html
<div class="h3-zh" style="display:flex;align-items:center;gap:.8em">
  <i data-lucide="target" class="ico-md"></i>
   — 
</div>
```

---

## Ghost 

""，，。

```html
<div class="ghost" style="right:-6vw;top:-8vh">BUT</div>
<div class="ghost" style="left:-8vw;bottom:-18vh;font-style:italic">Harness</div>
```

-  34vw，opacity 0.06
- ：`right:-6vw;top:-8vh`（）/ `left:-8vw;bottom:-18vh`（）
- ：（ 01/02/03、 BUT/NOW/HERE）

****： ghost ， `position:relative;z-index:2` 。

---

## Highlight 

""：

```html
<span class="hi"></span>
<span class="hi"></span>
```

。，（CSS ）。

****： 1-3 ，。
