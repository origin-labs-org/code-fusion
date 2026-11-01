/**
 * Renames two parts across the registry, launcher and docs.
 *
 *   Maxxi    -> Ingot CC   (folder already renamed to windows/ingot-cc)
 *   Obsidian -> Onyx       (folder rename is pending: windows/obsidian is locked)
 *
 * Usage: node scripts/rebrand/rename-parts-2.mjs
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
  "windows/ingot-cc/window.json",
  "windows/obsidian/window.json",
];

const replacements = [
  ["Maxxi", "Ingot CC"],
  ["maxxi", "ingot-cc"],
  ["Obsidian", "Onyx"],
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
