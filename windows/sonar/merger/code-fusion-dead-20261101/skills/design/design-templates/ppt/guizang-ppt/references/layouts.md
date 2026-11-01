# （Layouts）

 10 。 `<section class="slide ...">...</section>` ，/。

---

## ⚠️ （Pre-flight）

### A.  template.html

layouts.md （`h-hero` / `h-xl` / `h-sub` / `h-md` / `lead` / `meta-row` / `stat-card` / `stat-label` / `stat-nb` / `stat-unit` / `stat-note` / `pipeline-section` / `pipeline-label` / `pipeline` / `step` / `step-nb` / `step-title` / `step-desc` / `grid-2-7-5` / `grid-2-6-6` / `grid-2-8-4` / `grid-3-3` / `grid-6` / `grid-3` / `grid-4` / `frame` / `frame-img` / `img-cap` / `callout` / `callout-src` / `kicker`） `assets/template.html`  `<style>` 。

****。， `style="..."` inline 。，grep template.html 。

### B. （）

****， `aspect-ratio: 2592/1798` ：

|  |  |  |
|------|---------|------|
|   | 16:10  4:3 | `aspect-ratio:16/10; max-height:54vh` |
| （） |  | ** `height:26vh`， aspect-ratio** |
|  +  | 1:1  3:2 | `aspect-ratio:1/1; max-width:40vw` |
|  | 16:9 | `aspect-ratio:16/9; max-height:64vh` |
|  | 3:2 | `aspect-ratio:3/2; max-width:30vw` |

 `<figure class="frame-img">` ， `<img>`  `object-fit:cover + object-position:top center`，，//。

### C. （、）

****（，）：
-  grid  `align-self:end`：`align-self`  flex/grid ，
-  `position:absolute + bottom:0` ""： `.foot`  `#nav` 
-  `height:N vh`  `max-height`：

****：
- ** `.frame.grid-2-7-5`**（ `.grid-2-6-6` / `.grid-2-8-4`） grid 
- grid  `align-items:start`（ template ）， cell 
- " callout"：** flex column + `justify-content:space-between`**（ callout ），** figure  align-items:start **， `align-self:end`
-  grid  inline `style="padding-top:6vh"`，

### D. 

-  `references/themes.md`  5 , hex 
- ( light / dark / hero light / hero dark )"",
- ,

---

## 0. （ slide ）

```html
<section class="slide [light|dark|hero light|hero dark]">
  <div class="chrome">
    <div> · </div>
    <div>ACT ·  / </div>
  </div>
  <!--  -->
  <div class="foot">
    <div> · Page Description</div>
    <div>— · —</div>
  </div>
</section>
```

-  hero  `light`  `dark` ；hero  `hero light`  `hero dark`（ WebGL ）
- `chrome`  `foot` 
- **hero ///**， hero 

### ⚠️ chrome  kicker 

。：

|  |  |  |  |
|------|------|---------|------|
| `.chrome`  | ** / ** | """"， | "Act II · Workflow" / "Data · Result" / "lukew.com · 2026.04" |
| `.chrome`  | ** + ** |  | "Act II · 15 / 25" |
| `.kicker` | **** | ""，， | "BUT" / ",。" / "Phase 01 · " |

****（）：chrome " · Design First"，kicker "Phase 01 · "——， AI 。

****：chrome ****（、），kicker ****（、），，。

### ⚠️ （ · )

****: `<section>`  `light` / `dark` / `hero light` / `hero dark` 。JS  class , body  `light-bg`,/ WebGL canvas 。 = fallback 。

#### 

| Layout |  |  |
|---|---|---|
| 1.  | `hero dark` | , |
| 2.  | `hero dark`  `hero light` **** |  |
| 3. () | `light` | ; `dark` |
| 4.  | **`light` / `dark` ** |  |
| 5.  | `light` |  |
| 6. Pipeline | `light` |  |
| 7.  | `hero dark` |  |
| 8.  | **`dark` **, `light` |  |
| 9.  | `light` |  |
| 10.  | **`light` / `dark` ** |  |

#### ( grep )

- ❌ **** 3 ( light  dark )
- ❌ ****8  deck  1  `hero dark` + 1  `hero light`
- ❌ **** deck  `light`  `dark` ——、
- ✅ **** 3-4  1  hero(///)

#### 8 ()

|  |  |  |  |
|---|---|---|---|
| 1 | `hero dark` |  |  |
| 2 | `light` |  |  |
| 3 | `dark` |  | / |
| 4 | `light` | Pipeline |  |
| 5 | `hero light` |  |  |
| 6 | `dark` |  or  | |
| 7 | `hero dark` |  |  |
| 8 | `light` | / |  |

**, slide**。 =  light。

---

## Layout 1: （Hero Cover）

```html
<section class="slide hero dark">
  <div class="chrome">
    <div>A Talk · 2026.04.22</div>
    <div>Vol.01</div>
  </div>
  <div class="frame" style="display:grid; gap:4vh; align-content:center; min-height:80vh">
    <div class="kicker"> · </div>
    <h1 class="h-hero"></h1>
    <h2 class="h-sub"> AI </h2>
    <p class="lead" style="max-width:60vw">
       AI  ——  64  11 、 9 ，。
    </p>
    <div class="meta-row">
      <span> Guizang</span><span>·</span><span> / CodePilot </span>
    </div>
  </div>
  <div class="foot">
    <div> AI ·  · </div>
    <div>— 2026 —</div>
  </div>
</section>
```

****：
-  `hero dark`  WebGL 
- `h-hero` （10vw），
-  `min-height:80vh + align-content:center` 
-  `.chrome` ，

---

## Layout 2: （Act Divider）

```html
<section class="slide hero light">
  <div class="chrome">
    <div> · </div>
    <div>Act I · 01 / 25</div>
  </div>
  <div class="frame" style="display:grid; gap:6vh; align-content:center; min-height:80vh">
    <div class="kicker">Act I</div>
    <h1 class="h-hero" style="font-size:8.5vw"></h1>
    <p class="lead" style="max-width:55vw">
      ，。
    </p>
  </div>
  <div class="foot">
    <div></div>
    <div>— · —</div>
  </div>
</section>
```

****：
- ， kicker +  + 
-  `hero light` / `hero dark`，
- `h-hero`  10vw  8.5vw 

---

## Layout 3: （Big Numbers Grid）

```html
<section class="slide light">
  <div class="chrome">
    <div> 64  · </div>
    <div>Act I / Dev · 02 / 25</div>
  </div>
  <div class="frame" style="padding-top:6vh">
    <div class="kicker">，。</div>
    <h2 class="h-xl"> 64 </h2>
    <p class="lead" style="margin-bottom:5vh"> 0  CodePilot。</p>

    <div class="grid-6" style="margin-top:6vh">
      <div class="stat-card">
        <div class="stat-label">Duration</div>
        <div class="stat-nb">64 <span class="stat-unit"></span></div>
        <div class="stat-note"> 0 </div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Lines of Code</div>
        <div class="stat-nb">110K+</div>
        <div class="stat-note"> 11 +</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">GitHub Stars</div>
        <div class="stat-nb">5,166</div>
        <div class="stat-note"></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Downloads</div>
        <div class="stat-nb">41K+</div>
        <div class="stat-note"></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">AI Providers</div>
        <div class="stat-nb">19</div>
        <div class="stat-note"></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Commits</div>
        <div class="stat-nb">608+</div>
        <div class="stat-note"></div>
      </div>
    </div>
  </div>
  <div class="foot">
    <div> · CodePilot　|　github.com/codepilot</div>
    <div>Act I · Dev Numbers</div>
  </div>
</section>
```

****：
- 3×2  4×2 （ `.grid-6`）
-  `stat-card` ：label（）→ nb（）→ note（）
-  2-3 （）， K / M 
-  5vh ，

---

## Layout 4: （Quote + Image）

```html
<section class="slide light">
  <div class="chrome">
    <div> · The Twist</div>
    <div>03 / 25</div>
  </div>
  <div class="frame grid-2-7-5" style="padding-top:6vh">
    <!-- ： +  + callout，flex column  callout  -->
    <div style="display:flex; flex-direction:column; justify-content:space-between; gap:3vh">
      <div>
        <div class="kicker">BUT</div>
        <h2 class="h-xl" style="white-space:nowrap; font-size:7.2vw">
          。
        </h2>
        <p class="lead" style="margin-top:3vh">
          。 UI  AI 。
        </p>
      </div>
      <div class="callout">
        "，<br>
        。"
        <div class="callout-src">— </div>
      </div>
    </div>
    <!-- ： 16/10  + max-height， align-self:end -->
    <figure class="frame-img" style="aspect-ratio:16/10; max-height:56vh">
      <img src="images/codepilot.png" alt="CodePilot ">
      <figcaption class="img-cap">CodePilot · </figcaption>
    </figure>
  </div>
  <div class="foot">
    <div>Page 03 · </div>
    <div>— · —</div>
  </div>
</section>
```

****：
-  `grid-2-7-5`（ 7 、 5 ），`align-items:start`  template 
- **** flex column + `justify-content:space-between`：，callout 
- **** ** `align-self:end`**。 cell ，
-  ** 16/10  4/3 + `max-height:56vh`**，（`2592/1798` ）

---

## Layout 5: （）

```html
<section class="slide light">
  <div class="chrome">
    <div></div>
    <div>Act I / Ops · 05 / 27</div>
  </div>
  <div class="frame" style="padding-top:5vh">
    <div class="kicker">Proof · </div>
    <h2 class="h-xl">10  · 6 </h2>

    <div class="grid-3-3" style="margin-top:4vh">
      <figure class="frame-img" style="height:26vh">
        <img src="images/weibo.png" alt=" 289K">
        <figcaption class="img-cap"> · 289K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/twitter.png" alt=" 137K">
        <figcaption class="img-cap"> · 137K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/wechat.png" alt=" 96K">
        <figcaption class="img-cap"> · 96K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/jike.png" alt=" 26K">
        <figcaption class="img-cap"> · 26K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/xhs.png" alt=" 19K">
        <figcaption class="img-cap"> · 19K</figcaption>
      </figure>
      <figure class="frame-img" style="height:26vh">
        <img src="images/douyin.png" alt=" 10K">
        <figcaption class="img-cap"> · 10K</figcaption>
      </figure>
    </div>
  </div>
  <div class="foot">
    <div> · 2026.04</div>
    <div>Page 05 · </div>
  </div>
</section>
```

****：
- ： `frame-img`  `height:NNvh`（ `aspect-ratio`），
-  `object-fit:cover + object-position:top`，
-  `.grid-3-3`（3×2） `.grid-3`（3×1）

---

## Layout 6: （Pipeline）

```html
<section class="slide light">
  <div class="chrome">
    <div> · Workflow</div>
    <div>Act II · 15 / 27</div>
  </div>
  <div class="frame">
    <div class="kicker">Pipeline · </div>
    <h2 class="h-xl"></h2>

    <!-- ： -->
    <div class="pipeline-section">
      <div class="pipeline-label"> · Text Pipeline</div>
      <div class="pipeline">
        <div class="step">
          <div class="step-nb">01</div>
          <div class="step-title">Draft</div>
          <div class="step-desc">AI </div>
        </div>
        <div class="step">
          <div class="step-nb">02</div>
          <div class="step-title">Polish</div>
          <div class="step-desc">AI  AI </div>
        </div>
        <div class="step">
          <div class="step-nb">03</div>
          <div class="step-title">Morph</div>
          <div class="step-desc">AI  / </div>
        </div>
        <div class="step">
          <div class="step-nb">04</div>
          <div class="step-title">Illustrate</div>
          <div class="step-desc">AI </div>
        </div>
        <div class="step">
          <div class="step-nb">05</div>
          <div class="step-title">Distribute</div>
          <div class="step-desc"> 9 </div>
        </div>
      </div>
    </div>

    <!-- ： -->
    <div class="pipeline-section">
      <div class="pipeline-label"> ·  · Video Pipeline</div>
      <div class="pipeline">
        <div class="step">
          <div class="step-nb">06</div>
          <div class="step-title">Cut</div>
          <div class="step-desc">AI </div>
        </div>
        <div class="step">
          <div class="step-nb">07</div>
          <div class="step-title">Wrap</div>
          <div class="step-desc">AI </div>
        </div>
        <div class="step">
          <div class="step-nb">08</div>
          <div class="step-title">Cover</div>
          <div class="step-desc">AI </div>
        </div>
      </div>
    </div>
  </div>
  <div class="foot">
    <div>Page 15 · </div>
    <div>Workflow</div>
  </div>
</section>
```

****：
-  `.pipeline-section`  + `.pipeline-label` 
-  3.6vh  + （ CSS ）
-  step  nb → title → desc 
-  ≤5 ， pipeline

---

## Layout 7:  / （Hero Question）

```html
<section class="slide hero dark">
  <div class="chrome">
    <div></div>
    <div>24 / 27</div>
  </div>
  <div class="frame" style="display:grid; gap:8vh; align-content:center; min-height:80vh">
    <div class="kicker">The Question</div>
    <h1 class="h-hero" style="font-size:7vw; line-height:1.15">
      ，<br>
      <br>
      ？
    </h1>
    <p class="lead" style="max-width:50vw">
      ，，。
    </p>
  </div>
  <div class="foot">
    <div>Page 24 · The Question</div>
    <div>— · —</div>
  </div>
</section>
```

****：
- Hero ，
- `h-hero` （7vw  3 ，10vw  1 ）
-  `<br>` ，
-  `lead` 

---

## Layout 8: （Big Quote · ）

```html
<section class="slide light">
  <div class="chrome">
    <div>The Takeaway · </div>
    <div>18 / 25</div>
  </div>
  <div class="frame" style="display:grid; gap:5vh; align-content:center; min-height:80vh">
    <div class="kicker">Quote · </div>
    <blockquote style="font-family:var(--serif-zh); font-weight:700; font-size:5.8vw; line-height:1.2; letter-spacing:-.01em; max-width:72vw">
      ",<br>。"
    </blockquote>
    <p class="lead" style="max-width:55vw; opacity:.65">
      Without the handoff, everyone builds.<br>
      And that makes all the difference.
    </p>
    <div class="meta-row">
      <span>— Luke Wroblewski</span><span>·</span><span>2026.04.16</span>
    </div>
  </div>
  <div class="foot">
    <div>Page 18 · </div>
    <div>— · —</div>
  </div>
</section>
```

****：
- , + 
- `<blockquote>`  inline style （5-6vw）, `h-hero`（）
- （lead · opacity:.65）
-  `meta-row`  · 

---

## Layout 9: （A vs B ·  vs ）

```html
<section class="slide light">
  <div class="chrome">
    <div> vs  · The Shift</div>
    <div>12 / 25</div>
  </div>
  <div class="frame" style="padding-top:5vh">
    <div class="kicker">Before / After · </div>
    <h2 class="h-xl" style="margin-bottom:4vh"></h2>

    <div class="grid-2-6-6" style="gap:5vw 4vh">
      <!-- ： -->
      <div style="padding:3vh 2vw; border-left:3px solid currentColor; opacity:.55">
        <div class="kicker" style="opacity:.9">Before · </div>
        <h3 class="h-md" style="margin-top:2vh"> →  → </h3>
        <ul style="margin-top:3vh; padding-left:1.2em; display:flex; flex-direction:column; gap:1.4vh; font-family:var(--sans-zh); font-size:max(14px,1.1vw); line-height:1.55">
          <li> Figma </li>
          <li></li>
          <li> PR </li>
          <li></li>
        </ul>
      </div>
      <!-- : -->
      <div style="padding:3vh 2vw; border-left:3px solid currentColor">
        <div class="kicker" style="opacity:.9">After · </div>
        <h3 class="h-md" style="margin-top:2vh"> ·  · </h3>
        <ul style="margin-top:3vh; padding-left:1.2em; display:flex; flex-direction:column; gap:1.4vh; font-family:var(--sans-zh); font-size:max(14px,1.1vw); line-height:1.55">
          <li> Intent </li>
          <li>agents.md </li>
          <li> /  / </li>
          <li></li>
        </ul>
      </div>
    </div>
  </div>
  <div class="foot">
    <div>Page 12 · </div>
    <div>Before / After</div>
  </div>
</section>
```

****：
-  `.grid-2-6-6`（1:1）
-  `opacity:.55` "",""
-  `border-left:3px solid` + `padding-left` 
- :`kicker` → `h-md` → `<ul>` ,

---

## Layout 10: （Lead Image + Side Text）

```html
<section class="slide light">
  <div class="chrome">
    <div>Design First · </div>
    <div>08 / 16</div>
  </div>
  <div class="frame grid-2-8-4" style="padding-top:6vh">
    <!-- : +  -->
    <div>
      <div class="kicker">Phase 01 · </div>
      <h2 class="h-xl" style="margin-top:1vh; margin-bottom:3vh"> · 2 </h2>

      <p class="lead" style="margin-bottom:3vh">
         Figma , /  /  / ,。
      </p>

      <p style="font-family:var(--sans-zh); font-size:max(14px,1.15vw); line-height:1.75; opacity:.78; margin-bottom:2.4vh">
        ,、、。——。
      </p>

      <div class="callout" style="margin-top:3vh">
        "This phase was pretty standard.<br>Just a solid Web design process."
        <div class="callout-src">— Luke Wroblewski</div>
      </div>
    </div>
    <!-- : ·  -->
    <figure class="frame-img" style="aspect-ratio:3/4; max-height:60vh">
      <img src="images/figma.png" alt="Figma design system">
      <figcaption class="img-cap">Figma · Design System</figcaption>
    </figure>
  </div>
  <div class="foot">
    <div>Page 08 · Design First</div>
    <div> 2 </div>
  </div>
</section>
```

****：
- `.grid-2-8-4`(8:4) ,
- :kicker →  → lead →  → callout()
-  ** 3:4**  1:1,
- ****( Layout 4 )

---

## ：

|  |  |  |
|---|---|---|
| `.grid-2-6-6` | 6:6（1:1） |  |
| `.grid-2-7-5` | 7:5 |  +  |
| `.grid-2-8-4` | 8:4（2:1） |  + / |
| `.grid-3` | 1:1:1 | 3 （/） |
| `.grid-3-3` | 3×2 | 6  |
| `.grid-6` | 3×2 | 6  |

 `gap: 3vw 4vh`（ 3vw、 4vh），。

---

## 

 25-30 ，：

1. **Hero Cover**（ 1 ）
2. **Act Divider**（，hero light  hero dark）
3. **Big Numbers**（）
4. **Quote + Image**（/）
5. **Image Grid**（）
6. **Hero Question**（，）
7. ... 、 ...
8. **Hero Close**（，）

hero  non-hero  **2-3 : 1 **， 3  non-hero， 2  hero。
