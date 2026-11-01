import { describe, expect, it } from "vitest";
import tsupConfig, {
  resolveBuildPackagedAgentTelemetryEnv,
  resolveBuildRemoteCdnReleaseRoots,
  resolveDesktopTsupBundleSecurityOptions,
} from "../tsup.config";

type EsbuildLikeOptions = {
  chunkNames?: string;
  legalComments?: string;
};

function getChunkNames(configName: string): string | undefined {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();

  const esbuildOptions: EsbuildLikeOptions = {};
  target?.esbuildOptions?.(esbuildOptions);
  return esbuildOptions.chunkNames;
}

function getExternal(configName: string): string[] {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();
  expect(Array.isArray(target?.external)).toBe(true);
  return target?.external as string[];
}

function getNoExternal(configName: string): string[] {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();
  expect(Array.isArray(target?.noExternal)).toBe(true);
  return target?.noExternal as string[];
}

function getDefines(configName: string): Record<string, string> {
  const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
  const target = configs.find((config) => config.name === configName);
  expect(target).toBeDefined();
  return target?.define ?? {};
}

describe("desktop tsup chunk isolation", () => {
  it("ZIP unpacker should be externalized to prevent crashes from dynamic require of fs during Electron ESM startup", () => {
    for (const name of ["main", "host", "scheduler"]) expect(getExternal(name)).toContain("yauzl");
  });
  it("main 构建应将 chunk 输出到 main 子目录，避免覆盖 host 构建产物", () => {
    expect(getChunkNames("main")).toBe("main/chunk-[hash]");
  });

  it("host 构建应将 chunk 输出到 host 子目录，避免覆盖 main 构建产物", () => {
    expect(getChunkNames("host")).toBe("host/chunk-[hash]");
  });

  it("main/host builds should externalize Feishu SDK to prevent crashes from Electron ESM dynamic require", () => {
    expect(getExternal("main")).toContain("@larksuiteoapi/node-sdk");
    expect(getExternal("host")).toContain("@larksuiteoapi/node-sdk");
  });

  it("main/host builds should externalize yaml to prevent crashes from Electron ESM dynamic require", () => {
    expect(getExternal("main")).toContain("yaml");
    expect(getExternal("host")).toContain("yaml");
  });

  it("main/host/scheduler 应内联 CUA producer，安装包不能依赖被排除的 @cf node_modules", () => {
    for (const configName of ["main", "host", "scheduler"]) {
      expect(getNoExternal(configName)).toContain("@origin-ai/cf-cua");
    }
  });

  it("main/host/scheduler should inline Provider workspace packages; Electron cannot directly load TypeScript source", () => {
    for (const configName of ["main", "host", "scheduler"]) {
      expect(getNoExternal(configName)).toContain("@origin-ai/cf-provider");
      expect(getNoExternal(configName)).toContain("@origin-ai/cf-provider-node");
    }
  });

  it("Production builds should minify main/host/preload and omit sourcemaps", () => {
    expect(resolveDesktopTsupBundleSecurityOptions({ NODE_ENV: "production" })).toEqual({
      keepNames: true,
      minify: true,
      sourcemap: false,
    });
  });

  it("Development builds should retain sourcemaps for local debugging", () => {
    expect(resolveDesktopTsupBundleSecurityOptions({ NODE_ENV: "development" })).toEqual({
      keepNames: false,
      minify: false,
      sourcemap: true,
    });
  });

  it("E2E coverage builds should disable minification and retain sourcemaps", () => {
    expect(
      resolveDesktopTsupBundleSecurityOptions({
        NODE_ENV: "production",
        CF_E2E_COVERAGE: "1",
      }),
    ).toEqual({
      keepNames: false,
      minify: false,
      sourcemap: true,
    });
  });

  it("remote runtime CDN root should allow multi-value injection via CI's CDN_DOMAIN/OSS_PATH_PREFIX", () => {
    expect(
      resolveBuildRemoteCdnReleaseRoots({
        CDN_DOMAIN: "cdn-cf.z.ai,cdn.cf-ai.com",
        OSS_PATH_PREFIX: "cf/electron/releases",
      }),
    ).toEqual([
      "https://cdn-cf.z.ai/cf/electron/releases",
      "https://cdn.cf-ai.com/cf/electron/releases",
    ]);
  });

  it("Should fail when path prefix counts for remote runtime CDN root do not match", () => {
    expect(() =>
      resolveBuildRemoteCdnReleaseRoots({
        CDN_DOMAIN: "cdn-cf.z.ai,cdn.cf-ai.com",
        OSS_PATH_PREFIX: "new-prefix,old-prefix,extra-prefix",
      }),
    ).toThrow("OSS_PATH_PREFIX must contain one value or match CDN_DOMAIN count");
  });

  it("Agent OTLP configuration in official installer should map to standard environment fields used by Main", () => {
    expect(
      resolveBuildPackagedAgentTelemetryEnv({
        CF_ENV: "production",
        CF_PACKAGED_AGENT_OTEL_ENDPOINT: "https://arms.example.com/otlp",
        CF_PACKAGED_AGENT_OTEL_HEADERS: "x-arms-license-key=write-only",
        CF_PACKAGED_AGENT_OTEL_SERVICE_NAME: "cf-cli-agent",
      }),
    ).toEqual({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://arms.example.com/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "x-arms-license-key=write-only",
      OTEL_SERVICE_NAME: "cf-cli-agent",
      CF_TELEMETRY_RUNTIME_DISTRIBUTION: "packaged",
    });
  });

  it("Should block build if Agent OTLP configuration in official installer is incomplete or uses HTTP in production", () => {
    expect(() =>
      resolveBuildPackagedAgentTelemetryEnv({
        CF_ENV: "production",
        CF_PACKAGED_AGENT_OTEL_ENDPOINT: "https://arms.example.com/otlp",
      }),
    ).toThrow("must be configured together");
    expect(() =>
      resolveBuildPackagedAgentTelemetryEnv({
        CF_ENV: "production",
        CF_PACKAGED_AGENT_OTEL_ENDPOINT: "http://arms.example.com/otlp",
        CF_PACKAGED_AGENT_OTEL_HEADERS: "x-arms-license-key=write-only",
      }),
    ).toThrow("must use HTTPS in production");
  });

  it("release/current and Tag builds should fail when missing Agent OTLP configuration, while normal dev builds remain Noop", () => {
    expect(resolveBuildPackagedAgentTelemetryEnv({})).toEqual({});
    expect(() =>
      resolveBuildPackagedAgentTelemetryEnv({
        CI: "true",
        CI_COMMIT_BRANCH: "release/current",
      }),
    ).toThrow("required for release builds");
    expect(() =>
      resolveBuildPackagedAgentTelemetryEnv({
        CI: "true",
        CI_COMMIT_TAG: "v3.6.0",
      }),
    ).toThrow("required for release builds");
  });

  it("Installer identity and backend environment are injected into each bundle as two compile-time constants", () => {
    for (const entry of ["main", "host", "preload"] as const) {
      const defines = getDefines(entry);
      expect(defines).toHaveProperty("__CF_ENV__");
      expect(defines).toHaveProperty("__CF_PRODUCT_FLAVOR__");
      expect(["\"production\"", "\"preview\""]).toContain(defines.__CF_PRODUCT_FLAVOR__);
    }
  });

  it("Agent OTLP 部署默认值只应编译进 Main bundle", () => {
    expect(getDefines("main")).toHaveProperty("__CF_PACKAGED_AGENT_TELEMETRY_ENV__");
    expect(getDefines("host")).not.toHaveProperty("__CF_PACKAGED_AGENT_TELEMETRY_ENV__");
    expect(getDefines("preload")).not.toHaveProperty("__CF_PACKAGED_AGENT_TELEMETRY_ENV__");
  });

  it("所有 tsup 子构建都应关闭 esbuild legal comments 输出", () => {
    for (const configName of ["main", "host", "preload"]) {
      const configs = Array.isArray(tsupConfig) ? tsupConfig : [tsupConfig];
      const target = configs.find((config) => config.name === configName);
      expect(target).toBeDefined();

      const esbuildOptions: EsbuildLikeOptions = {};
      target?.esbuildOptions?.(esbuildOptions);
      expect(esbuildOptions.legalComments).toBe("none");
    }
  });
});
