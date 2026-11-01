/**
 * First post-extraction modification of the shipped main process.
 *
 * The window title is a literal in `resources/app/out/main.js`. This rewrites
 * that literal only and reports the file hash before/after, so the change is
 * provable from the manifest.
 *
 * Usage: node patch-cf-window-title.mjs <out/main.js> [newTitle]
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const file = process.argv[2];
const title = process.argv[3] ?? "CodeFusion";
if (!file) {
  console.error("usage: node patch-cf-window-title.mjs <out/main.js> [newTitle]");
  process.exit(2);
}

const before = await readFile(file, "utf8");
const hashOf = (text) => createHash("sha256").update(text).digest("hex");

const count = (text, needle) => text.split(needle).length - 1;
const previousTitles = count(before, '"Quest Window"');
if (previousTitles === 0) {
  console.log("no \"Quest Window\" literal found; nothing changed");
  process.exit(1);
}

const after = before.split('"Quest Window"').join(JSON.stringify(title));

await writeFile(file, after, "utf8");
console.log(`replaced ${previousTitles} window-title literal(s) with ${JSON.stringify(title)}`);
console.log(`sha256 before: ${hashOf(before)}`);
console.log(`sha256 after:  ${hashOf(after)}`);
console.log(`bytes: ${before.length} -> ${after.length}`);
