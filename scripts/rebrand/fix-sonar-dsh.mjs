/**
 * Sonar/Plus holds the reverse-engineered DeepSeek Harness, not the official distribution.
 *
 * Usage: node scripts/rebrand/fix-sonar-dsh.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const files = [
  "arch/windows.json",
  "arch/brand.ts",
  "arch/README.md",
  "launcher/index.html",
  "BRAND.md",
  "windows/sonar/window.json",
];

const from = "official DeepSeek Harness (DSH)";
const to = "reverse-engineered DeepSeek Harness (DSH)";

for (const relative of files) {
  const path = join(root, relative);
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch {
    console.log(`missing    ${relative}`);
    continue;
  }
  if (!before.includes(from)) {
    console.log(`no change  ${relative}`);
    continue;
  }
  await writeFile(path, before.split(from).join(to), "utf8");
  console.log(`updated    ${relative}`);
}
