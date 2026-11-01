import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isRealComputerUseProducerInstalled } from "../packages/desktop/scripts/computer-use-producer.mjs";
import { stageSharpIntoBundledAgents } from "../packages/desktop/scripts/sharp-package-assets.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

export function stageDevCuaPluginRuntime({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  desktopPackageRoot = resolve(repositoryRoot, "packages", "desktop"),
  pluginRoot = resolve(repositoryRoot, "apps", "cf-cli", "packages", "cf-cua-plugin"),
} = {}) {
  if (env.CF_CUA_DEV_MODE !== "1") return [];
  if (!isRealComputerUseProducerInstalled({ desktopPackageRoot })) return [];

  const manifestPath = resolve(pluginRoot, ".cf-plugin", "plugin.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `[stage-dev-cua-plugin-runtime] CUA plugin manifest is missing: ${manifestPath}`,
    );
  }

  return stageSharpIntoBundledAgents({
    desktopPackageRoot,
    glmDir: pluginRoot,
    targetPlatform: {
      os: platform,
      arch,
      key: `${platform}-${arch}`,
    },
  });
}
