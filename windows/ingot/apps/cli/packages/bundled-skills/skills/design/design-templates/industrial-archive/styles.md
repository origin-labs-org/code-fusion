#  —  `:root`  8  CSS 

 8  CSS。 `template.html`  `:root` 。
（）， / 。

---

## 1. default — （ / ""）

```css
:root{
  --bg:        #e6e9ee;
  --bg-soft:   #f1f3f6;
  --paper:     #c9cfd6;
  --ink:       #0c0f14;
  --ink-soft:  #535963;
  --line:      #aab0b8;
  --line-soft: #c4c9d0;
  --steel:     #3a4a5a;
}
```
：、、、、
： /  /  /  / 

---

## 2. warm-leather — 

```css
:root{
  --bg:        #ece4d6;
  --bg-soft:   #f4eee2;
  --paper:     #d8cdb8;
  --ink:       #1c160e;
  --ink-soft:  #6e5e44;
  --line:      #b6a787;
  --line-soft: #cdc1a5;
  --steel:     #8a5a2e;   /*  */
}
```
：、、、、、
： /  /  /  /  / 

---

## 3. night-iron — 

```css
:root{
  --bg:        #14161a;
  --bg-soft:   #1c1f24;
  --paper:     #2a2e35;
  --ink:       #e8eaee;     /* ： */
  --ink-soft:  #9aa0a8;
  --line:      #3a3f46;
  --line-soft: #2a2e34;
  --steel:     #c9a35a;   /*  */
}
```
：、、、、
： /  /  /  / 

： body `background-image`  radial ，：
```css
body{
  background-image:
    radial-gradient(at 20% 22%, rgba(58,74,90,0.18) 0px, transparent 50%),
    radial-gradient(at 78% 80%, rgba(201,163,90,0.05) 0px, transparent 55%);
}
```

---

## 4. paper-press — 

```css
:root{
  --bg:        #f3eee2;
  --bg-soft:   #faf5e8;
  --paper:     #e2d9c1;
  --ink:       #181410;
  --ink-soft:  #5a4f3e;
  --line:      #b9ac8e;
  --line-soft: #cec3a6;
  --steel:     #9a3324;   /*  */
}
```
：、、、、
： /  / report /  /  / 

---

## 5. navy-blueprint — 

```css
:root{
  --bg:        #1f2a3a;
  --bg-soft:   #263244;
  --paper:     #324154;
  --ink:       #f4f6fa;
  --ink-soft:  #aab6c8;
  --line:      #4a5568;
  --line-soft: #2e3a4d;
  --steel:     #ffffff;     /*  */
}
```
：、、、、
： /  / blueprint /  / 

： `.ticker`  `var(--bg-soft)`、 `var(--ink)`，。

---

## 6. ceramic-clay — 

```css
:root{
  --bg:        #e7d8c4;
  --bg-soft:   #f1e6d5;
  --paper:     #d3bfa3;
  --ink:       #2a1c12;
  --ink-soft:  #6b4f38;
  --line:      #b39472;
  --line-soft: #c8ad8c;
  --steel:     #5e3a1f;   /*  */
}
```
：、、、、
： /  /  /  /  / 

---

## 7. mint-laboratory — 

```css
:root{
  --bg:        #e8efea;
  --bg-soft:   #f1f5f2;
  --paper:     #c8d4ce;
  --ink:       #102018;
  --ink-soft:  #4f655a;
  --line:      #99ada3;
  --line-soft: #b9c7bf;
  --steel:     #2a6e5a;   /*  */
}
```
：、、、、
： /  /  /  / 

---

## 

，：

|  |  |
|---|---|
| 、、、 | default |
| 、、、 | warm-leather |
| 、、 | night-iron |
| 、、 | paper-press |
| 、、 | navy-blueprint |
| 、 | ceramic-clay |
| 、、 | mint-laboratory |
|  | default（） |
