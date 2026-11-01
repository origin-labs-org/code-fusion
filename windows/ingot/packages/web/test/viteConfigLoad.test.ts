import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "vite";

describe("web Vite config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, "   ", " 3.12.9-beta.1 "])(
    "构建Version使用手动Valueor package Default value：%s",
    async (override) => {
      vi.stubEnv("WEB_REMOTE_FRONTEND_VERSION", override);
      const webRoot = resolve(import.meta.dirname, "..");
      const { version } = JSON.parse(
        await readFile(resolve(webRoot, "../../package.json"), "utf8"),
      );
      const result = await loadConfigFromFile(
        { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
        resolve(webRoot, "vite.config.ts"),
        webRoot,
        "silent",
      );
      expect(result?.config.define?.__CF_VERSION__).toBe(
        JSON.stringify(override?.trim() || version),
      );
    },
  );

  it("非法手动Version在构建Configuration加载时Failed", async () => {
    vi.stubEnv("WEB_REMOTE_FRONTEND_VERSION", "../latest");
    const webRoot = resolve(import.meta.dirname, "..");
    await expect(
      loadConfigFromFile(
        { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
        resolve(webRoot, "vite.config.ts"),
        webRoot,
        "silent",
      ),
    ).rejects.toThrow(/version/i);
  });

  it("publishes PDF.js CMaps for non-latin PDF rendering", async () => {
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.plugins?.some((plugin) => plugin.name === "cf:pdfjs-cmaps")).toBe(
      true,
    );
  });

  it("显式 CF_ENV=production 时注入生产 ZAI OAuth and API 链接", async () => {
    vi.stubEnv("CF_ENV", "production");
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.define).toMatchObject({
      "import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID": JSON.stringify("client_P8X5CMWmlaRO9gyO-KSqtg"),
      "import.meta.env.VITE_CF_BASE_URL": JSON.stringify("https://cf.z.ai"),
    });
  });

  it.each([
    ["test", "https://bigmodel.cn"],
    ["production", "https://bigmodel.cn"],
  ])("%s 构建向远控登录页注入对应 BigModel 授权域名", async (environment, origin) => {
    vi.stubEnv("CF_ENV", environment);
    const webRoot = resolve(import.meta.dirname, "..");
    const result = await loadConfigFromFile(
      { command: "build", mode: "production", isPreview: false, isSsrBuild: false },
      resolve(webRoot, "vite.config.ts"),
      webRoot,
      "silent",
    );
    expect(result?.config.define?.["import.meta.env.VITE_BIGMODEL_OAUTH_ORIGIN"]).toBe(
      JSON.stringify(origin),
    );
  });

  const isWindows = process.platform === "win32";

  (isWindows ? it.skip : it)(
    "uses the same public ZAI OAuth origin in local development mode",
    async () => {
      vi.stubEnv("CF_ENV", "");
      vi.stubEnv("CF_BASE_URL", "");
      vi.stubEnv("ZAI_OAUTH_ORIGIN", "");
      vi.stubEnv("ZAI_OAUTH_CLIENT_ID", "");
      const webRoot = resolve(import.meta.dirname, "..");
      const configFile = resolve(webRoot, "vite.config.ts");
      const result = await loadConfigFromFile(
        {
          command: "serve",
          mode: "development",
          isPreview: false,
          isSsrBuild: false,
        },
        configFile,
        webRoot,
        "silent",
      );

      expect(result?.config.define).toMatchObject({
        "import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID": JSON.stringify("client_P8X5CMWmlaRO9gyO-KSqtg"),
        "import.meta.env.VITE_CF_BASE_URL": JSON.stringify("https://cf.z.ai"),
        "import.meta.env.VITE_ZAI_OAUTH_ORIGIN": JSON.stringify("https://chat.z.ai"),
      });
    },
  );

  it("uses shared CodeFusion endpoint env override for renderer injection", async () => {
    vi.stubEnv("CF_ENV", "test");
    vi.stubEnv("CF_BASE_URL", "https://cf.z.ai/custom/path");
    const webRoot = resolve(import.meta.dirname, "..");
    const configFile = resolve(webRoot, "vite.config.ts");
    const result = await loadConfigFromFile(
      {
        command: "build",
        mode: "production",
        isPreview: false,
        isSsrBuild: false,
      },
      configFile,
      webRoot,
      "silent",
    );

    expect(result?.config.define).toMatchObject({
      "import.meta.env.VITE_CF_BASE_URL": JSON.stringify("https://cf.z.ai"),
      "import.meta.env.VITE_CF_ENDPOINT_ORIGIN": JSON.stringify("https://cf.z.ai"),
    });
  });
});
