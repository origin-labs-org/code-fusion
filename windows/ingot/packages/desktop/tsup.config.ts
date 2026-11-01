import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "tsup";
import { getBuildMetadata } from "./scripts/build-metadata.mjs";
import { resolveDesktopProductFlavor } from "./scripts/desktop-product-identity.mjs";
const { copyGenUiRuntimeAssets } = await import(
  pathToFileURL(resolve(import.meta.dirname, "scripts/gen-ui-runtime-assets.mjs")).href
);
const { loadBuiltinProviderConfig } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/builtin-provider-config.mjs")).href
);
const { resolveBuildTimeConfig, createBuildTimeConfigDefines } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/build-time-config.mjs")).href
);
const buildTimeConfigDefines = createBuildTimeConfigDefines(
  await resolveBuildTimeConfig(process.env),
);

const buildMetadata = getBuildMetadata();

function resolveCfEnv(value: string | undefined): "test" | "production" {
  return value?.trim().toLowerCase() === "production" ? "production" : "test";
}

function loadEnvFiles(): Record<string, string> {
  const vars: Record<string, string> = {};
  const files = ["../../.env"];
  if (process.env.NODE_ENV === "production") {
    files.push("../../.env.production");
  } else {
    files.push("../../.env.development", "../../.env.development.local");
  }
  for (const file of files) {
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf-8").split("\n")) {
        const match = line.match(/^(\w+)=(.*)$/);
        if (match) vars[match[1]] = match[2];
      }
    }
  }
  if (process.env.CF_ENV) vars.CF_ENV = process.env.CF_ENV;
  if (process.env.CF_BASE_URL) vars.CF_BASE_URL = process.env.CF_BASE_URL;
  if (process.env.VITE_CF_BASE_URL) vars.VITE_CF_BASE_URL = process.env.VITE_CF_BASE_URL;
  if (process.env.ZAI_OAUTH_CLIENT_ID) vars.ZAI_OAUTH_CLIENT_ID = process.env.ZAI_OAUTH_CLIENT_ID;
  if (process.env.ZAI_OAUTH_ORIGIN) vars.ZAI_OAUTH_ORIGIN = process.env.ZAI_OAUTH_ORIGIN;
  if (process.env.ZAI_BUSINESS_BASE_URL) {
    vars.ZAI_BUSINESS_BASE_URL = process.env.ZAI_BUSINESS_BASE_URL;
  }
  if (process.env.ZAI_BUSINESS_LOGIN_URL) {
    vars.ZAI_BUSINESS_LOGIN_URL = process.env.ZAI_BUSINESS_LOGIN_URL;
  }
  if (process.env.CDN_DOMAIN) vars.CDN_DOMAIN = process.env.CDN_DOMAIN;
  if (process.env.OSS_PATH_PREFIX) vars.OSS_PATH_PREFIX = process.env.OSS_PATH_PREFIX;
  if (process.env.VITE_ZAI_OAUTH_CLIENT_ID) {
    vars.VITE_ZAI_OAUTH_CLIENT_ID = process.env.VITE_ZAI_OAUTH_CLIENT_ID;
  }
  if (process.env.VITE_ZAI_OAUTH_ORIGIN) {
    vars.VITE_ZAI_OAUTH_ORIGIN = process.env.VITE_ZAI_OAUTH_ORIGIN;
  }
  return vars;
}

const env = loadEnvFiles();
const { environment: cfEnv } = await loadBuiltinProviderConfig();
const cfProductFlavor = resolveDesktopProductFlavor({ ...process.env, CF_ENV: cfEnv });
console.log(`[tsup] CF_ENV=${cfEnv} CF_PRODUCT_FLAVOR=${cfProductFlavor}`);

function parseCsvEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function resolveBuildRemoteCdnReleaseRoots(runtimeEnv: Record<string, string | undefined>) {
  const domains = parseCsvEnv(runtimeEnv.CDN_DOMAIN);
  const pathPrefixes = parseCsvEnv(runtimeEnv.OSS_PATH_PREFIX || "cf/electron/releases");
  if (domains.length === 0) {
    return [];
  }
  if (pathPrefixes.length !== 1 && pathPrefixes.length !== domains.length) {
    throw new Error(
      `OSS_PATH_PREFIX must contain one value or match CDN_DOMAIN count (${domains.length}), got ${pathPrefixes.length}`,
    );
  }

  return domains.map((domain, index) => {
    const pathPrefix = pathPrefixes.length === 1 ? pathPrefixes[0] : pathPrefixes[index];
    return `https://${domain}/${pathPrefix}`.replace(/\/+$/, "");
  });
}

export function resolveBuildPackagedAgentTelemetryEnv(
  runtimeEnv: Record<string, string | undefined>,
): Record<string, string> {
  const endpoint = runtimeEnv.CF_PACKAGED_AGENT_OTEL_ENDPOINT?.trim();
  const headers = runtimeEnv.CF_PACKAGED_AGENT_OTEL_HEADERS?.trim();
  const serviceName =
    runtimeEnv.CF_PACKAGED_AGENT_OTEL_SERVICE_NAME?.trim() || "cf-cli-agent";

  if (!endpoint && !headers) {
    if (
      runtimeEnv.CI &&
      (runtimeEnv.CI_COMMIT_TAG || runtimeEnv.CI_COMMIT_BRANCH === "release/current")
    ) {
      throw new Error("Packaged Agent OTLP configuration is required for release builds");
    }
    return {};
  }
  if (!endpoint || !headers) {
    throw new Error(
      "CF_PACKAGED_AGENT_OTEL_ENDPOINT and CF_PACKAGED_AGENT_OTEL_HEADERS must be configured together",
    );
  }
  if (endpoint.length > 2_048) {
    throw new Error("CF_PACKAGED_AGENT_OTEL_ENDPOINT exceeds 2048 characters");
  }
  if (headers.length > 8_192 || /[\r\n]/u.test(headers)) {
    throw new Error("CF_PACKAGED_AGENT_OTEL_HEADERS is invalid");
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(serviceName)) {
    throw new Error("CF_PACKAGED_AGENT_OTEL_SERVICE_NAME is invalid");
  }

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("CF_PACKAGED_AGENT_OTEL_ENDPOINT must be a valid HTTP(S) URL");
  }
  if (
    !["http:", "https:"].includes(parsedEndpoint.protocol) ||
    parsedEndpoint.username ||
    parsedEndpoint.password
  ) {
    throw new Error("CF_PACKAGED_AGENT_OTEL_ENDPOINT must be a valid HTTP(S) URL");
  }
  if (
    resolveCfEnv(runtimeEnv.CF_ENV) === "production" &&
    parsedEndpoint.protocol !== "https:"
  ) {
    throw new Error("CF_PACKAGED_AGENT_OTEL_ENDPOINT must use HTTPS in production");
  }

  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: parsedEndpoint.toString(),
    OTEL_EXPORTER_OTLP_HEADERS: headers,
    OTEL_SERVICE_NAME: serviceName,
    CF_TELEMETRY_RUNTIME_DISTRIBUTION: "packaged",
  };
}

export function resolveDesktopTsupBundleSecurityOptions(
  runtimeEnv: Record<string, string | undefined> = process.env,
) {
  const isProduction = runtimeEnv.NODE_ENV === "production";
  const isE2ECoverageBuild = runtimeEnv.CF_E2E_COVERAGE === "1";
  return {
    keepNames: isProduction && !isE2ECoverageBuild,
    minify: isProduction && !isE2ECoverageBuild,
    sourcemap: isE2ECoverageBuild || !isProduction,
  };
}

type DesktopTsupEsbuildOptions = {
  chunkNames?: string;
  legalComments?: "none" | "inline" | "eof" | "linked" | "external";
};

export function applyDesktopTsupEsbuildSecurityOptions(options: DesktopTsupEsbuildOptions) {
  options.legalComments = "none";
}

const desktopTsupBundleSecurityOptions = resolveDesktopTsupBundleSecurityOptions();

function createSharedDefines() {
  return {
    __CF_VERSION__: JSON.stringify(buildMetadata.appVersion),
    __CF_MIN_COMPATIBLE_VERSION__: JSON.stringify(buildMetadata.minCompatibleVersion),
    __CF_COMMIT__: JSON.stringify(buildMetadata.buildCommitId),
    __CF_BUILD_TIME__: JSON.stringify(buildMetadata.buildTime),
    __CF_ENV__: JSON.stringify(cfEnv),
    __CF_PRODUCT_FLAVOR__: JSON.stringify(cfProductFlavor),
    ...buildTimeConfigDefines,
    __CF_CUA_HELPER_BUILD_ID__: JSON.stringify(
      process.env.CF_CUA_HELPER_BUILD_ID?.trim() ?? "",
    ),
    __CF_REMOTE_CDN_RELEASE_ROOTS__: JSON.stringify(resolveBuildRemoteCdnReleaseRoots(env)),
  };
}

function createMainDefines() {
  return {
    ...createSharedDefines(),
    __CF_PACKAGED_AGENT_TELEMETRY_ENV__: JSON.stringify(
      resolveBuildPackagedAgentTelemetryEnv(process.env),
    ),
  };
}

const desktopNodeRuntimeExternals = [
  "electron",
  "node-pty",
  "ssh2",
  "undici",
  "@larksuiteoapi/node-sdk",
  "yaml",
  "node-forge",
  "yauzl",
];

function createDevReadyMarkerHook(target: "main" | "host" | "preload"): string {
  return `node scripts/write-dev-ready-marker.mjs ${target}`;
}

export default defineConfig([
  {
    name: "main",
    entry: {
      "main/index": "src/main/index.ts",
      "main/browserWebmRecorder": "src/main/browserView/electronBrowserWebmRecorder.ts",
      "main/cfDataSizeWorker": "src/main/cfDataSizeWorker.ts",
      "main/storageScanWorker": "src/main/storageScanWorker.ts",
    },
    outDir: "out",
    format: "esm",
    platform: "node",
    removeNodeProtocol: false,
    target: "node22",
    external: desktopNodeRuntimeExternals,
    noExternal: [
      "@origin-ai/cf-server",
      "@origin-ai/cf-shared",
      "@origin-ai/cf-rpc",
      "@origin-ai/cf-services",
      "@origin-ai/cf-client",
      "@origin-ai/cf-provider",
      "@origin-ai/cf-provider-node",
      "@origin-ai/cf-cua",
    ],
    define: createMainDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
      options.chunkNames = "main/chunk-[hash]";
    },
    onSuccess: createDevReadyMarkerHook("main"),
    ...desktopTsupBundleSecurityOptions,
  },
  {
    name: "preload",
    entry: {
      "preload/embeddedBrowserJavaScriptDialog": "src/preload/embeddedBrowserJavaScriptDialog.ts",
      "preload/codingPlanWebview": "src/preload/codingPlanWebview.ts",
      "preload/rewardsWebview": "src/preload/rewardsWebview.ts",
      "preload/browserVideoRecorder": "src/preload/browserVideoRecorder.ts",
      "preload/index": "src/preload/index.ts",
      "preload/resourceManager": "src/preload/resourceManager.ts",
      "preload/cuaPermissionPanel": "src/preload/cuaPermissionPanel.ts",
      "preload/pluginSandbox": "src/preload/pluginSandbox/index.ts",
    },
    outDir: "out",
    format: "cjs",
    platform: "node",
    removeNodeProtocol: false,
    target: "node22",
    external: ["electron"],
    noExternal: ["@origin-ai/cf-shared"],
    outExtension: () => ({ js: ".cjs" }),
    define: createSharedDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
    },
    onSuccess: createDevReadyMarkerHook("preload"),
    ...desktopTsupBundleSecurityOptions,
  },
  {
    name: "plugin-sandbox-alias",
    loader: { ".css": "text" },
    entry: {
      "plugin-sandbox-alias": "src/renderer/src/plugin-sandbox/alias.ts",
      "gen-ui": "src/renderer/src/plugin-sandbox/genUi.ts",
    },
    outDir: "out/plugin-sandbox",
    onSuccess: () => copyGenUiRuntimeAssets(resolve("out/plugin-sandbox")),
    format: "iife",
    platform: "browser",
    target: "es2022",
    noExternal: [/.*/],
    outExtension: () => ({ js: ".js" }),
    define: createSharedDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
    },
    ...desktopTsupBundleSecurityOptions,
  },
  {
    name: "host",
    entry: {
      "host/index": "src/host/index.ts",
      "host/tasksStorageWorker": "src/host/database-startup/tasksStorageWorker.ts",
    },
    outDir: "out",
    format: "esm",
    platform: "node",
    removeNodeProtocol: false,
    target: "node22",
    external: desktopNodeRuntimeExternals,
    noExternal: [
      "@origin-ai/cf-server",
      "@origin-ai/cf-shared",
      "@origin-ai/cf-rpc",
      "@origin-ai/cf-services",
      "@origin-ai/cf-client",
      "@origin-ai/cf-provider",
      "@origin-ai/cf-provider-node",
      "@origin-ai/cf-cua",
    ],
    define: createSharedDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
      options.chunkNames = "host/chunk-[hash]";
    },
    onSuccess: createDevReadyMarkerHook("host"),
    ...desktopTsupBundleSecurityOptions,
  },
  {
    name: "scheduler",
    entry: { "scheduler/index": "src/scheduler/index.ts" },
    outDir: "out",
    format: "esm",
    platform: "node",
    removeNodeProtocol: false,
    target: "node22",
    external: desktopNodeRuntimeExternals,
    noExternal: [
      "@origin-ai/cf-server",
      "@origin-ai/cf-shared",
      "@origin-ai/cf-rpc",
      "@origin-ai/cf-services",
      "@origin-ai/cf-client",
      "@origin-ai/cf-provider",
      "@origin-ai/cf-provider-node",
      "@origin-ai/cf-cua",
    ],
    define: createSharedDefines(),
    esbuildOptions(options) {
      applyDesktopTsupEsbuildSecurityOptions(options);
      options.chunkNames = "scheduler/chunk-[hash]";
    },
    onSuccess: createDevReadyMarkerHook("scheduler"),
    ...desktopTsupBundleSecurityOptions,
  },
]);
