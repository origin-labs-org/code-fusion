/**
 * Applies the final part names across registry, launcher and docs.
 *
 *   Maxxi    -> Ingot   (folder renamed to windows/ingot)
 *   Obsidian -> Onyx    (physical folder still windows/obsidian; windows/onyx is a junction)
 *
 * Usage: node scripts/rebrand/rename-parts-3.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const files = [
  "arch/windows.json",
  "arch/brand.ts",
  "arch/README.md",
  "launcher/index.html",
  "launcher/launch.ps1",
  "launcher/README.md",
  "BRAND.md",
];

const replacements = [
  ["Maxxi", "Ingot"],
  ["maxxi", "ingot"],
  ["Obsidian", "Onyx"],
  ["obsidian", "onyx"],
];

let total = 0;
for (const relative of files) {
  const path = join(root, relative);
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch {
    console.log(`missing    ${relative}`);
    continue;
  }
  let after = before;
  for (const [from, to] of replacements) after = after.split(from).join(to);
  if (after === before) {
    console.log(`no change  ${relative}`);
    continue;
  }
  await writeFile(path, after, "utf8");
  const changed = replacements.reduce(
    (sum, [from]) => sum + (before.split(from).length - after.split(from).length),
    0,
  );
  total += changed;
  console.log(`changed    ${relative} (${changed})`);
}
console.log(`total: ${total}`);
