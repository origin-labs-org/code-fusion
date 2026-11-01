
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, win32 } from "node:path";
import type { ConnectOptions } from "@origin-ai/cf-server/remote";
import { listSSHConfigAliasesFromLocalConfig } from "@origin-ai/cf-services/node";
import { DEV_HELPER_APP_NAME, HELPER_APP_NAME } from "@origin-ai/cf-cua/broker/helperConstants";
import {
  CF_APP_VERSION_ENV,
  CF_BUILD_COMMIT_ID_ENV,
  CF_AGENT_RUNTIME,
  CF_COMMIT,
  CF_DYNAMIC_WORKFLOW_MODE_ENV,
  CF_ENV,
  CF_PRODUCT_FLAVOR,
  CF_RUNTIME_ENV_KEY,
  CF_VERSION,
  buildCfToolEnvPassthroughEnv,
  resolveRuntimeCfEndpointOrigin,
  resolveZaiBusinessBaseUrl,
  resolveZaiOAuthClientId,
  resolveZaiOAuthOrigin,
  normalizeDynamicWorkflowMode,
  readCfAgentTelemetryEnv,
  sanitizeCfRuntimeEnv,
  type SourceServerArtifactPolicy,
  type CfRuntimeEnv,
} from "@origin-ai/cf-shared";
import { resolvePlatformKeyForPackagedApp } from "../../scripts/target-platform.mjs";
import {
  getAppConfigDir,
  getDataBaseDir,
  CF_CUA_BUNDLED_HELPER_APP_PATH_ENV,
  CF_WINDOWS_APP_INSTALL_DIR_ENV,
} from "@origin-ai/cf-services/node";
import {
  resolveRemoteCdnBaseUrls as resolveOrderedRemoteCdnBaseUrls,
  type ResolveRemoteCdnOptions,
} from "./remoteCdn.js";
import { getElectronAppPath, isElectronAppPackaged } from "./desktopElectronApp.js";

declare const __CF_PACKAGED_AGENT_TELEMETRY_ENV__: Readonly<Record<string, string>> | undefined;

const isLocalDevelopmentRuntime = !isElectronAppPackaged();
export const desktopRuntimeEnv: CfRuntimeEnv = isLocalDevelopmentRuntime
  ? "development"
  : "production";
export const isPreviewPackagedRuntime =
  !isLocalDevelopmentRuntime && CF_PRODUCT_FLAVOR === "preview";

function readRuntimeEnvOverride(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function isTruthyRuntimeEnvOverride(name: string): boolean {
  const value = readRuntimeEnvOverride(name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export const runtimeApplicationName =
  readRuntimeEnvOverride("CF_DESKTOP_APPLICATION_NAME") ??
  (isLocalDevelopmentRuntime ? "CodeFusion Dev" : isPreviewPackagedRuntime ? "CodeFusion Preview" : "CodeFusion");
export const runtimeHomePath = readRuntimeEnvOverride("CF_DESKTOP_HOME_DIR");
export const shouldUseElectronDefaultUserDataPath = isTruthyRuntimeEnvOverride(
  "CF_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA",
);
export const runtimeUserDataPath =
  readRuntimeEnvOverride("CF_DESKTOP_USER_DATA_DIR") ??
  (shouldUseElectronDefaultUserDataPath
    ? undefined
    : join(getElectronAppPath("appData"), runtimeApplicationName));
export const runtimeSessionDataPath =
  readRuntimeEnvOverride("CF_DESKTOP_SESSION_DATA_DIR") ??
  (runtimeUserDataPath ? join(runtimeUserDataPath, "session") : undefined);
export const hostModulePath = join(import.meta.dirname, "../host/index.js");
export const schedulerModulePath = join(import.meta.dirname, "../scheduler/index.js");
export function getCredentialsDir() {
  return getAppConfigDir();
}

export type RemoteAssetDirs = Pick<
  ConnectOptions,
  "mockCdnDir" | "remoteCdnBaseUrl" | "remoteCdnBaseUrls" | "remoteCacheDir"
> & {
  sourceServerArtifactPolicy?: SourceServerArtifactPolicy;
};
type LocalRuntimeEnv = Record<string, string | undefined>;

export async function isDockerDaemonAvailable(): Promise<boolean> {
  const { isDockerAvailable } = await import("@origin-ai/cf-server/remote");
  return isDockerAvailable();
}

export async function listAvailableWSLDistros() {
  const { listWSLDistros } = await import("@origin-ai/cf-server/remote");
  return listWSLDistros();
}

export async function listAvailableDockerContainers() {
  const { listDockerContainers } = await import("@origin-ai/cf-server/remote");
  return listDockerContainers();
}

export async function listSSHConfigAliases() {
  return await listSSHConfigAliasesFromLocalConfig();
}

function parseDotenv(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = normalized.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function resolveWorkspaceRootForEnvFiles(): string | null {
  const workspaceRootCandidate = resolve(import.meta.dirname, "../../../..");
  return existsSync(join(workspaceRootCandidate, "pnpm-workspace.yaml"))
    ? workspaceRootCandidate
    : null;
}

export function loadHostProcessEnvFromLocalFiles(): Record<string, string> {
  if (isElectronAppPackaged()) {
    return resolvePackagedAgentTelemetryEnv();
  }

  const desktopRoot = resolve(import.meta.dirname, "../..");
  const workspaceRoot = resolveWorkspaceRootForEnvFiles();
  const fileCandidates = [
    ...(workspaceRoot
      ? [resolve(workspaceRoot, ".env"), resolve(workspaceRoot, ".env.local")]
      : []),
    ...(workspaceRoot && isLocalDevelopmentRuntime
      ? [
          resolve(workspaceRoot, ".env.development"),
          resolve(workspaceRoot, ".env.development.local"),
        ]
      : []),
    resolve(desktopRoot, ".env"),
    resolve(desktopRoot, ".env.local"),
    ...(isLocalDevelopmentRuntime
      ? [resolve(desktopRoot, ".env.development"), resolve(desktopRoot, ".env.development.local")]
      : []),
  ];

  const merged: Record<string, string> = {};
  const seen = new Set<string>();

  for (const candidate of fileCandidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = parseDotenv(readFileSync(candidate, "utf-8"));
    Object.assign(merged, parsed);
  }

  return applySelectedCfEnvLinks(merged);
}

export function resolvePackagedAgentTelemetryEnv(
  compiledEnv:
    | Readonly<Record<string, string>>
    | undefined = typeof __CF_PACKAGED_AGENT_TELEMETRY_ENV__ === "undefined"
    ? undefined
    : __CF_PACKAGED_AGENT_TELEMETRY_ENV__,
): Record<string, string> {
  if (!compiledEnv) {
    return {};
  }

  return readCfAgentTelemetryEnv({
    OTEL_EXPORTER_OTLP_ENDPOINT: compiledEnv.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_HEADERS: compiledEnv.OTEL_EXPORTER_OTLP_HEADERS,
    OTEL_SERVICE_NAME: compiledEnv.OTEL_SERVICE_NAME,
    CF_TELEMETRY_RUNTIME_DISTRIBUTION: compiledEnv.CF_TELEMETRY_RUNTIME_DISTRIBUTION,
  });
}

function resolveDevelopmentMockCdnDir(): string {
  return join(import.meta.dirname, "../../mock-cdn");
}

function resolveAvailableDevelopmentMockCdnDir(): string | undefined {
  const mockCdnDir = resolveDevelopmentMockCdnDir();
  const releaseDir = join(mockCdnDir, "releases", CF_VERSION);
  return existsSync(releaseDir) ? mockCdnDir : undefined;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function shouldUseRemoteCdnInDevelopment(localEnv: LocalRuntimeEnv = {}): boolean {
  return isTruthyEnvFlag(resolveEnvValue("CF_DEV_REMOTE_ASSET_USE_CDN", localEnv));
}

function resolveRemoteCdnBaseUrls(
  options: ResolveRemoteCdnOptions = {},
  localEnv: LocalRuntimeEnv = {},
): string[] {
  const raw = resolveEnvValue("CF_REMOTE_ASSET_CDN_BASE_URL", localEnv);
  return resolveOrderedRemoteCdnBaseUrls({
    ...options,
    env: CF_ENV,
    overrideBaseUrl: raw,
    version: CF_VERSION,
  });
}

function resolveEnvValue(envName: string, localEnv: LocalRuntimeEnv = {}): string | undefined {
  return process.env[envName]?.trim() || localEnv[envName]?.trim() || undefined;
}

export function resolveCfEndpointEnvBaseOrigin(
  localEnv: LocalRuntimeEnv = {},
): string | undefined {
  const scopedEnvName =
    CF_ENV === "production" ? "CF_PRODUCTION_BASE_URL" : "CF_TEST_BASE_URL";
  return (
    process.env["CF_BASE_URL"]?.trim() ||
    process.env["CF_ENDPOINT_ORIGIN"]?.trim() ||
    process.env[scopedEnvName]?.trim() ||
    localEnv.CF_BASE_URL?.trim() ||
    localEnv.CF_ENDPOINT_ORIGIN?.trim() ||
    localEnv[scopedEnvName]?.trim() ||
    undefined
  );
}

function readDefinedProcessEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }
  return values;
}

function applySelectedCfEnvLinks(env: Record<string, string>): Record<string, string> {
  const endpointEnv = {
    ...env,
    CF_ENV,
  };

  return {
    ...env,
    CF_BASE_URL: env.CF_BASE_URL ?? resolveRuntimeCfEndpointOrigin(endpointEnv),
    ZAI_OAUTH_ORIGIN: env.ZAI_OAUTH_ORIGIN ?? resolveZaiOAuthOrigin(endpointEnv),
    ZAI_BUSINESS_BASE_URL: env.ZAI_BUSINESS_BASE_URL ?? resolveZaiBusinessBaseUrl(endpointEnv),
    ZAI_OAUTH_CLIENT_ID: env.ZAI_OAUTH_CLIENT_ID ?? resolveZaiOAuthClientId(endpointEnv),
  };
}

function resolveHostProcessNodeEnv(): CfRuntimeEnv {
  return desktopRuntimeEnv;
}

function resolveRemoteAssetCacheDir(localEnv: LocalRuntimeEnv = {}): string {
  const overrideCacheDir = resolveEnvValue("CF_REMOTE_ASSET_CACHE_DIR", localEnv);
  if (overrideCacheDir) {
    return resolve(overrideCacheDir);
  }

  return join(getElectronAppPath("userData"), "remote-assets-cache");
}

export function resolveRemoteAssetDirs(
  options: ResolveRemoteCdnOptions = {},
  localEnv: LocalRuntimeEnv = {},
): RemoteAssetDirs {
  const remoteCdnBaseUrls = resolveRemoteCdnBaseUrls(options, localEnv);
  const remoteCdnBaseUrl = remoteCdnBaseUrls[0];

  if (isElectronAppPackaged() || shouldUseRemoteCdnInDevelopment(localEnv)) {
    return {
      remoteCdnBaseUrl,
      remoteCdnBaseUrls,
      remoteCacheDir: resolveRemoteAssetCacheDir(localEnv),
    };
  }

  const developmentMockCdnDir = resolveAvailableDevelopmentMockCdnDir();
  return {
    ...(developmentMockCdnDir ? { mockCdnDir: developmentMockCdnDir } : {}),
    sourceServerArtifactPolicy: "development-content-addressed",
    remoteCdnBaseUrl,
    remoteCdnBaseUrls,
    remoteCacheDir: resolveRemoteAssetCacheDir(localEnv),
  };
}

function resolveBundledCfAgentBinaryPath(): string | undefined {
  const runtime = CF_AGENT_RUNTIME;
  const entrySegments = runtime.resolveEntrySegments(process.platform);
  const platformKey = resolvePlatformKeyForPackagedApp();
  const candidates = [
    isElectronAppPackaged()
      ? join(process.resourcesPath, runtime.bundledResourceDir, ...entrySegments)
      : null,
    join(
      process.cwd(),
      "bundled-agents",
      platformKey,
      runtime.bundledResourceDir,
      ...entrySegments,
    ),
    join(
      process.cwd(),
      "packages",
      "desktop",
      "bundled-agents",
      platformKey,
      runtime.bundledResourceDir,
      ...entrySegments,
    ),
    join(
      import.meta.dirname,
      "../../bundled-agents",
      platformKey,
      runtime.bundledResourceDir,
      ...entrySegments,
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate));
}

function resolveBundledRuntimeToolBinaryPath(
  toolDir: string,
  binaryName: string,
): string | undefined {
  const candidateBinaryName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
  const candidates = [
    isElectronAppPackaged()
      ? join(process.resourcesPath, "tools", toolDir, candidateBinaryName)
      : null,
    join(
      import.meta.dirname,
      "../../bundled-tools",
      resolvePlatformKeyForPackagedApp(),
      toolDir,
      candidateBinaryName,
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(candidate));
}

function resolveBundledLarkCliBinaryPath(): string | undefined {
  return resolveBundledRuntimeToolBinaryPath("lark-cli", "lark-cli");
}

export function resolveBundledGlmBinaryPath(): string | undefined {
  return resolveBundledCfAgentBinaryPath();
}

function resolveHostProcessBinaryEnv(
  envVar: string,
  hostProcessLocalEnv: Record<string, string>,
  bundledPath: string | undefined,
): string | undefined {
  if (bundledPath) {
    return bundledPath;
  }
  const explicitPath = process.env[envVar]?.trim() || hostProcessLocalEnv[envVar]?.trim();
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }
  return undefined;
}

export function resolveWindowsAppInstallDirForDataBaseDirGuard(
  options: {
    platform?: NodeJS.Platform | string;
    isPackaged?: boolean;
    resourcesPath?: string;
  } = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  const packaged = options.isPackaged ?? isElectronAppPackaged();
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  if (platform !== "win32" || !packaged) {
    return undefined;
  }

  const trimmedResourcesPath = resourcesPath?.trim();
  if (!trimmedResourcesPath) {
    return undefined;
  }

  return win32.dirname(trimmedResourcesPath);
}

export function resolveDynamicWorkflowModeHostEnv(options: {
  inheritedValue: string | undefined;
  isPackaged: boolean;
  isPreview: boolean;
}): Record<string, string> {
  if (!options.isPackaged) {
    const mode = normalizeDynamicWorkflowMode(options.inheritedValue);
    return mode ? { [CF_DYNAMIC_WORKFLOW_MODE_ENV]: mode } : {};
  }
  if (options.isPreview) {
    return { [CF_DYNAMIC_WORKFLOW_MODE_ENV]: "alwaysOn" };
  }
  return {};
}

export function buildHostProcessEnv(hostProcessLocalEnv: Record<string, string>) {
  const glmBinaryPath = resolveBundledGlmBinaryPath();
  const larkCliBinaryPath = resolveBundledLarkCliBinaryPath();
  const resolvedGlmBinaryPath = resolveHostProcessBinaryEnv(
    "GLM_BINARY_PATH",
    hostProcessLocalEnv,
    glmBinaryPath,
  );
  const resolvedLarkCliBinaryPath = resolveHostProcessBinaryEnv(
    "CF_LARK_CLI_BINARY",
    hostProcessLocalEnv,
    larkCliBinaryPath,
  );
  const dataBaseDir = getDataBaseDir();
  const rawInheritedEnv = {
    ...hostProcessLocalEnv,
    ...readDefinedProcessEnv(),
  };
  const packagedDesktop = isElectronAppPackaged();
  const bundledCuaHelperAppPath =
    process.platform !== "darwin"
      ? undefined
      : packagedDesktop
        ? join(process.resourcesPath, "cua-helper", HELPER_APP_NAME)
        : // Truthy grammar must match the producer's isUnsignedHelperLocalDevRequested
          // (1|true|on, case-insensitive). Accepting only the literal "1" silently
          // ignored `true`/`on` set by scripts following the documented dev flow.
          ["1", "true", "on"].includes(
              rawInheritedEnv.CF_CUA_HELPER_ALLOW_UNSIGNED_LOCAL?.trim().toLowerCase() ?? "",
            )
          ? rawInheritedEnv.CF_CUA_BUNDLED_HELPER_APP_PATH?.trim() ||
            join(
              rawInheritedEnv.CF_HOME?.trim() || join(homedir(), ".cf"),
              "computer-use",
              "dev",
              DEV_HELPER_APP_NAME,
            )
          : undefined;
  const windowsAppInstallDir = resolveWindowsAppInstallDirForDataBaseDirGuard();
  const agentTelemetryEnv = readCfAgentTelemetryEnv(rawInheritedEnv);
  for (const key of [
    "CF_TELEMETRY_USER_ID",
    "CF_TELEMETRY_USER_ID_HASH",
    "CF_TELEMETRY_USER_SUBJECT_ID",
    "CF_TELEMETRY_IDENTITY_STATE",
    "CF_TELEMETRY_DEVICE_MID",
    "CF_TELEMETRY_RUNTIME_SURFACE",
  ]) {
    delete agentTelemetryEnv[key];
  }
  const inheritedEnv = applySelectedCfEnvLinks({
    ...sanitizeCfRuntimeEnv(rawInheritedEnv),
    ...buildCfToolEnvPassthroughEnv(rawInheritedEnv),
  });
  // A release app must never inherit the local unsigned-Helper escape hatch.
  // Otherwise a developer shell/launchctl variable can make the signed app
  // reject its verified bundled Helper and route onboarding to a stale dev app.
  if (packagedDesktop) {
    delete inheritedEnv.CF_CUA_HELPER_ALLOW_UNSIGNED_LOCAL;
  }
  const dynamicWorkflowModeHostEnv = resolveDynamicWorkflowModeHostEnv({
    inheritedValue: rawInheritedEnv[CF_DYNAMIC_WORKFLOW_MODE_ENV],
    isPackaged: packagedDesktop,
    isPreview: isPreviewPackagedRuntime,
  });
  delete inheritedEnv[CF_DYNAMIC_WORKFLOW_MODE_ENV];

  return {
    ...inheritedEnv,
    ...agentTelemetryEnv,
    [CF_RUNTIME_ENV_KEY]: resolveHostProcessNodeEnv(),
    CF_ENV,
    ...(isPreviewPackagedRuntime ? { CF_CUA_HELPER_INSTALL_VARIANT: "preview" } : {}),
    ...dynamicWorkflowModeHostEnv,
    [CF_APP_VERSION_ENV]: CF_VERSION,
    [CF_BUILD_COMMIT_ID_ENV]: CF_COMMIT,
    ...(dataBaseDir !== homedir() ? { CF_DATA_BASE_DIR: dataBaseDir } : {}),
    ...(windowsAppInstallDir ? { [CF_WINDOWS_APP_INSTALL_DIR_ENV]: windowsAppInstallDir } : {}),
    ...(bundledCuaHelperAppPath
      ? { [CF_CUA_BUNDLED_HELPER_APP_PATH_ENV]: bundledCuaHelperAppPath }
      : {}),
    ...(resolvedGlmBinaryPath ? { GLM_BINARY_PATH: resolvedGlmBinaryPath } : {}),
    ...(resolvedLarkCliBinaryPath ? { CF_LARK_CLI_BINARY: resolvedLarkCliBinaryPath } : {}),
  };
}
