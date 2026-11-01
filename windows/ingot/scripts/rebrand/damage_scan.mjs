/** Fast syntax-damage scan: esbuild-parse every src .ts/.tsx after the comment strip. */
import { createRequire } from "node:module";
import { transform } from "esbuild";

const ROOT = "C:/Users/thaku/Workspaces/fusion/code-fusion";
const requireFromRoot = createRequire(`${ROOT}/package.json`);
const esbuild = requireFromRoot("esbuild");

const EXCLUDE = new Set(["node_modules", ".git", "dist", "graphify-out", "cf-old", ".turbo", ".cache"]);

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const damaged = [];
async function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (EXCLUDE.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) await walk(p);
    else if (/\.(ts|tsx|mjs|cjs|js|jsx)$/.test(name) && /(^|\/)(src|scripts|test)\//.test(p.replaceAll("\\", "/"))) {
      try {
        await esbuild.transform(readFileSync(p, "utf8"), { loader: name.endsWith("x") ? "tsx" : "ts" });
      } catch (e) {
        const first = (e.errors || [{}])[0];
        damaged.push(`${relative(ROOT, p).replaceAll("\\", "/")}:${first.location?.line ?? "?"} ${first.text?.slice(0, 60)}`);
      }
    }
  }
}
await walk(ROOT);
console.log(`damaged files: ${damaged.length}`);
for (const d of damaged) console.log("  " + d);
