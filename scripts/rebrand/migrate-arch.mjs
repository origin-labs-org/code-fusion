/**
 * Follows the 2026-10-31 restructure: `architecture/` -> `arch/`, `inbuilt/` added,
 * `windows/onyx` is a real folder now (the old junction to `windows/obsidian` is gone).
 *
 * Usage: node scripts/rebrand/migrate-arch.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const report = join(root, "..", "review-tracking", "FINAL_REPORT.md");

const files = [
  "launcher/launch.ps1",
  "launcher/README.md",
  "arch/README.md",
  "arch/brand.ts",
  "BRAND.md",
  "scripts/rebrand/check-consistency.mjs",
  "scripts/rebrand/sync-window-json.mjs",
  "scripts/rebrand/fix-zenix-cc.mjs",
  "scripts/rebrand/fix-sonar-dsh.mjs",
  "scripts/rebrand/rename-parts.mjs",
  "scripts/rebrand/rename-parts-2.mjs",
  "scripts/rebrand/rename-parts-3.mjs",
];

let changed = 0;
for (const relative of files) {
  const path = join(root, relative);
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch {
    console.log(`missing    ${relative}`);
    continue;
  }
  let after = before.split("architecture/").join("arch/").split("architecture\\").join("arch\\");
  // Onyx is a real folder again.
  after = after
    .split(" (junction → `windows/obsidian`)")
    .join("")
    .split("`windows/onyx` is a junction to `windows/obsidian` until that folder's handle lock clears; the registry already uses `windows/onyx`.")
    .join("`windows/onyx` is a real folder; the earlier junction to `windows/obsidian` is gone.");
  if (after === before) {
    console.log(`no change  ${relative}`);
    continue;
  }
  await writeFile(path, after, "utf8");
  changed += 1;
  console.log(`updated    ${relative}`);
}

// The report lives outside the app folder.
try {
  const before = await readFile(report, "utf8");
  const after = before
    .split("architecture/{windows.json, brand.ts, README.md}")
    .join("arch/{windows.json, brand.ts, README.md}")
    .split("architecture/windows.json")
    .join("arch/windows.json")
    .split("`windows/onyx` (junction → `windows/obsidian`)")
    .join("`windows/onyx`")
    .split("`windows/onyx` is a junction to `windows/obsidian` until that folder's handle lock clears.")
    .join("`windows/onyx` is a real folder again; the junction is gone.");
  if (after !== before) {
    await writeFile(report, after, "utf8");
    changed += 1;
    console.log("updated    review-tracking/FINAL_REPORT.md");
  } else {
    console.log("no change  review-tracking/FINAL_REPORT.md");
  }
} catch (error) {
  console.log(`report skipped: ${error.message}`);
}

console.log(`\nfiles updated: ${changed}`);
