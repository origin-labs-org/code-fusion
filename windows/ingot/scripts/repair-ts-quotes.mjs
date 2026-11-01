/**
 * Repairs TypeScript sources whose string literals lost their escapes.
 *
 * The rebrand translation pass re-emitted some lines as `"a "b" c"` instead of
 * `"a \"b\" c"`. This script parses each file with the TypeScript parser, and
 * for every line that reports a parse diagnostic it tries the minimal repair
 * (escape the inner quotes of the outermost string literal on that line),
 * keeping the candidate only when the diagnostic count drops.
 *
 * Usage: node scripts/repair-ts-quotes.mjs <file-or-dir...>
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";

const SKIP = /node_modules|cf-old|graphify-out|[\\/]dist[\\/]|[\\/]lib[\\/]|[\\/]out[\\/]/;

const diagnosticsOf = (fileName, text) => {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  return source.parseDiagnostics ?? [];
};

const escapeInnerDoubleQuotes = (line) => {
  const first = line.indexOf('"');
  if (first === -1) return undefined;
  const last = line.lastIndexOf('"');
  if (last <= first) return undefined;
  const body = line.slice(first + 1, last);
  if (!body.includes('"')) return undefined;
  const normalized = body.replace(/\\"/g, '"');
  const escaped = normalized.replace(/"/g, '\\"');
  return line.slice(0, first + 1) + escaped + line.slice(last);
};

const unescapeDoubledSingleQuotes = (line) => {
  if (!line.includes("\\\\'")) return undefined;
  return line.replace(/\\\\'/g, "\\'");
};

const repairFile = async (fileName) => {
  let text = await readFile(fileName, "utf8");
  let diagnostics = diagnosticsOf(fileName, text);
  if (diagnostics.length === 0) return { fileName, before: 0, after: 0 };
  const before = diagnostics.length;
  for (let pass = 0; pass < 40 && diagnostics.length > 0; pass += 1) {
    const lines = text.split("\n");
    let progressed = false;
    const candidateLines = new Set(
      diagnostics
        .filter((d) => d.start !== undefined)
        .map((d) => ts.getLineAndCharacterOfPosition(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true), d.start).line),
    );
    for (const lineIndex of candidateLines) {
      const line = lines[lineIndex];
      if (line === undefined) continue;
      for (const apply of [escapeInnerDoubleQuotes, unescapeDoubledSingleQuotes]) {
        const candidate = apply(line);
        if (candidate === undefined || candidate === line) continue;
        const nextLines = [...lines];
        nextLines[lineIndex] = candidate;
        const nextText = nextLines.join("\n");
        const nextDiagnostics = diagnosticsOf(fileName, nextText);
        if (nextDiagnostics.length < diagnostics.length) {
          text = nextText;
          diagnostics = nextDiagnostics;
          progressed = true;
          break;
        }
      }
      if (progressed) break;
    }
    if (!progressed) break;
  }
  if (text !== (await readFile(fileName, "utf8"))) await writeFile(fileName, text, "utf8");
  return { fileName, before, after: diagnostics.length };
};

const walk = async (target, out) => {
  const info = await stat(target);
  if (info.isDirectory()) {
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const path = join(target, entry.name);
      if (SKIP.test(path)) continue;
      if (entry.isDirectory()) await walk(path, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
    }
  } else if (/\.(ts|tsx)$/.test(target)) {
    out.push(target);
  }
};

const targets = [];
for (const arg of process.argv.slice(2)) await walk(arg, targets);
let broken = 0;
let remaining = 0;
for (const fileName of targets) {
  const result = await repairFile(fileName);
  if (result.before > 0) {
    broken += 1;
    remaining += result.after;
    console.log(`${result.after === 0 ? "fixed" : "partial"} ${fileName} (${result.before} -> ${result.after})`);
  }
}
console.log(`files with parse errors: ${broken}, remaining diagnostics: ${remaining}`);
process.exitCode = remaining > 0 ? 1 : 0;
