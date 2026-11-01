import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function readPluginName(pluginRoot) {
  const manifestPath = join(pluginRoot, ".cf-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest.name !== "string" || manifest.name.length === 0)
    throw new Error(`${manifestPath}: MissingPlugins name`);
  return manifest.name;
}
