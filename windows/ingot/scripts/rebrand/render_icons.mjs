/**
 * Render the CodeFusion app icon (CF mark on a macOS-light rounded square) to PNGs
 * via headless chromium. Output: scripts/rebrand/icons/icon-<size>.png
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = "C:/Users/thaku/Workspaces/fusion/code-fusion";
const OUT_DIR = join(ROOT, "scripts", "rebrand", "icons");
mkdirSync(OUT_DIR, { recursive: true });

const requireFromCli = createRequire(join(ROOT, "apps", "cli", "packages", "cli", "package.json"));
const { chromium } = requireFromCli("playwright-core");

const EXECUTABLE = join(
  process.env.LOCALAPPDATA,
  "ms-playwright",
  "chromium_headless_shell-1223",
  "chrome-headless-shell-win64",
  "chrome-headless-shell.exe",
);

const MARK_PATHS = `
  <path fill="#1d1d1f" d="M134.4 0.130152L116.48 25.6022C113.665 29.5699 109.054 32.0019 104.064 32.0019H6.3999V0C6.3999 0.130149 134.4 0.130152 134.4 0.130152Z"/>
  <path fill="#1d1d1f" d="M256 0.130127L102.401 217.732H0L153.599 0.130127H256Z"/>
  <path fill="#1d1d1f" d="M121.601 217.732L139.65 192.134C142.465 188.166 147.076 185.734 152.067 185.734H249.604V217.736H121.601V217.732Z"/>
`;

function pageHtml(size) {
  const markW = Math.round(size * 0.66);
  const markH = Math.round((markW * 218) / 256);
  const radius = Math.round(size * 0.225);
  return `<!doctype html><html><body style="margin:0;background:transparent">
<div id="icon" style="width:${size}px;height:${size}px;background:#f5f5f7;border-radius:${radius}px;display:flex;align-items:center;justify-content:center;overflow:hidden">
<svg width="${markW}" height="${markH}" viewBox="0 0 256 218" fill="none" xmlns="http://www.w3.org/2000/svg">${MARK_PATHS}</svg>
</div></body></html>`;
}

const SIZES = [16, 32, 48, 64, 128, 256, 512];

const browser = await chromium.launch({ executablePath: EXECUTABLE });
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(pageHtml(size), { waitUntil: "load" });
  const el = page.locator("#icon");
  await el.screenshot({ path: join(OUT_DIR, `icon-${size}.png`), omitBackground: true });
  await page.close();
  console.log(`rendered icon-${size}.png`);
}
await browser.close();
console.log("DONE");
