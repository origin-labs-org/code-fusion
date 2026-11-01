/**
 * Writes each part's `window.json` from the registry, so identity files never drift.
 *
 * Usage: node scripts/rebrand/sync-window-json.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const registry = JSON.parse(await readFile(join(root, "arch", "windows.json"), "utf8"));

for (const part of registry.parts) {
  const folder = join(root, part.folder);
  await mkdir(folder, { recursive: true });
  const record = {
    codename: part.codename,
    alias: part.alias ?? "#",
    windowTitle: part.codename,
    folder: part.folder,
    contents: part.contents,
    status: part.status,
  };
  await writeFile(join(folder, "window.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`wrote ${part.folder}/window.json`);
}

const launcher = {
  name: registry.launcher.name,
  windowTitle: registry.launcher.windowTitle,
  folder: "launcher",
  role: registry.launcher.role,
  status: registry.launcher.status,
  entry: "launcher/index.html",
  parts: registry.parts.map((part) => part.codename),
  aliases: {
    ladder: registry.naming.ladder,
    retired: registry.naming.retiredAliases,
    resolve: registry.aliasResolve,
  },
};
await writeFile(join(root, "launcher", "window.json"), `${JSON.stringify(launcher, null, 2)}\n`, "utf8");
console.log("wrote launcher/window.json");
