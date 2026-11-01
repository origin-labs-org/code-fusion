#  Punctuation： /  /  / 

""。 5%–15%， 95% ""。 6 ：4 、/、4 、/、、Unicode 。

## 、4 

。。

### 1. （Full-width）
-  1 
- ：（）、《》
- ：
- ：""（` "。（ `  ≈ 3 ）
- CSS：（）

### 2. （Half-width）
-  0.5 
- ：（《》）、 2018 （ WebFont SF Pro SC）
- ：，
- ：，
- CSS：`font-feature-settings: "halt" 1;` 

### 3. （Kaiming-style，）
- ****：`。 ？ ！`（、、）
- ****：`， 、 ； ：`（、、、）
- ：、、
- ****
- CSS： InDesign 

### 4. （Centered，）
-  + 
- （）
- ：、
- ：、
- ："。"
- CSS：（、）

### 

|  |  |  |
|---|---|---|
|  /  /  |  |  |
|  /  /  |  |  |
|  |  |  |
|  /  /  |  |  |
| （） | （） |  `text-spacing-trim`  |
|  / App（） |  + `text-spacing-trim` |  |
|  /  |  |  |

## 、 vs 

**。**

### （Additive，）
-  = ****
- ****
-  = （、、）
- ：InDesign、QuarkXPress、JIS、Adobe 
- ：

### （Subtractive，）
-  = ****
- ""
-  = 
- ：、Word 
- ：

### 

** InDesign / Adobe **：。""（、、）；（、、）—— （""）， Adobe 。

****：，，。

**Web / CSS**： `text-spacing-trim: space-all` 。

###  3 

|  |  |  |
|---|---|---|
| ** 1 **： | 、、、 `？！` | 0 |
| ** 2 **：（ + ） |  /  /  /  /  /  / ； ""''； ()；《》 |  +  =  |
| ** 3 **：（ + ） |  /  / ； `・` |  +  1/4 +  1/4 =  |

## 、（GB/T 15834-2011 §5.1.10）

****：，****。" → "。

- 
- ：（）
- ：InDesign "" → （）；CSS `hanging-punctuation: allow-end` 

## 、 4 （W3C CLReq §6.1.1）

**。**

### 0 ：none（）
- 
- （）
- 

### 1 ：basic（，）
- ****：`。， 、 ； ： ！ ？ … 》 」 』 ） 】`、""、 `–`、 `·`、 `/`
- ****：`（ 【 《 「 『 " '`、""

### 2 ：GB （，）
- basic 
- ****： `/` 
- 

### 3 ：strict（，/）
- GB 
- ****： `——` 
- ****： `……` 
- InDesign "" 

### 

#### 
```
。，、；：？！…—··――
）】〗〕〉》」』〙〗｠
’"
%‰‱℃℉°′″
／、‧/
```

#### 
```
（【〖〔〈《「『〘〖｟
‘"
$¥€£¢₩₫
```

#### （）
```
——     （2 ）
……     （2 ）
123456 
50%    +  /  / 
20℃   + 
±5     + 
m²     + 
①②     + 
word   （ hyphenation）
```

### ：""

W3C 。

1. ****：""
   -  → 
   -  → 
   -  1/4 em → 1/8 em
2. ****：，
3. ****：
4. ****：

****：**，；**。

### ：（justify within）

，。。

## 、 / （W3C CLReq §6.2.2）

**， InDesign 。**

### （）

|  |  |  |
|---|---|---|
| a | **** | （GB/T 15834-2011 §5.1.10） |
| b |  |  **1/4 em**， |
| c |  `·` | ， 0（） |
| d | （）| 、， |
| e |  /  /  | ， |
| f |  |  **1/8 em**（ 1/4 em ） |
| g |  /  /  | （，） |

### （）

|  |  |  |
|---|---|---|
| a |  |  **1/2 em**， |
| b |  |  1/4 em ， **1/2 em**（ 1/3 em）|
| c（） |  | ，****；、 |

### 

|  |  |  |  |
|---|---|---|---|
|  | 1/4 em | 1/3 em | 1/2 em |
|  | 1/8 em | 1/4 em | 1/2 em |
|  | 0 | 1/4 em | 1/4 em |
|  |  |  | （） |
|  2  | 1  | 1.5  | 2  |

## 、（W3C CLReq §6.3.2）

****：""。

：
```
（）、《》"
，"。（）
                              ↑↑↑
                       "。（  3 
```

：
```
（）、《》"
，"。（）《》
                       ↑↑
            "。（  1.5 
```

### 
-  2 ** 1.5 **
-  1 （ 1 ，）
- /

### 
- InDesign： →  → "" → ""
- CSS：`text-spacing-trim: space-all`（）

## 、

**。**

### 1. 
1. **U+2E3A** TWO EM DASH `⸺` —— ， 2 ，****
2. **U+2014** EM DASH `—` × 2 —— ， `ccmp` ，****
3. ❌ U+2015 HORIZONTAL BAR `―` —— 
4. ❌ U+2500 BOX DRAWINGS LIGHT HORIZONTAL `─` —— （）
5. ❌ U+30FC KATAKANA-HIRAGANA PROLONGED SOUND MARK `ー` —— 
6. ❌ U+FF0D FULLWIDTH HYPHEN-MINUS `－` —— 
7. ❌ U+002D HYPHEN-MINUS `-` —— ASCII 

### 2. （）

****：
-  / （ OpenType `ccmp`  U+2014 ， `locl`  CJK ）
-  PingFang
- HarmonyOS Sans / MiSans

****（ /  / ）：
- 、（""）
- （）
- （）
- （）

### 3. （CSS）

❌ ****：
```css
font-family: "Helvetica", "PingFang SC";   /*  */
```
 `—`  Helvetica ，、、。

✅ **（ A）**：，
```css
font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
```

✅ **（ B）**： `unicode-range`  `@font-face`
```css
@font-face {
  font-family: "Helvetica Local";
  src: local("Helvetica");
  unicode-range: U+0000-007F;       /*  ASCII */
}
body {
  font-family: "Helvetica Local", "PingFang SC", sans-serif;
}
```

✅ **（ C）**： `lang`  `locl`
```html
<html lang="zh-CN">
```

### 4. 

**InDesign**：
1.  → "" （）
2.  → "" →  `U+2014`、`U+2015`、`U+2500`
3. ""（）

**Word**：
- "" `―`  U+2015， U+2014
-  U+2014 ，""
- ： `—`，→→→ 200%， em dash （《》）

**CSS**：
```html
<!--  em dash  -->
—&#8288;—。
```

### 5. 
- GB/T 15834-2011 §4.10 / §5.1.4：、、****

## 、Unicode （W3C CLReq ）

|  | Unicode |  |  |
|---|---|---|---|
|  | U+3002 。 | ✅ | U+FF0E ． / U+002E . |
|  | U+FF0C ， | ✅ | U+002C , |
|  | U+3001 、 | ✅ | — |
|  | U+FF1B ； | ✅ | U+003B ; |
|  | U+FF1A ： | ✅ | U+003A : |
|  | U+FF1F ？ | ✅ | U+003F ? |
|  | U+FF01 ！ | ✅ | U+0021 ! |
|  | U+201C " | ✅（）| — |
|  | U+201D " | ✅（）| — |
|  | U+300C 「 | ✅（）| — |
|  | U+300D 」 | ✅（）| — |
|  | U+300E 『 | ✅（）| — |
|  | U+300F 』 | ✅（）| — |
|  | U+FF08 （ | ✅ | U+0028 ( |
|  | U+FF09 ） | ✅ | U+0029 ) |
|  | U+300A 《 | ✅ | — |
|  | U+300B 》 | ✅ | — |
|  | U+3008 〈 | ✅ | — |
|  | U+3009 〉 | ✅ | — |
|  | U+2E3A ⸺ / U+2014×2 —— | ✅ | U+2015 / U+2500 / U+30FC |
|  | U+2026×2 …… | ✅ | U+22EF（）|
|  | U+2013 – | ✅ | — |
|  | U+2014 — | ✅ | — |
|  | U+FF5E ～ | ✅ | U+007E ~ |
|  | U+00B7 · | ✅ | U+30FB / U+2027 / U+2022 |
|  | U+002F /  U+FF0F ／ | ✅ | — |
|  | U+25CF ●  U+2022 • | ✅ | — |

## 、CSS （，2024+）

```css
.body-text {
  /* ： */
  letter-spacing: 0;

  /* （） */
  text-spacing-trim: space-all;

  /* （） */
  hanging-punctuation: allow-end;

  /*  */
  line-break: strict;

  /*  */
  word-break: keep-all;

  /*  URL  */
  overflow-wrap: break-word;

  /*  */
  text-align: justify;

  /*  */
  text-justify: inter-character;

  /* （OpenType） */
  font-feature-settings:
    "halt" 1,         /*  */
    "palt" 1;         /* （） */
}

/* ： halt， */
h1, h2, h3 {
  font-feature-settings: "palt" 1;  /*  */
}

/*  / H5 / ： */
p {
  text-indent: 0;
  margin: 0 0 1em 0;
}

/*  /  / ， template  */
.book-copy p,
.official-doc p,
.classical-copy p {
  text-indent: 2em;
  margin: 0;
}

/* ：；// */
blockquote {
  font-style: normal;
}
```

： `<wbr>` ；（ `kerning.js`）。

## 、（）

：

- [ ] （ /  /  / ）？
- [ ] ？
- [ ] （basic / GB / strict）？
- [ ]  1.5 ？
- [ ]  U+2014×2（ 4 ）？
- [ ]  /  / ？
- [ ] ""？
- [ ] ""'',「」『』？
- [ ] CSS `font-family` ？
- [ ] HTML  `lang="zh-CN"`  `lang="zh-TW"`？
- [ ] ：/，//？
- [ ]  1/4 ？
