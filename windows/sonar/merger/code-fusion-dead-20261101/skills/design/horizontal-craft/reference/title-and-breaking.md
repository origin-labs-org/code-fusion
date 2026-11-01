#    Title Line Breaking & Word Wrapping

。****——、。，""""。

## 、

|  |  |  |
|---|---|---|
| **** | ， |  60%，，"" |
| **** |  | 、， |
| **** | （） |  |
| **、** | （） | （hanging） |

## 、

### 1. 

""：
- ****：（ /  / ）、（ /  / ）、（ / ）、（ / ）
- ****：、、、
- ** + **：3 、500 、 5 
- ****：2024 、100 
- ** /  / **：《》、《 2》
- ** / **：、（4 ）

### 2. 

|  /  |  |  |
|---|---|---|
| **、、、、** | **** |  |
| **、、、、、** | **** |  |
| **、、** |  |  |
| **、、、、** |  |  |
| **、、** |  |  |
| **、、、、** | （）|  |

### 3. 

❌ ** 1**（）：
```


```
""。

✅ ****：
```


```

❌ ** 2**（）：
```

 M5
```

✅ ****：
```

 M5
```

❌ ** 3**（）：
```


```

✅ ****（""）：
```


```

### 4. （）

，。

|  | （） | （ 9pt ） |
|---|---|---|
| （） | 4–5  | 18–24pt |
| （） | 2–3  | 12–15pt |
|  | 1–2  | 10–12pt |
| （ + ）| 3  |  12pt +  9pt |
| （）| 1 （）| 9pt  |

****： +  =  × N。****。

### 5. 

- **（）**：****
  -  → （）
  -  → （）
  -  → （""，）
- ** vs **：
  - ：，（）
  - ：（）
- ****：，****

### 6. 

|  |  |  |
|---|---|---|
|  |  |  /  |
|  | （） / （ 2 ）|  |

**" 2 "**： 2 ，。

### 7. 

，。：

```
、  ……
       ↑
   1 
```

-  1 
- ，

## 、CSS / HTML 

###  1： `<br>` （）
```html
<h1>
  <br>
  
</h1>
```

###  2：`<wbr>` （）
```html
<h1><wbr> M5</h1>
```

###  3：U+2060 WORD JOINER（）
```html
<h1>&#8288;5&#8288;&nbsp;</h1>
```
：**** `&#8205;`（U+200D ZERO WIDTH JOINER）—— /，。

###  4：CSS `text-wrap: balance`（）
```css
h1, h2, h3 {
  text-wrap: balance;       /*  */
}
```

###  5：（）
```html
<h1>
  <br class="md-only">
  <wbr>
</h1>
<style>
  @media (min-width: 768px) {
    .md-only { display: inline; }
  }
</style>
```

## 、

， 6 ****（）：

### 1. 
- ❌ `100`<br>`0 `
- ✅ 

### 2.  + 
-  + `%`、`‰`、`°`、`℃`、`℉` 
-  + `±`、`+`、`−` 
-  +  `¥`、`$`、`€`、`£` 

### 3.  /  + 
- ❌ `m`<br>`²`
- ❌ <sup>1</sup> <br> 
- ✅ 

### 4.  / 
-  `——`（2 ）
-  `……`（2 ）
-  `————` 

### 5.  hyphenation 
- 
-  90° 

### 6. URL / 
-  `@`、`/`、`?` 
- ****（ URL ）
- ****
- CSS：`overflow-wrap: anywhere`（ URL）

### CSS ""

```css
.body-text {
  word-break: keep-all;            /*  */
  overflow-wrap: break-word;        /*  URL  */
  line-break: strict;               /*  */
  text-spacing-trim: space-all;     /*  */
  hanging-punctuation: allow-end;   /*  */
}

/* ： */
.bad {
  word-break: break-all;            /* ❌ ， */
}

/* ：+、 */
.unit, .superscript-group {
  white-space: nowrap;              /*  */
}
```

###  HTML 

```html
<!-- + -->
 <span class="unit">25 ℃</span>
 <span class="unit">¥ 999.99</span>

<!--  -->
 <span class="superscript-group">10 m<sup>2</sup></span>

<!--  -->
<sup class="superscript-group">①</sup>

<!--  U+2060  -->
 25&#8288;℃
```

## 、（Widow & Orphan）

""：、。**。**

### 1. （Orphan）

****： 1  + 1 。

**3 **（）：

####  A：（）
- ：，
- ： 1/4 em  1/8 em
- ： 1/24 em

####  B：
-  1–2 
- （"" → ""）

####  C：≥3 
-  1 ""
- （""、""、""）

####  D（）：
-  1 
- 、，****（）

### 2. （Widow）

****：（1  + ）。

**4 **（）：

####  A：（）
-  1 ，
-  1 （）

####  B： 1 
- ，
- （）

####  C：
-  1 ，

####  D：
-  1 

### 3. CSS 

```css
p {
  orphans: 2;       /*  2 （ 1 ）*/
  widows: 2;        /*  2 （ 1 ）*/
}

/*  */
h1, h2, h3 {
  page-break-after: avoid;       /*  */
  break-after: avoid-page;        /* ， */
}

img, figure {
  page-break-inside: avoid;       /*  */
  break-inside: avoid;
}
```

## 、

|  |  |  |  |
|---|---|---|---|
| `<br>` |  | HTML |  |
| `<wbr>` | （） | HTML5 |  |
| `&#8288;` (U+2060 WJ) |  | HTML  |  |
| `&nbsp;` |  | HTML  |  |
| `white-space: nowrap` |  | CSS |  |
| `word-break: keep-all` | （ `break-all`） | CSS |  |
| `overflow-wrap: break-word` |  | CSS |  |
| `line-break: strict` |  | CSS |  |
| `text-wrap: balance` |  | CSS | （2024+） |
| `hyphens: auto` |  | CSS |  |

## 、InDesign / Word 

### InDesign
1. **""**（""""）：
   -  →  → "" → 
2. ** Adobe CJK **（）
   - 
3. ****：""，""""
4. **""**（），

### Word
1.  → 
2. ""
3. ""
4. """"""
5. ****：Word "" `U+2014`，""

## 、（）

：

- [ ] 、？
- [ ] ""？"/"？
- [ ] ？
- [ ] （ / ）？
- [ ]  + ？（ `<span class="unit">`  `&#8288;`）
- [ ] 、？
- [ ] ？
- [ ] " + "？
- [ ] ""？
- [ ] URL / （）？
- [ ] CSS  `word-break: keep-all`  `break-all`？
