---
name: web-shader-extractor
description: |
   WebGL/Canvas/Shader ， JS 。
  ： shader、、、 canvas 、
  、"" 。
---

# Web Shader Extractor

 WebGL/Canvas/Shader ，。

：
- ** 1:1 ，**
- **，** — ，。 Phase 6 ，，。，。

## Phase 0: （）

，。**，**。

```bash
# 1.  Node.js
node --version 2>/dev/null || {
  echo "Node.js not found, installing..."
  # macOS
  brew install node 2>/dev/null || {
    # fallback:  LTS
    curl -fsSL https://nodejs.org/dist/v22.15.0/node-v22.15.0-darwin-arm64.tar.gz | tar xz -C /usr/local --strip-components=1
  }
}

# 2. Playwright （fetch-rendered-dom.mjs ，）
RUNNER_DIR="$HOME/.cache/playwright-runner"
if [ ! -d "$RUNNER_DIR/node_modules/playwright" ]; then
  echo "Installing Playwright (one-time setup)..."
  mkdir -p "$RUNNER_DIR"
  echo '{"type":"module"}' > "$RUNNER_DIR/package.json"
  npm install playwright --prefix "$RUNNER_DIR"
  npx --prefix "$RUNNER_DIR" playwright install chromium
  echo "Playwright + Chromium installed."
fi
```

，：
- npm  →  `--prefix` 
- （Chromium ）→  `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` 
-  Playwright →  curl （ DOM ， HTML + JS bundle）， Phase 2  canvas-info

## Phase 1: 

****：Playwright  DOM + curl  HTML。

```bash
# Playwright（ canvas 、、）
node ~/.claude/skills/web-shader-extractor/scripts/fetch-rendered-dom.mjs '<URL>'
# → /tmp/rendered/: dom.html, canvas-info.json, network.json, screenshot.png, console.log

# curl（ HTML，）
curl -s -L --compressed '<URL>' > /tmp/page.html
```

 Playwright （/），（）， curl ，。

 network.json  HTML  JS URL， /tmp/。

### Phase 2: 

```
canvas-info.json  dataEngine ：
├─ "three.js rXXX" → Three.js（r170+  TSL → references/tsl-extraction.md）
├─ "Babylon.js vX.X" → Babylon.js
├─ null → ：
│   ├─ bundle  createShader/shaderSource → Raw WebGL / PixiJS
│   └─ bundle  getContext('2d')  WebGL  → 2D Canvas（→ references/porting-strategy.md § 2D Canvas）
└─  canvas → CSS/SVG 

URL  HTML  → （ Phase 3-4）：
├─ unicorn.studio → references/unicorn-studio.md（Firestore REST API +shader）
└─ shaders.com → references/shaders-com.md（Nuxt payload + XOR  + TSL→GLSL ）

：bash scripts/scan-bundle.sh /tmp/*.js
→  references/tech-signatures.md
```

### Phase 3: 

```
1.  API → （API  → references/encoded-definitions.md）
2.  Nuxt payload / __NEXT_DATA__ / HTML  JSON 
3.  JS bundle 
→  references/config-extraction.md
```

### Phase 4: Shader 

 **Agent**  JS bundle（1MB+ ）。
→ Agent prompt  `references/extraction-workflow.md`

### Phase 5: 

```
 2D  shader →  WebGL2（）
3D / PBR / GPGPU → （CDN importmap）
 → ，Phase 6 
→  references/porting-strategy.md
```

### Phase 6: 

，（）。，****，。

### Phase 7: （）

，**** `EXTRACTION-REPORT.md`（ token ）。

：
```markdown
# ：{}
**///**

## （）
## （→）
## （/）
## （pass ）
## 
## （：//）
## 
## （ vs ）
```

（ `ascii-glyph-dither/EXTRACTION-REPORT.md`）。

## Reference 

|  |  |
|--------|------|
| （Three.js/WebGL/PixiJS ） | `references/tech-signatures.md` |
| Agent  prompt +  | `references/extraction-workflow.md` |
| （API/payload/） | `references/config-extraction.md` |
| Three.js TSL  shader  | `references/tsl-extraction.md` |
| / | `references/encoded-definitions.md` |
| onBeforeCompile GLSL  | `references/shader-injection.md` |
|  +  | `references/porting-strategy.md` |
| **Unicorn Studio** （curtains.js + Firestore） | `references/unicorn-studio.md` |
| **shaders.com** （TSL + XOR  + Y-flip ） | `references/shaders-com.md` |
