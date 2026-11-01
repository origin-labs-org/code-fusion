/**
 * Rebrands the skills copied from the Qoder environment to CodeFusion.
 *
 * Scope: only the skill directories listed in `QODER_SKILLS.md` (the vendored
 * set). Existing CodeFusion skills are never touched. Only product-identity
 * tokens change:
 *   - standalone word "Qoder" in prose -> "CodeFusion"
 *   - ".qoder/" and "~/.qoder" paths    -> ".cf/" and "~/.cf"
 * URLs (qoder.com), package ids and lowercase identifiers are left intact so
 * nothing is invented.
 *
 * Usage: node scripts/rebrand/rebrand_skills_cf.mjs <skills-dir> [--dry]
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

const skillsDir = process.argv[2];
const dry = process.argv.includes("--dry");
if (!skillsDir) {
  console.error("usage: node rebrand_skills_cf.mjs <skills-dir> [--dry]");
  process.exit(2);
}

const manifestPath = join(skillsDir, "QODER_SKILLS.md");
const manifest = await readFile(manifestPath, "utf8");
const vendored = new Set(
  [...manifest.matchAll(/^\| [^|]+ \| ([^|]+) \|/gm)].map((match) => match[1].trim()),
);
vendored.add("knowledge-plan");
// The qoder-bundler source directory is `qoder-create-plugin`, vendored as `create-plugin`.
vendored.add("create-plugin");

const EXT = /\.(md|mdc|json|ya?ml|mjs|cjs|js|jsx|ts|tsx|py|sh|toml|txt|example)$/i;

// Research data and fixtures describe Qoder as an external subject; rewriting
// them would falsify the material. Only product-facing docs are rebranded.
const SKIP_PATH = /[\\/](datasets|fixtures)[\\/]|[\\/]qoder\.md$/i;

const rebrand = (text) => {
  let out = text;
  out = out.replace(/(^|[^A-Za-z0-9_./-])Qoder(?![A-Za-z0-9_-])(?!\.(?:com|sh|dev|ai))/g, "$1CodeFusion");
  out = out.replace(/Qoder IDE\b/g, "CodeFusion IDE");
  out = out.replace(/~\/\.qoder\b/g, "~/.cf");
  out = out.replace(/\.qoder\//g, ".cf/");
  return out;
};

const walk = async (dir, files) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, files);
      continue;
    }
    if (EXT.test(entry.name)) files.push(path);
  }
};

let changedFiles = 0;
let changedOccurrences = 0;
for (const name of vendored) {
  const dir = join(skillsDir, name);
  try {
    if (!(await stat(dir)).isDirectory()) continue;
  } catch {
    continue;
  }
  const files = [];
  await walk(dir, files);
  for (const file of files) {
    if (SKIP_PATH.test(file)) continue;
    const before = await readFile(file, "utf8");
    const after = rebrand(before);
    if (after === before) continue;
    const occurrences =
      (before.match(/Qoder/g) ?? []).length - (after.match(/Qoder/g) ?? []).length;
    changedFiles += 1;
    changedOccurrences += Math.max(occurrences, 0);
    console.log(`${dry ? "would change" : "changed"} ${relative(skillsDir, file)} (-${occurrences} Qoder)`);
    if (!dry) await writeFile(file, after, "utf8");
  }
}

console.log(`\n${dry ? "dry run: " : ""}${changedFiles} file(s), ${changedOccurrences} Qoder token(s)`);
