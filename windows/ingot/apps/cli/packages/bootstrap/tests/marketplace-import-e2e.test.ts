//
//   -> pluginManagementStore.addMarketplace(source) -> agentService.addPluginMarketplace
//
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCfPluginMarketplace, getCfPluginsOverview } from "../src/plugins.js";
function addViaFacade(source: string, storageRoot: string, workingDirectory: string) {
  return addCfPluginMarketplace({
    source,
    pluginStorageRoot: storageRoot,
    workingDirectory,
    skipUserConfig: true,
  });
}

function overview(storageRoot: string, workingDirectory: string) {
  return getCfPluginsOverview({
    pluginStorageRoot: storageRoot,
    workingDirectory,
    skipUserConfig: true,
  });
}

async function makeLocalMarketplace(root: string, name: string): Promise<void> {
  const pluginDir = join(root, "plugins", "hello");
  await mkdir(join(root, ".claude-plugin"), { recursive: true });
  await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
  await mkdir(join(pluginDir, "skills", "hello"), { recursive: true });
  await writeFile(
    join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify(
      { name, plugins: [{ name: "hello", version: "1.0.0", source: "./plugins/hello" }] },
      null,
      2,
    ),
  );
  await writeFile(
    join(pluginDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "hello", version: "1.0.0", skills: "skills" }, null, 2),
  );
  await writeFile(join(pluginDir, "skills", "hello", "SKILL.md"), "# hello\n");
}

describe("marketplace 自定义导入 E2E (真实 agent facade)", () => {
  it("本地目录导入：raw 目录路径 -> directory 来源 -> 落盘 + overview 可见", async () => {
    const base = await mkdtemp(join(tmpdir(), "cf-e2e-localdir-"));
    const storageRoot = join(base, "storage");
    const market = join(base, "my-local-market");
    try {
      await makeLocalMarketplace(market, "e2e-local-dir-market");

      const summary = await addViaFacade(market, storageRoot, base);
      expect(summary.id).toBe("e2e-local-dir-market");
      expect(summary.pluginCount).toBe(1);

      const knownPath = join(storageRoot, "known_marketplaces.json");
      expect(existsSync(knownPath)).toBe(true);
      const known = JSON.parse(await readFile(knownPath, "utf8")) as {
        marketplaces: Array<{ id: string; source: { source: string; path?: string } }>;
      };
      const rec = known.marketplaces.find((m) => m.id === "e2e-local-dir-market");
      expect(rec?.source.source).toBe("directory");
      expect(rec?.source.path).toBe(market);

      const manifestCopy = join(
        storageRoot,
        "marketplaces",
        "e2e-local-dir-market",
        "marketplace.json",
      );
      expect(existsSync(manifestCopy)).toBe(true);

      const ov = overview(storageRoot, base);
      expect(ov.marketplaces.some((m) => m.id === "e2e-local-dir-market")).toBe(true);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });

  it("非法来源：facade 抛错（驱动 store 失败分支 -> 返回 false -> popover 保留输入），且不误落盘", async () => {
    const base = await mkdtemp(join(tmpdir(), "cf-e2e-invalid-"));
    const storageRoot = join(base, "storage");
    try {
      await expect(
        addViaFacade("./definitely-not-a-real-marketplace-xyz", storageRoot, base),
      ).rejects.toThrow();
      expect(existsSync(join(storageRoot, "known_marketplaces.json"))).toBe(false);
    } finally {
      await rm(base, { force: true, recursive: true });
    }
  });
});
