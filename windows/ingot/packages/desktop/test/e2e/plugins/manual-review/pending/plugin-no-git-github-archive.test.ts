import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CfPluginInfo } from "@origin-ai/cf-shared";
import { clearAppData, getE2EAppDataPaths } from "../../../helpers/desktop-app.js";
import {
  addMarketplaceSourceThroughAgent,
  getPluginList,
  getPluginOverview,
  installMarketplacePluginThroughAgent,
  requirePluginManualReview,
  updateMarketplaceThroughAgent,
} from "../../../helpers/plugin-management-lifecycle.js";

const CLAUDE_MARKETPLACE_ID = "claude-plugins-official";
const CLAUDE_HTTP_PLUGIN_NAME = "aikido";
const CLAUDE_HTTP_PLUGIN_ID = `${CLAUDE_HTTP_PLUGIN_NAME}@${CLAUDE_MARKETPLACE_ID}`;
const NON_GITHUB_GIT_PROBE = "https://gitlab.example.invalid/e2e/no-git-plugin.git";
const REAL_HTTP_INSTALL_TIMEOUT_MS = 600_000;

describe("PLM-LC-011 Desktop real Claude plugin HTTP install without Git", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Git 不可用时通过 GitHub Archive 刷新 Claude Marketplace 并安装真实插件", async function () {
    this.timeout(REAL_HTTP_INSTALL_TIMEOUT_MS);
    requirePluginManualReview();
    await browser.setTimeout({ script: REAL_HTTP_INSTALL_TIMEOUT_MS });

    const gitBinary = await browser.electron.execute(() => process.env.CF_GIT_BINARY ?? "");
    expect(gitBinary).toContain("missing-bin");
    expect(existsSync(gitBinary)).toBe(false);

    let probeFailure = "";
    try {
      await addMarketplaceSourceThroughAgent(NON_GITHUB_GIT_PROBE);
    } catch (error) {
      probeFailure = error instanceof Error ? error.message : String(error);
    }
    expect(probeFailure).toContain("git is unavailable on this Agent Host");

    const refresh = await updateMarketplaceThroughAgent(CLAUDE_MARKETPLACE_ID);
    expect(refresh.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error" })]),
    );

    const before = await getPluginOverview();
    expect(before.marketplaces.find((item) => item.id === CLAUDE_MARKETPLACE_ID)).toMatchObject({
      id: CLAUDE_MARKETPLACE_ID,
    });
    expect(
      before.availablePlugins.find((plugin) => plugin.id === CLAUDE_HTTP_PLUGIN_ID),
    ).toMatchObject({
      installed: false,
      marketplace: CLAUDE_MARKETPLACE_ID,
      name: CLAUDE_HTTP_PLUGIN_NAME,
    });

    const install = await installMarketplacePluginThroughAgent(
      CLAUDE_HTTP_PLUGIN_NAME,
      CLAUDE_MARKETPLACE_ID,
    );
    expect(install.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error" })]),
    );
    expect(install.installedPlugins).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: CLAUDE_HTTP_PLUGIN_ID })]),
    );

    const pluginStorageRoot = join(getE2EAppDataPaths().storageRoot, "cli", "plugins");
    const installed = readInstalledRecord(pluginStorageRoot);
    expect(installed.source).toMatchObject({
      source: "url",
      url: "https://github.com/AikidoSec/aikido-claude-plugin.git",
    });
    expect(installed.source?.sha ?? "").toMatch(/^[a-f0-9]{40}$/u);
    expect(existsSync(join(installed.installPath, ".claude-plugin", "plugin.json"))).toBe(true);

    const marketplaceRoot = join(pluginStorageRoot, "marketplaces", CLAUDE_MARKETPLACE_ID);
    expect(existsSync(join(marketplaceRoot, ".git"))).toBe(false);
    expect(existsSync(join(installed.installPath, ".git"))).toBe(false);

    const plugin = (await getPluginList()).plugins.find(
      (item) => item.id === CLAUDE_HTTP_PLUGIN_ID,
    );
    expect(plugin).toMatchObject({
      enabled: true,
      rootPath: installed.installPath,
      version: installed.version,
    });
    expect(componentNames(plugin, "mcp")).not.toHaveLength(0);
  });
});

function readInstalledRecord(pluginStorageRoot: string): {
  installPath: string;
  source?: { sha?: string; source?: string; url?: string };
  version: string;
} {
  const state = JSON.parse(
    readFileSync(join(pluginStorageRoot, "installed_plugins.json"), "utf-8"),
  ) as {
    plugins?: Array<{
      id?: string;
      installPath?: string;
      source?: { sha?: string; source?: string; url?: string };
      version?: string;
    }>;
  };
  const record = state.plugins?.find((plugin) => plugin.id === CLAUDE_HTTP_PLUGIN_ID);
  if (!record?.installPath || !record.version) {
    throw new Error(`Installed record missing for ${CLAUDE_HTTP_PLUGIN_ID}`);
  }
  return {
    installPath: record.installPath,
    ...(record.source ? { source: record.source } : {}),
    version: record.version,
  };
}

function componentNames(plugin: CfPluginInfo | undefined, kind: "mcp"): string[] {
  return (
    plugin?.components?.find((group) => group.kind === kind)?.items.map((item) => item.name) ?? []
  );
}
