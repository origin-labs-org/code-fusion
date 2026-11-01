// Renders the installers' art from the new tab's own sky and wordmark: the
// macOS disk image's background, and the Windows installer's sidebar and
// header. Drawn by WebKit at exact pixel sizes, so the art is the product's
// own vector and picture, not a hand-made copy. Run with
// `node scripts/render-installer-art.mjs` after changing the sky or the
// wordmark (needs ffmpeg and sips).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { webkit } from "playwright";

const at = (path) => fileURLToPath(new URL(path, import.meta.url));
const out = (name) => at(`../../desktop/installer/${name}`);

const source = readFileSync(at("../src/shared/lib/wordmark.ts"), "utf8");
const number = (key) => Number(new RegExp(`${key}: ([\\d.]+)`).exec(source)[1]);
const WORDMARK = {
  x: number("x"),
  y: number("y"),
  width: number("width"),
  height: number("height"),
  scaleX: number("scaleX"),
  scaleY: number("scaleY"),
  d: /d: "([^"]+)"/.exec(source)[1],
};

/** The baked sky's size and horizon, as `shared/sky/place.ts` has them. */
const PICTURE = { width: 3344, height: 1882, horizon: 0.69 };
function placeSky(width, horizon) {
  const scale = Math.max(width / PICTURE.width, horizon / (PICTURE.horizon * PICTURE.height));
  const w = PICTURE.width * scale;
  const h = PICTURE.height * scale;
  return { x: (width - w) / 2, y: horizon - PICTURE.horizon * h, w, h };
}

const sky = pathToFileURL(at("../src/shared/sky/assets/sky-day.avif")).href;

/** A page as large as the art: the sky laid on the paper it dissolves into,
 *  with whatever stands on it. */
function page(width, height, horizon, body) {
  const place = placeSky(width, horizon);
  return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #f7f7f8; }
    .sky { position: absolute; left: ${place.x}px; top: ${place.y}px; width: ${place.w}px; height: ${place.h}px; }
    svg { position: absolute; overflow: visible; }
  </style><img class="sky" src="${sky}" alt="">${body}`;
}

/** The wordmark in white, `width` wide, centred, its top at `top`. */
function name(frame, width, top) {
  const height = (width * WORDMARK.height) / WORDMARK.width;
  return `<svg style="left:${(frame - width) / 2}px;top:${top}px;width:${width}px;height:${height}px;
      filter:drop-shadow(0 1px 10px rgb(18 48 112 / 22%))"
    viewBox="${WORDMARK.x} ${WORDMARK.y} ${WORDMARK.width} ${WORDMARK.height}">
    <path d="${WORDMARK.d}" fill="rgb(255 255 255 / 94%)"
      transform="scale(${WORDMARK.scaleX} ${WORDMARK.scaleY})"/></svg>`;
}

/** The disk image's window: the app and Applications side by side in the
 *  sky, a quiet arrow between them, and the sky dissolving below. The icons'
 *  centres are `bundle.macOS.dmg` positions in `tauri.macos.conf.json`. */
const DMG = { width: 660, height: 400, icons: 156, app: 205, folder: 455 };
const dmg = page(
  DMG.width,
  DMG.height,
  300,
  `${name(DMG.width, 170, 30)}
  <svg style="left:0;top:0;width:${DMG.width}px;height:${DMG.height}px;
      filter:drop-shadow(0 1px 8px rgb(18 48 112 / 24%))"
    viewBox="0 0 ${DMG.width} ${DMG.height}" fill="none" stroke="rgb(255 255 255 / 88%)"
    stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${DMG.app + 84} ${DMG.icons} H${DMG.folder - 84}"/>
    <path d="M${DMG.folder - 92} ${DMG.icons - 8} L${DMG.folder - 84} ${DMG.icons} L${DMG.folder - 92} ${DMG.icons + 8}"/>
  </svg>`,
);

/** The Windows installer's first and last pages carry the sky down their
 *  left edge, the name across its top. */
const sidebar = page(164, 314, 250, name(164, 116, 46));
/** Its inner pages carry a strip of it at the top right. */
const header = page(150, 57, 74, name(150, 92, 22));

const scratch = mkdtempSync(join(tmpdir(), "zephium-installer-"));
const browser = await webkit.launch();
async function render(html, width, height, scale) {
  const file = join(scratch, `${width}x${height}.html`);
  writeFileSync(file, html);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  const tab = await context.newPage();
  await tab.goto(pathToFileURL(file).href);
  await tab.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  const png = join(scratch, `${width}x${height}.png`);
  await tab.screenshot({ path: png });
  await context.close();
  return png;
}

try {
  // Drawn at twice its size and marked 144 dpi, so Finder shows it at the
  // window's size and sharp on a Retina display.
  const background = await render(dmg, DMG.width, DMG.height, 2);
  // A photograph, so a fine JPEG: a fifth of the PNG's bytes in the download.
  execFileSync(
    "sips",
    [
      ...["-s", "format", "jpeg", "-s", "formatOptions", "92"],
      ...["-s", "dpiWidth", "144", "-s", "dpiHeight", "144"],
      ...[background, "--out", out("dmg-background.jpg")],
    ],
    { stdio: "ignore" },
  );
  // NSIS reads 24-bit bitmaps.
  for (const [html, width, height, file] of [
    [sidebar, 164, 314, "nsis-sidebar.bmp"],
    [header, 150, 57, "nsis-header.bmp"],
  ]) {
    const png = await render(html, width, height, 1);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", png, "-pix_fmt", "bgr24", out(file)]);
  }
} finally {
  await browser.close();
  rmSync(scratch, { recursive: true });
}
