// Sync the built dev plugin into the CLI's plugin cache so the running cf CLI
// (which loads plugins from ~/.cf/cli/plugins/cache/..., NOT from this repo)
// picks up skill / MCP / manifest changes without a manual copy.
//
// This closes the last hop of the sync chain:
//   packages/cf-cua/plugin  --sync:skill-->  dev plugin (here)  --sync:cache-->  CLI cache
//
// The cache dir name (e.g. 0.1.31) is just an install-time cache key; copying newer
// content (plugin.json says 0.2.0) on top of it is tolerated by the CLI and is exactly
// what makes a dev skill/MCP edit go live. Run after `pnpm sync:skill` (+ `pnpm build`
// when the MCP wrapper or skill changed).
//
// Usage:
//   node scripts/sync-cache.mjs            # auto-resolve cache path from marketplace.json
//   node scripts/sync-cache.mjs <cacheDir> # explicit cache dir
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { stageSharpIntoBundledAgents } from "../../../../../packages/desktop/scripts/sharp-package-assets.mjs";
import { stageKoffiIntoBundledAgents } from "../../../../../packages/desktop/scripts/koffi-package-assets.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const devPlugin = packageRoot;
// Build artifacts that constitute an installed plugin in the cache.
const ENTRIES = [
  "skills",
  "docs",
  "scripts/computer-use-client.mjs",
  ".cf-plugin",
  "package.json",
  "node_modules",
];

/**
 * Resolve the CLI cache dir for cf-cua. Prefer the cachePath declared in the
 * cf-plugins-official marketplace.json; fall back to the single version dir under
 * the cache root. Throws if neither yields an existing dir (plugin not installed).
 */
async function resolveCacheDir() {
  if (process.argv[2]) return resolve(process.argv[2]);
  const marketplace = join(
    homedir(),
    ".cf/cli/plugins/marketplaces/cf-plugins-official/marketplace.json",
  );
  try {
    const text = await readFile(marketplace, "utf8");
    const parsed = JSON.parse(text);
    const entry = (parsed.plugins ?? parsed.items ?? []).find(
      (p) => p?.name === "computer-use" && p?.cachePath,
    );
    if (entry?.cachePath && existsSync(entry.cachePath)) return entry.cachePath;
  } catch {
    // marketplace.json missing/unreadable — fall through to glob.
  }
  const cacheRoot = join(homedir(), ".cf/cli/plugins/cache/cf-plugins-official/computer-use");
  if (existsSync(cacheRoot)) {
    const dirs = await readdir(cacheRoot);
    if (dirs.length === 1) return join(cacheRoot, dirs[0]);
    if (dirs.length > 1) {
      // Pick the newest by mtime — the most recently installed version.
      let newest = null;
      for (const d of dirs) {
        const s = await stat(join(cacheRoot, d));
        if (!newest || s.mtimeMs > newest.mtimeMs) newest = { d, mtimeMs: s.mtimeMs };
      }
      if (newest) return join(cacheRoot, newest.d);
    }
  }
  throw new Error(
    `Could not resolve the cf-cua CLI cache dir. The plugin does not appear to be ` +
      `installed — run it once from the cf UI/TUI to install, then re-run sync:cache. ` +
      `(looked in marketplace.json and ${cacheRoot})`,
  );
}

const cacheDir = await resolveCacheDir();
await mkdir(cacheDir, { recursive: true });

const copied = [];
for (const entry of ENTRIES) {
  const src = join(devPlugin, entry);
  if (!existsSync(src)) continue; // e.g. dist/ before first build
  const dest = join(cacheDir, entry);
  // cp with recursive + force replacement; file/dir both handled.
  await cp(pathToFileURL(src), pathToFileURL(dest), { recursive: true, force: true });
  copied.push(entry);
}

stageSharpIntoBundledAgents({
  desktopPackageRoot: resolve(packageRoot, "../../../../packages/desktop"),
  glmDir: cacheDir,
  targetPlatform: { os: process.platform, arch: process.arch },
});
copied.push("node_modules/sharp runtime");
stageKoffiIntoBundledAgents({
  koffiPackageRoot: resolve(packageRoot, "../adapters"),
  glmDir: cacheDir,
  targetPlatform: { os: process.platform, arch: process.arch },
});
copied.push("node_modules/koffi runtime");

console.log(`sync:cache → ${cacheDir}`);
console.log(`  copied: ${copied.join(", ") || "(nothing)"}`);
console.log(
  `  note: the cache dir name is an install-time key and may lag the plugin.json ` +
    `version inside — that is expected and does not affect loading.`,
);
