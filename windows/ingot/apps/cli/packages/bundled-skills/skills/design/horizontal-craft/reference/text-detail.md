#  Text Typesetting Details

「，」——，""。

> ****： /  /  /  /  /  /  /  / Ruby 。
> ****（ /  / 4  /  / ） `punctuation.md`。
> ****（ / ） `title-and-breaking.md`。

## 、（Type area）：

""。

- ****（ 48 、 30 、）→ ""，，
- ****（ 17–25 、）→ 、、

，，，。

### 
1. ****：（）< （）。。
2. ****： < 。。
3. ****： **2 : 3 : 5 : 8**  **3 : 5 : 8 : 13**（）

（）：
```
 :  :  :  = 3 : 5 : 8 : 13
 L3 + R5 + O8 + U13 （）
```

### Web/H5 
 375px  H5：
-  375， 20–24px， 327–335px
-  24–32px， 32–48px
-  16/24/32（4 ）

## 、 

**：，。**

### （Face ratio）
。：
- ：92%
- ：94%
- ：~96%
- ：96%
- ：~95%

 < 100% ****，。

### 
- ****：letter-spacing 0，
- ****（≥ 24pt）： 0.05–0.1em 
- ****（≥ 40pt ）： 0.1–0.2em
- **Logo / **：

### 4 （W3C ）

|  |  |  |
|---|---|---|
| **** | 0 |  |
| **** | 1/4 em / 1/3 em / 1/2 em / 1 em | 、、、 |
| **** |  | ； |
| **** |  | 、（****）|

CSS ：
```css
/* ， */
.body { letter-spacing: 0; }

/*  */
.headline { letter-spacing: 0.05em; }

/*  */
.body-bad { letter-spacing: 1px; } /*  */
```

## 、 

### 
| （:） |  |  |
|---|---|---|
| 1 : 1.0 | 、 | 、（） |
| 1 : 1.33 |  | 、 |
| **1 : 1.5** | **** | **、** |
| 1 : 1.7 |  | 、 |
| 1 : 2.0 |  | 、、 |
| 1 : 2.5+ | ， |  |

W3C ：**（）=  50%–100%**；（）=  1.5–2 。 100% 。

（ 1918 ）， :  **1:1 ~ 4:3** ，。

### 
-  9pt →  12–18pt（ 18pt = 1:2 ）
-  10.5pt →  14–18pt
-  16px → line-height 1.5–1.7（= 24–27px）
-  14px → line-height 1.6–1.8

**。** /。

### （W3C）
- （﹏）、（﹏）、：
  - ** ≥ 1/2 **
  - ** ≥ 5/8 **
- ： ≥ 1.5 × 

## 、

### 
- （/）
- ** + ** >  + （）
- ** + ** ，

：，，""。

### 
|  |  |  |  |
|---|---|---|---|
|  | < 12px | < 6pt | Medium / Bold（55S–65S） |
|  | 12–14px | 6–7.5pt | Regular / Medium（45S–55S） |
|  | 14–18px | 8–10pt | Regular（45S–55S） |
|  | 18–24px | 10–14pt | Regular / Light（35S–45S） |
|  | > 24px | > 14pt | Light / Thin （25S–45S） |

### 
 × ，，。：，，，。

：** >  >  > **。。

## 、

### ： 2 
- 、、、：， 2 ； 1 
- 、H5、、Dashboard、PPT、：，、、
- //； 4 
- 
- ，“ + ”

###  4 （W3C CLReq §6.2.1）

|  |  |  |
|---|---|---|
| **1. ** |  2  | 、、、 |
| **2. ，** | ， 2  | 、、 |
| **3.  + ** | ， | 、、H5、PPT、、Markdown  |
| **4. ** | ， | 、、 |

### （Hanging Indent）

、。：
- 
- Q&A 
- 
- 
- （）

```
：，
      。
：，
      。
```

CSS：
```css
.hanging {
  text-indent: -4em;       /*  4  */
  padding-left: 4em;        /*  4  */
}
```

### （Block Indent）

，、、。，，。

```css
blockquote {
  margin: 1em 4em 1em 4em;     /*  4  */
  font-style: normal;          /*  */
}
```

### 
：，。
- ：，、、；
- ： 6 （），
- ：；/，//UI 

""，——**，**。

###  4 （W3C）
- ****：、、
- ****：（）
- ****：、、（）
- ****： / ；** / **

## 、

：****，。

：
1.  → 
2.  → 
3.  → 
4. （）→ 
5.  → 

：
1. （justify）
2. 
3. 
4.  + 
5. 

### CSS 
```css
.body {
  text-align: justify;
  text-justify: inter-character;   /*  */
  text-spacing-trim: space-all;
  line-break: strict;
}
```

## 、

- ** 1/4 **（）
  - Web: `<span></span> <span>english</span>` ； `text-autospace`（IE ）/CSS Text Module Level 4  `text-spacing`
  - Markdown ：
- （）
- ：` 3 `， `3`
- ：`30px` `9pt`， `30 px`

###  W3C 

- ；
- / **≤ 1/4 em**（ 1/4 em， 1/8 em， 1/2 em）
- /****
- 、、/**、**

## 、（Widow & Orphan）

""。 `title-and-breaking.md` §。

### （Orphan）
 1  + 1 。

：
1. ****（）：、、
2. ****： 1–2 
3. ****： 1 ≥3 
4. ****（）：

### （Widow）
。

：
1. ****： 1 
2. ** 1 **：
3. ****：
4. ****： 1 

CSS：
```css
p {
  orphans: 2;       /*  2  */
  widows: 2;        /*  2  */
}
```

## 、Ruby  / （W3C CLReq §5.5）

### （Bopomofo，）
-  / ****
-  :  = **3 : 10**
- ； = 1 : 15
- ：
  - ：****
  - ：
  - ：
- 、

### 
- ****
- ****（）
-  =  **1/2**
-  ≥  ≈ 1/4 
- ： a / g 、****（/，）

****：
1. ****：、、
2. ****：、 1/2 、/、

### HTML5 Ruby

```html
<!--  -->
<ruby>
  <rt>hàn</rt><rt>yǔ</rt><rt>pīn</rt><rt>yīn</rt>
</ruby>

<!--  -->
<ruby>
  <rt>Hànyǔ Pīnyīn</rt>
</ruby>

<!--  -->
<ruby>
  <rp>(</rp><rt>hàn</rt><rp>)</rp>
</ruby>
```

CSS：
```css
ruby {
  ruby-position: over;            /*  */
  /* ruby-position: under;        // （）*/
}

rt {
  font-size: 0.5em;               /*  =  1/2 */
  font-family: "Source Sans Pro", "Inter", sans-serif;
  line-height: 1;
}
```

### ：CSS Ruby ；Apple Books 。Web  `<sup>` 。

## 、（）

- [ ]  17–40 （ 48  / 55 ）？
- [ ]  1.5–2 ？
- [ ] ？
- [ ] ？
- [ ]  <  <  <  ？
- [ ]  letter-spacing  0？
- [ ] （/，/）？
- [ ] ？
- [ ]  1/4 ？
- [ ] " + "？
- [ ] ""？
- [ ] ？
- [ ]  4 ？

，""。
