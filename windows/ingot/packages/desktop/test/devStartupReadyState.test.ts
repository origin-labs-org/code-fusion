import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import tsupConfig from "../tsup.config";

const desktopPackageJsonPath = resolve(import.meta.dirname, "../package.json");
const devScriptPath = resolve(import.meta.dirname, "../scripts/dev.mjs");

const desktopPackageJson = JSON.parse(readFileSync(desktopPackageJsonPath, "utf8")) as {
  scripts: Record<string, string | undefined>;
};
const devScriptSource = readFileSync(devScriptPath, "utf8");
const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];

function getConfig(name: string) {
  const target = configs.find((config) => config.name === name);
  expect(target).toBeDefined();
  return target;
}

describe("desktop dev startup ready state", () => {
  it("The dev command should no longer use CLI-level onSuccess to avoid premature release when preload succeeds", () => {
    expect(desktopPackageJson.scripts.dev).not.toContain("--onSuccess");
  });

  it("每个 tsup config 都应在自身成功后写入独立 ready 标记", () => {
    expect(getConfig("main").onSuccess).toBe('node scripts/write-dev-ready-marker.mjs main');
    expect(getConfig("host").onSuccess).toBe('node scripts/write-dev-ready-marker.mjs host');
    expect(getConfig("preload").onSuccess).toBe('node scripts/write-dev-ready-marker.mjs preload');
  });

  it("Wait for all main/host/preload ready flags before starting Electron, rather than checking a single file", () => {
    expect(devScriptSource).toContain("const buildReadyMarkers = [");
    expect(devScriptSource).toContain('resolve(root, "out/.main-build-ready")');
    expect(devScriptSource).toContain('resolve(root, "out/.host-build-ready")');
    expect(devScriptSource).toContain('resolve(root, "out/.preload-build-ready")');
    expect(devScriptSource).not.toContain("while (!existsSync(mainBundle))");
  });
});
