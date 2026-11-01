import { afterEach, describe, expect, it, vi } from "vitest";

async function importFreshEnvModule() {
  vi.resetModules();
  return await import("../src/env.js");
}

describe("shared runtime env", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("构建期可选能力未注入时关闭", async () => {
    const env = await importFreshEnvModule();

    expect(env.CF_ARMS_RUM_ENDPOINT).toBe("");
    expect(env.CF_AUTO_UPDATE_ENABLED).toBe(false);
  });

  it("未注入 CF_ENV 时默认 test 并映射为 local", async () => {
    vi.stubGlobal("__CF_ENV__", undefined);

    const env = await importFreshEnvModule();

    expect(env.CF_ENV).toBe("test");
    expect(env.normalizeCfEnv("development")).toBe("test");
    expect(env.mapCfEnvToArmsRumEnv("production")).toBe("local");
  });

  it("未注入身份 define 时 flavor 跟随 CF_ENV", async () => {
    vi.stubGlobal("__CF_ENV__", "production");
    vi.stubGlobal("__CF_PRODUCT_FLAVOR__", undefined);

    const env = await importFreshEnvModule();

    expect(env.CF_PRODUCT_FLAVOR).toBe("production");
    expect(env.normalizeCfProductFlavor(undefined, "test")).toBe("preview");
    expect(env.normalizeCfProductFlavor("bogus", "production")).toBe("production");
  });

  it("显式注入 preview 身份时生产后端构建仍是 Preview", async () => {
    vi.stubGlobal("__CF_ENV__", "production");
    vi.stubGlobal("__CF_PRODUCT_FLAVOR__", "preview");

    const env = await importFreshEnvModule();

    expect(env.CF_ENV).toBe("production");
    expect(env.CF_PRODUCT_FLAVOR).toBe("preview");
  });

  it("mapCfEnvToArmsRumEnv 将非本地 production 映射为 prod", async () => {
    vi.stubGlobal("__CF_ENV__", "production");

    const env = await importFreshEnvModule();

    expect(env.mapCfEnvToArmsRumEnv("production")).toBe("prod");
  });

  it("mapCfEnvToArmsRumEnv 在本地开发态忽略 production 产品环境并映射为 local", async () => {
    vi.stubGlobal("__CF_ENV__", "production");

    const env = await importFreshEnvModule();

    expect(env.mapCfEnvToArmsRumEnv("development")).toBe("local");
  });
});
