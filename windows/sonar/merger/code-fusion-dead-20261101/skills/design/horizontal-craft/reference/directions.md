#  Text Direction： /  / 

****。""，。、、CSS 、。

## 、

```
？
│
├─  /  /  /  /  /  ────────────→ 
├─  /  /  /  ──────────────→ 
├─  / "" ────────────→ 
├─  /  /  /  /  ───────→ 
├─  /  /  / H5 / App ───────────────→ 
└─  /  /  ───────────────────────→ （）

？
│
├─  1 / ────→ （）
├─  2-3  ───→  tate-chu-yoko（）
├─ / ───────→  90° 
├─  ──────────→ （， 1/2）
├─ / ──────→  writing-mode: vertical-rl
└─  ───→ （""）
```

## 、 vs 

|  |  |  |
|---|---|---|
|  |  →  |  →  |
|  |  →  | ** → ** |
|  | （****） | （****） |
|  | （） | （） |
|  | （） | （） |
| / |  /  |  /  |
|  |  |  |
|  |  |  |
|  | ， | ， |
|  | ≤ 48  | ≤ 55  |
|  | ≥ 10  | ≥ 10  |
| CSS writing-mode | `horizontal-tb`（） | `vertical-rl` |

## 、/（ GB/T 15834-2011）

**。。**

|  | （） | （） |  |
|---|---|---|---|
|  。 |  |  |  |
|  ， |  |  |  |
|  、 |  |  |  |
|  ： | ， | ****（ 90°） |  |
|  ； | ， | ****（ 90°） |  |
|  ？ | ， | ****（ 90°） |  |
|  ！ | ， | ****（ 90°） |  |
| （） |  " " | ** 「」**（） |  |
| （） |  ' ' |  『』 |  |
|  | 《》〈〉 | 《》（） |  ﹏（）/ 《》 |
|  | ——  2  | ** 2 ** |  |
|  | ……  2 ，6  |  2 ，6 **** |  |

**（）**：
- ：、、、 90° ；****。 macOS  Unicode UAX#50 ，。
-  " "（「」）。

## 、 3 （W3C CLReq §2.1.3）

/，：

###  1：（Upright）
- ：**、**（ GDP、CPU、A）
- ：，
- CSS：`text-orientation: upright`
- ：` G D P …` （G、D、P ，）

###  2： 90° （Rotated）
- ：** /  / 4 **（ "JavaScript"、"2024"、"the quick brown fox"）
- ：，
-  **≤ 1/4 **；/****
- CSS：`text-orientation: sideways`（）

###  3：（Tate-chu-yoko ）
- ：**2–3 、**（ "3.0"、"A+"、"2B"、"21"、"AM"、"99"）
- ：，；
-  1 ；
- CSS：`text-combine-upright: all`
- ： `21` 、`3.0` 、 `25` ℃

### （）
- ****（）
- ，
- ，/

## 、

：

-  /  / 
- （，）
- （）
- 、、
- ""

**CSS **：
```css
.vertical-quote {
  writing-mode: vertical-rl;       /* ： */
  text-orientation: mixed;          /* ， */
  height: 20em;
  margin: 0 1em;
}
```

****：
- ""——，
- ；
- ""——

## 、

，。

|  |  |  | （） |  |
|---|---|---|---|---|
| **** |  |  | ****（） | 、、、 |
| **** |  |  | ****（） | 、、、 |
| **（）** |  |  | — |  |

****：
- ****（ / ），
- ，（、）
- ：、

## 、CSS writing-mode 

```css
/* （） */
.horizontal {
  writing-mode: horizontal-tb;     /* horizontal, top-to-bottom */
}

/* （、、） */
.vertical {
  writing-mode: vertical-rl;       /* vertical, right-to-left lines */
  text-orientation: mixed;          /* 、 90° */
}

/* （，） */
.vertical-lr {
  writing-mode: vertical-lr;
}

/* （、） */
.upright {
  text-orientation: upright;
}

/* （） */
.tcy {
  text-combine-upright: all;
}
```

 HTML ：
```html
<article style="writing-mode: vertical-rl; height: 30em;">
  <p>
    ，。
    <span style="text-combine-upright: all;">21</span>，
    。
  </p>
</article>
```

## 、

——，。： `punctuation.md`、 `fonts.md`、 `punctuation.md § `。

|  |  |  |  |
|---|---|---|---|
|  | **、** | ****（） | 、（） |
|  | GB  / strict  | （） |  |
|  | （、） |  +  |  +  |
|  |  |  | ** 90° ** |
|  |  ""''（）/ 「」（） | 「」『』（） | 「」 |
|  | 《》〈〉 |  ﹏（）+ 《》 |  『』 |
|  · | **** | **** |  |
|  | **** | **** |  |

****：，""。

## 、？？

### 
-  / 
- （）
- 、、
- 、
- （）
- 、

### 
- 
-  /  / 
- ""
-  /  / （）
- （）
-  /  / 

### （ / ）
- 
- 
- 、
- 
- 

### 
- （）
- （）
-  / 
- （、）
- App / H5（）

## 、（）

""""——。 5 ：

### 1.  + 
，、、，。

```html
<article class="horizontal-body">
  <p>《》：</p>
  <blockquote class="vertical-quote">
    ，。<br>
    ，。
  </blockquote>
  <p>…</p>
</article>
```

### 2.  + 
，，、、。/。

### 3. ""
（）、（），。。

### 4. 、
 / ，；。

### 5. （）
：， 1/2，。。

```
┃ ：
┃ ┃
┃ ┃
┃
```

## 、（）

：

- [ ] （ /  / ）？
- [ ] ？（ / ）
- [ ] （ / ）？
- [ ] ？
- [ ] ？
- [ ] ？
- [ ] （）？
- [ ] 「」？
- [ ] ？（ +  GB ）
- [ ] ？
- [ ] ？
- [ ] CSS `writing-mode`  `text-orientation` ？
