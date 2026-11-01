/**
 * Repairs JSON files whose string values lost their backslash escapes.
 *
 * The rebrand translation pass rewrote `"map": "... \"x\" ..."` into
 * `"map": "... "x" ..."`, which is not parseable. For every `"key": "value"`
 * pair written on a single line this script normalises `\"` back to `"` and
 * then escapes every quote inside the value, restoring valid JSON.
 *
 * Usage: node scripts/repair-escaped-quotes.mjs <file...>
 */
import { readFile, writeFile } from "node:fs/promises";

const propertyValue = /^(\s*"(?:[^"\\]|\\.)+"\s*:\s*)"(.*)"(\s*,?\s*)$/;

const repair = (text) => {
  let changed = 0;
  const lines = text.split("\n").map((line) => {
    const match = propertyValue.exec(line);
    if (!match) return line;
    const [, prefix, body, suffix] = match;
    const normalized = body.replace(/\\"/g, '"');
    if (!normalized.includes('"')) return line;
    const escaped = normalized.replace(/"/g, '\\"');
    if (escaped === body) return line;
    changed += 1;
    return `${prefix}"${escaped}"${suffix}`;
  });
  return { text: lines.join("\n"), changed };
};

let failed = false;
for (const path of process.argv.slice(2)) {
  const raw = await readFile(path, "utf8");
  try {
    JSON.parse(raw);
    console.log(`ok (already valid): ${path}`);
    continue;
  } catch (error) {
    console.log(`invalid: ${path} -> ${error.message}`);
  }
  const repaired = repair(raw);
  try {
    JSON.parse(repaired.text);
  } catch (error) {
    failed = true;
    console.error(`still invalid after ${repaired.changed} repairs: ${path}`);
    console.error(error.message);
    continue;
  }
  await writeFile(path, repaired.text, "utf8");
  console.log(`repaired ${repaired.changed} string(s): ${path}`);
}

process.exitCode = failed ? 1 : 0;
