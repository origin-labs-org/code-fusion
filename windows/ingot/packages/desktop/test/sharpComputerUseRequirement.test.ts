import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { isSharpRequiredByComputerUse } from "../scripts/sharp-package-assets.mjs";

const roots: string[] = [];

function createWorkspace(cuaManifest: Record<string, unknown> | null, location: "root" | "desktop") {
  const root = mkdtempSync(join(tmpdir(), "cf-sharp-cua-"));
  roots.push(root);
  const desktopRoot = join(root, "packages", "desktop");
  mkdirSync(desktopRoot, { recursive: true });
  if (cuaManifest) {
    const base = location === "root" ? root : desktopRoot;
    const cuaDir = join(base, "node_modules", "@cf", "cf-cua");
    mkdirSync(cuaDir, { recursive: true });
    writeFileSync(join(cuaDir, "package.json"), JSON.stringify(cuaManifest));
  }
  return desktopRoot;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("isSharpRequiredByComputerUse", () => {
  it("Real Computer Use package requires staging sharp when sharp is declared", () => {
    const desktopRoot = createWorkspace(
      { name: "@origin-ai/cf-cua", dependencies: { sharp: "^0.34.0" } },
      "root",
    );
    expect(isSharpRequiredByComputerUse({ desktopPackageRoot: desktopRoot })).toBe(true);
  });

  it("Placeholder packages without sharp declared do not need sharp; prioritize reading the installation closest to desktop package", () => {
    const desktopRoot = createWorkspace({ name: "@origin-ai/cf-cua", version: "0.6.3" }, "desktop");
    expect(isSharpRequiredByComputerUse({ desktopPackageRoot: desktopRoot })).toBe(false);
  });

  it("sharp is not required when the Computer Use package is not found", () => {
    const desktopRoot = createWorkspace(null, "root");
    expect(isSharpRequiredByComputerUse({ desktopPackageRoot: desktopRoot })).toBe(false);
  });
});
