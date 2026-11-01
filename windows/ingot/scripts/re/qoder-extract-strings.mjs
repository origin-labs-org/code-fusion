/**
 * Extracts Qoder's shipped Repo Wiki / knowledge UI strings.
 *
 * Source: the installed Qoder app bundle (English catalog inside
 * `out/lingma/agents-window/agents-window.desktop.main.js`). Values are
 * `\uXXXX`-escaped; this decodes them verbatim so the IDE can reproduce the
 * real screen copy instead of inventing it.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const bundle = process.argv[2];
const outFile = process.argv[3] ?? join("IDE", "src", "qoder-strings.json");
if (!bundle) {
  console.error("usage: node qoder-extract-strings.mjs <agents-window.desktop.main.js> [out.json]");
  process.exit(2);
}

const text = await readFile(bundle, "utf8");
const pattern =
  /(?:repoWiki|quest\.knowledge|application\.config\.general\.notifications\.repoWiki)[A-Za-z0-9_.]*\\?":\\?"((?:[^"\\]|\\.)*)\\?"/g;

const decode = (value) =>
  value
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");

const cjkCount = (value) => (value.match(/[\u4e00-\u9fff]/g) ?? []).length;

const out = {};
let match;
while ((match = pattern.exec(text)) !== null) {
  const raw = match[0];
  const key = raw.slice(0, raw.indexOf('"')).replace(/\\$/, "");
  const value = decode(match[1]);
  if (!/[A-Za-z]{3,}/.test(value)) continue;
  const existing = out[key];
  // The bundle carries several catalogs; keep the most English-looking value.
  if (existing === undefined || cjkCount(value) < cjkCount(existing)) out[key] = value;
}

await mkdir(join(outFile, ".."), { recursive: true });
await writeFile(outFile, `${JSON.stringify(out, null, 2)}\n`, "utf8");

const keys = Object.keys(out).sort();
console.log(`wrote ${keys.length} strings -> ${outFile}`);
for (const key of keys.slice(0, 20)) console.log(`${key} = ${out[key].slice(0, 100)}`);
