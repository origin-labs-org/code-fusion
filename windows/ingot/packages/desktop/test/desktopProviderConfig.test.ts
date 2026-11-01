import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCfBuiltinProviderConfigFilePath } from "../src/main/desktopProviderConfig.js";

function toPosixPath(value: string) {
  return value.replaceAll("\\", "/");
}

describe("resolveCfBuiltinProviderConfigFilePath", () => {
  it("Official packages read resources; development mode reads repository config", () => {
    expect(
      toPosixPath(
        resolveCfBuiltinProviderConfigFilePath({
          isPackaged: true,
          resourcesPath: "/Applications/CodeFusion.app/Contents/Resources",
          appPath: "/Applications/CodeFusion.app/Contents/Resources/app.asar",
          env: {},
        }),
      ),
    ).toBe("/Applications/CodeFusion.app/Contents/Resources/config/provider/cf-builtin.json");

    expect(
      toPosixPath(
        resolveCfBuiltinProviderConfigFilePath({
          isPackaged: false,
          appPath: "/repo/packages/desktop",
          env: {},
        }),
      ),
    ).toBe("/repo/config/provider/cf-builtin.test.json");
  });

  it("显式 CodeFusion Built-in Config Source 优先于安装布局", () => {
    expect(
      resolveCfBuiltinProviderConfigFilePath({
        env: { CF_BUILTIN_PROVIDER_CONFIG_FILE: "/fixtures/cf-builtin.json" },
        isPackaged: true,
        resourcesPath: "/Applications/CodeFusion.app/Contents/Resources",
      }),
    ).toBe("/fixtures/cf-builtin.json");
  });
});

describe("Development mode selects config based on build environment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it.each(["test", "production"])("%s is not overridden by startup environment variables", async (environment) => {
    vi.resetModules();
    vi.stubGlobal("__CF_ENV__", environment);
    const { resolveCfBuiltinProviderConfigFilePath: resolvePath } =
      await import("../src/main/desktopProviderConfig.js");
    expect(
      toPosixPath(
        resolvePath({
          isPackaged: false,
          appPath: "/repo/packages/desktop",
          env: { CF_ENV: environment === "test" ? "production" : "test" },
        }),
      ),
    ).toBe(
      `/repo/config/provider/${environment === "production" ? "cf-builtin.json" : "cf-builtin.test.json"}`,
    );
  });
});
