/**
 * Static evidence collector for the installed Qoder app.
 *
 * Walks Qoder's shipped JS (resources/app/out, extensions) and prints
 * file:offset plus a bounded context window for each Repo Wiki needle.
 * Read-only: never writes to the Qoder installation.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = process.argv[2];
const needles = process.argv.slice(3).map((n) => n.toLowerCase());
if (!ROOT || needles.length === 0) {
  console.error("usage: node qoder-repo-wiki-evidence.mjs <app-dir> <needle...>");
  process.exit(2);
}

const SKIP = /\.(png|jpe?g|gif|ico|woff2?|ttf|map|dll|exe|node)$/i;
const MAX_PER_NEEDLE = 12;
const WINDOW = 180;

const walk = async (dir, out) => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out);
      continue;
    }
    if (!/\.(js|cjs|mjs|json|ts)$/i.test(entry.name) || SKIP.test(entry.name)) continue;
    try {
      if ((await stat(path)).size > 80 * 1024 * 1024) continue;
    } catch {
      continue;
    }
    out.push(path);
  }
};

const files = [];
await walk(ROOT, files);

const counts = new Map(needles.map((n) => [n, 0]));
for (const file of files) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    continue;
  }
  const lower = text.toLowerCase();
  for (const needle of needles) {
    if (counts.get(needle) >= MAX_PER_NEEDLE) continue;
    let index = lower.indexOf(needle);
    while (index !== -1 && counts.get(needle) < MAX_PER_NEEDLE) {
      const start = Math.max(0, index - WINDOW);
      const end = Math.min(text.length, index + needle.length + WINDOW);
      const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
      console.log(`\n### needle=${needle} file=${relative(ROOT, file)} offset=${index}`);
      console.log(snippet);
      counts.set(needle, counts.get(needle) + 1);
      index = lower.indexOf(needle, index + needle.length);
    }
  }
}

console.log("\n=== coverage");
for (const [needle, count] of counts) console.log(`${needle}: ${count} match(es)`);
console.log(`scanned ${files.length} JS/JSON files under ${ROOT}`);
