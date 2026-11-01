import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const CF_OFFICIAL_PLUGIN_MARKETPLACE = "cf-plugins-official";

export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set([
  "browser-use@cf-plugins-official",
  "document-skills@cf-plugins-official",
  "node-repl-host@cf-plugins-official",
  "skill-creator@cf-plugins-official",
  "cf-guide@cf-plugins-official",
]);

export interface OfficialPluginCacheRoot {
  
  name: string;
  
  versionRoots: string[];
}

export async function scanOfficialPluginCacheRoots(
  pluginStorageRoot: string,
): Promise<OfficialPluginCacheRoot[]> {
  const cacheRoot = join(pluginStorageRoot, "cache", CF_OFFICIAL_PLUGIN_MARKETPLACE);
  let pluginEntries;
  try {
    pluginEntries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const roots: OfficialPluginCacheRoot[] = [];
  for (const pluginEntry of pluginEntries) {
    if (!pluginEntry.isDirectory()) continue;
    const pluginDir = join(cacheRoot, pluginEntry.name);
    let versionEntries;
    try {
      versionEntries = await readdir(pluginDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const versionRoots = versionEntries
      .filter((entry) => entry.isDirectory() && !isTransientCacheEntryName(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" }),
      )
      .map((version) => join(pluginDir, version));
    if (versionRoots.length > 0) {
      roots.push({ name: pluginEntry.name, versionRoots });
    }
  }
  return roots.sort((left, right) => left.name.localeCompare(right.name));
}

function isTransientCacheEntryName(name: string): boolean {
  return name.includes(".backup") || name.includes(".seed-lock") || name.includes(".tmp-");
}
