/**
 * Records Zenix CC as the native Claude Desktop seat (Codeix stays OpenAI Codex).
 *
 * Usage: node scripts/rebrand/fix-zenix-cc.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");

const edits = [
  {
    file: "arch/windows.json",
    from: "Empty - only window.json. Reserved slot above Max (the CC seat).",
    to: "Empty - only window.json. Seat for native Claude Desktop.",
  },
  {
    file: "arch/brand.ts",
    from: "Empty - only window.json. Reserved slot above Max (the CC seat).",
    to: "Empty - only window.json. Seat for native Claude Desktop.",
  },
  {
    file: "launcher/index.html",
    from: "Empty — only window.json. Reserved slot above Max (the CC seat).",
    to: "Empty — only window.json. Seat for native Claude Desktop.",
  },
  {
    file: "BRAND.md",
    from: "| **Zenix CC** | `windows/zenix-cc` | empty | only `window.json` |",
    to: "| **Zenix CC** | `windows/zenix-cc` | empty | only `window.json` — seat for native Claude Desktop |",
  },
  {
    file: "BRAND.md",
    from: "| **Ultra** | Zenix CC | reserved slot, deliberately outside the ladder |",
    to: "| **Ultra** | Zenix CC | native Claude Desktop seat, outside the ladder |",
  },
];

for (const edit of edits) {
  const path = join(root, edit.file);
  const before = await readFile(path, "utf8");
  if (!before.includes(edit.from)) {
    console.log(`skip       ${edit.file} (text not found)`);
    continue;
  }
  await writeFile(path, before.split(edit.from).join(edit.to), "utf8");
  console.log(`updated    ${edit.file}`);
}
