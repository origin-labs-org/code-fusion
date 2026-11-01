import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  isRealComputerUseProducerInstalled,
  readComputerUseProducer,
} from "../scripts/computer-use-producer.mjs";
import { stageDevCuaPluginRuntime } from "../../../scripts/stage-dev-cua-plugin-runtime.mjs";

const roots: string[] = [];

function createWorkspace(cuaManifest: Record<string, unknown> | null) {
  const root = mkdtempSync(join(tmpdir(), "cf-cua-producer-"));
  roots.push(root);
  const desktopRoot = join(root, "packages", "desktop");
  mkdirSync(desktopRoot, { recursive: true });
  if (cuaManifest) {
    const cuaDir = join(root, "node_modules", "@cf", "cf-cua");
    mkdirSync(cuaDir, { recursive: true });
    writeFileSync(join(cuaDir, "package.json"), JSON.stringify(cuaManifest));
  }
  return desktopRoot;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("Computer Use producer detection", () => {
  it("Real producer: installed and not declared as a placeholder", () => {
    const desktopRoot = createWorkspace({ name: "@origin-ai/cf-cua", version: "0.6.4" });
    expect(readComputerUseProducer({ desktopPackageRoot: desktopRoot })).toMatchObject({
      installed: true,
      placeholder: false,
    });
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot: desktopRoot })).toBe(true);
  });

  it("Open-source placeholder package: not considered a real producer when declaring cfCuaPlaceholder", () => {
    const desktopRoot = createWorkspace({ name: "@origin-ai/cf-cua", cfCuaPlaceholder: true });
    expect(readComputerUseProducer({ desktopPackageRoot: desktopRoot })).toMatchObject({
      installed: true,
      placeholder: true,
    });
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it("未安装任何 producer 时不算真实 producer", () => {
    const desktopRoot = createWorkspace(null);
    expect(readComputerUseProducer({ desktopPackageRoot: desktopRoot }).installed).toBe(false);
    expect(isRealComputerUseProducerInstalled({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it("Skip dev plugin runtime staging directly under placeholder package; sharp and plugin manifest not required", () => {
    const desktopRoot = createWorkspace({ name: "@origin-ai/cf-cua", cfCuaPlaceholder: true });
    expect(
      stageDevCuaPluginRuntime({
        env: { CF_CUA_DEV_MODE: "1" },
        desktopPackageRoot: desktopRoot,
        pluginRoot: join(desktopRoot, "missing-plugin"),
      }),
    ).toEqual([]);
  });
});
