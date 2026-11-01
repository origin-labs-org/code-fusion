/**
 * Extracts and inventories the shipped Qoder desktop application.
 *
 * Produces, under `<outDir>`:
 *   MANIFEST.jsonl   one line per shipped file: path, bytes, sha256
 *   COVERAGE.md      what is recoverable as source and what is not
 *
 * The Electron application layer (`resources/app`) ships as plain JavaScript /
 * JSON / HTML / CSS, so it is source-recoverable. The native layer (`*.exe`,
 * `*.node`, Chromium/DLL payloads) is machine code with no recoverable source;
 * it is inventoried and hashed, not decompiled.
 *
 * Usage: node qoder-extract-source.mjs <install-dir> <out-dir>
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = process.argv[2];
const outDir = process.argv[3];
if (!root || !outDir) {
  console.error("usage: node qoder-extract-source.mjs <install-dir> <out-dir>");
  process.exit(2);
}

const skipDir = new Set(["SOURCE"]);
const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

const files = [];
const walk = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDir.has(entry.name) && dir === root) continue;
      await walk(path);
      continue;
    }
    files.push(path);
  }
};
await walk(root);

const SOURCE_EXT = /\.(js|cjs|mjs|ts|tsx|jsx|json|jsonc|html|css|scss|md|txt|ya?ml|svg|sh|ps1|py|go|rs|java|map|d\.ts)$/i;
const NATIVE_EXT = /\.(exe|dll|node|so|dylib|pak|bin|dat|wasm)$/i;

const rows = [];
const totals = { files: 0, bytes: 0, sourceFiles: 0, sourceBytes: 0, nativeFiles: 0, nativeBytes: 0 };
for (const file of files) {
  const info = await stat(file);
  const hash = await sha256(file);
  const rel = relative(root, file).split(sep).join("/");
  rows.push({ path: rel, bytes: info.size, sha256: hash });
  totals.files += 1;
  totals.bytes += info.size;
  if (SOURCE_EXT.test(rel)) {
    totals.sourceFiles += 1;
    totals.sourceBytes += info.size;
  }
  if (NATIVE_EXT.test(rel)) {
    totals.nativeFiles += 1;
    totals.nativeBytes += info.size;
  }
}

await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, "MANIFEST.jsonl"),
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  "utf8",
);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const coverage = `# Shipped Qoder application — source extraction

Input: \`${root}\`
Files inventoried: **${totals.files}** (${mb(totals.bytes)})

| Class | Files | Size | Recoverable as source |
| --- | --- | --- | --- |
| Application JavaScript / JSON / CSS / HTML / TS / docs | ${totals.sourceFiles} | ${mb(totals.sourceBytes)} | yes — plain text, readable and editable |
| Native / binary payloads (\`.exe\`, \`.dll\`, \`.node\`, \`.pak\`, \`.wasm\`) | ${totals.nativeFiles} | ${mb(totals.nativeBytes)} | no — machine code |
| Other assets (images, fonts, licenses) | ${totals.files - totals.sourceFiles - totals.nativeFiles} | — | assets only |

## What the executable actually is

The \`.exe\` is an Electron host: Chromium + Node.js + a thin bootstrap that loads
\`resources/app\`. Its machine code has no recoverable C++ source. Everything that decides
product behaviour — main process, workbench UI, agent window, extensions, prompts and
localisation tables — is JavaScript inside \`resources/app\` and is fully readable here.

## How modification works

1. Edit the file under \`resources/app/...\` (or the beautified copy, then copy back).
2. Keep the JSON valid; \`product.json\` drives the window title and app identity.
3. Launch \`CodeFusion.exe\` from this directory. Electron loads the edited resources; no
   recompile of the native host is involved (and none is possible without its source).

## Manifest

\`MANIFEST.jsonl\` lists every shipped file with size and SHA-256, so any edit can be proven
by diffing the manifest before/after.
`;
await writeFile(join(outDir, "COVERAGE.md"), coverage, "utf8");

console.log(JSON.stringify(totals, null, 2));
console.log(`manifest rows: ${rows.length}`);
