/**
 * Renames two parts across the registry, launcher and docs.
 *
 *   Titanium -> Maxxi   (user decision)
 *   Aether   -> Zingma  (Qoder's Lingma agents window; L replaced with Z)
 *
 * Only the listed files are touched. Folder renames are done separately.
 *
 * Usage: node scripts/rebrand/rename-parts.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const files = [
  "arch/windows.json",
  "arch/brand.ts",
  "arch/README.md",
  "launcher/index.html",
  "launcher/window.json",
  "launcher/README.md",
  "launcher/launch.ps1",
  "BRAND.md",
];

const replacements = [
  ["Titanium", "Maxxi"],
  ["titanium", "maxxi"],
  ["Aether", "Zingma"],
  ["aether", "zingma"],
];

let total = 0;
for (const relative of files) {
  const path = join(root, relative);
  const before = await readFile(path, "utf8");
  let after = before;
  for (const [from, to] of replacements) {
    after = after.split(from).join(to);
  }
  if (after === before) {
    console.log(`no change  ${relative}`);
    continue;
  }
  const changed = replacements.reduce(
    (sum, [from]) => sum + (before.split(from).length - after.split(from).length),
    0,
  );
  total += changed;
  await writeFile(path, after, "utf8");
  console.log(`changed    ${relative} (${changed} token(s))`);
}
console.log(`total tokens replaced: ${total}`);
