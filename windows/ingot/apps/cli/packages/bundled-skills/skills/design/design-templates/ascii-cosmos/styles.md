# 

 8  `:root` CSS  + 5  ASCII  + hero 。（、scrambler ）。

> ****：5  ASCII ** + **。、，" = "。

---

## 1. （ · cosmic-cyan）

，，//。 AI、/、、CLI 。

```css
:root{
  --bg:#05060f;
  --fg:#e6e8ff;
  --dim:#7a7fa8;
  --accent:#8be9ff;     /*  */
  --accent2:#ff6ad5;    /*  */
  --accent3:#c792ea;    /*  */
  --line:#1a1d3a;
  --hl:#0d1024;
  --paper:#0a0c1f;
}
.hero{ background: radial-gradient(ellipse at 30% 20%, #1a0a2e 0%, #05060f 55%, #000 100%); }
#ascii-nebula  { color:#a87bd6; }   /*  */
#ascii-stars   { color:#cfe6ff; }   /*  */
#ascii-planet  { color:#8be9ff; }   /*  */
#ascii-asteroids{ color:#f5b971; }  /*  */
#ascii-comets  { color:#ff8fd2; }   /*  */
```
：`hue-rotate(200deg) saturate(.9) contrast(1.1) brightness(.6)`

---

## 2. （letterpress-warm · ）

 + ，。、、、。

```css
:root{
  --bg:#F3E4D4;
  --fg:#1f1510;
  --dim:#8a7560;
  --accent:#660125;     /*  */
  --accent2:#a83344;
  --accent3:#7a4a1f;
  --line:#d8c4af;
  --hl:#ecd8ca;
  --paper:#ecd8ca;
}
.hero{ background: linear-gradient(180deg, #F3E4D4 0%, #e9d2b8 100%); }
#ascii-nebula  { color:#b88a6a; opacity:.5; mix-blend-mode:multiply; }
#ascii-stars   { color:#5a3a1e; opacity:.7; }
#ascii-planet  { color:#660125; }
#ascii-asteroids{ color:#7a4a1f; }
#ascii-comets  { color:#a83344; }
```
：`sepia(.3) contrast(1.05) saturate(.85) brightness(.95)`
： `mix-blend-mode: screen`  `multiply`， ASCII """"。

---

## 3. （cyber-violet）

 + ，。 AI / Web3 /  / 。

```css
:root{
  --bg:#0a0118;
  --fg:#f0e6ff;
  --dim:#7e5cab;
  --accent:#ff00aa;     /*  */
  --accent2:#00ffe0;    /*  */
  --accent3:#b14aff;    /*  */
  --line:#2a0d4a;
  --hl:#150327;
  --paper:#10021f;
}
.hero{ background: radial-gradient(ellipse at 70% 30%, #4a0e6e 0%, #0a0118 60%, #000 100%); }
#ascii-nebula  { color:#b14aff; opacity:.55; }
#ascii-stars   { color:#e0d4ff; }
#ascii-planet  { color:#00ffe0; }
#ascii-asteroids{ color:#ff00aa; }
#ascii-comets  { color:#ffd400; }   /*  */
```
：`hue-rotate(280deg) saturate(1.4) contrast(1.1) brightness(.65)`

---

## 4. （terminal-green）

 phosphor ， CRT 。 CLI 、、、。

```css
:root{
  --bg:#000800;
  --fg:#a8ffb0;
  --dim:#5fa05f;
  --accent:#00ff66;     /* phosphor  */
  --accent2:#80ff80;
  --accent3:#ffaa44;
  --line:#0a3010;
  --hl:#001500;
  --paper:#001a05;
}
.hero{ background: radial-gradient(ellipse at center, #052010 0%, #000800 70%, #000 100%); }
#ascii-nebula  { color:#2a8a44; opacity:.45; }
#ascii-stars   { color:#a8ffb0; }
#ascii-planet  { color:#00ff66; }
#ascii-asteroids{ color:#ffaa44; }
#ascii-comets  { color:#80ffd4; }
```
：`grayscale(1) brightness(.6) sepia(1) hue-rotate(70deg) saturate(2)`
 `.hero::after` ：`background: repeating-linear-gradient(0deg, transparent 0, transparent 2px, rgba(0,255,102,.05) 3px, rgba(0,255,102,.05) 4px);`

---

## 5. （aurora · ）

，，。 /  /  / 。

```css
:root{
  --bg:#0c1420;
  --fg:#dceaf0;
  --dim:#6b8499;
  --accent:#7fe3c4;     /*  */
  --accent2:#b8a4ff;    /*  */
  --accent3:#ffb3c1;    /*  */
  --line:#1a2638;
  --hl:#101a28;
  --paper:#0e1622;
}
.hero{ background: linear-gradient(160deg, #1a3548 0%, #0c1420 50%, #050810 100%); }
#ascii-nebula  { color:#b8a4ff; opacity:.5; }
#ascii-stars   { color:#dceaf0; }
#ascii-planet  { color:#7fe3c4; }
#ascii-asteroids{ color:#ffb3c1; }
#ascii-comets  { color:#88ddff; }
```
：`hue-rotate(180deg) saturate(.7) contrast(1.05) brightness(.7)`

---

## 6. （desert-sunset ·  ASCII ）

 +  + ，。 /  /  / 。

```css
:root{
  --bg:#1a0a05;
  --fg:#f5e6d0;
  --dim:#a8765a;
  --accent:#ff8b3d;     /*  */
  --accent2:#d94545;    /*  */
  --accent3:#ffd47a;    /*  */
  --line:#3a1a10;
  --hl:#1f0d06;
  --paper:#15080a;
}
.hero{ background: radial-gradient(ellipse at 50% 80%, #5a1f10 0%, #1a0a05 60%, #000 100%); }
#ascii-nebula  { color:#a8765a; opacity:.5; }
#ascii-stars   { color:#ffd47a; }
#ascii-planet  { color:#ff8b3d; }
#ascii-asteroids{ color:#d94545; }
#ascii-comets  { color:#ffe9c2; }
```
：`sepia(.5) saturate(1.3) contrast(1.1) brightness(.7) hue-rotate(-10deg)`

---

## 

 6 ，：

1. ****：（//）/ （//）/ （/）
2. **`--bg` **（ `#05060f`），`--fg` （ `#e6e8ff`）
3. **`--accent` / `--accent2` / `--accent3`** ：****，，""
4. **5  ASCII ** ：
   - `nebula` → /，
   - `stars` → /，
   - `planet` →  `--accent`
   - `asteroids` → （）
   - `comets` → ，""
5. **** ， unsplash ""

> ： 5 （Coolors / Realtime Colors）， ≥ 2.0， ≥ 90°。
