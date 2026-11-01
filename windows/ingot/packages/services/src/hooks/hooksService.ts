import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type {
  Hook,
  HookEvent,
  SettingsDirectoryLocation,
  SettingsDirectorySource,
} from "@origin-ai/cf-shared";
import {
  buildWorkspaceHookBundleSnapshot,
  createWorkspaceHookSourceInput,
  readWorkspaceHookProjectSources,
  resolveWorkspaceHookRuntimeRoot,
  workspaceHooksConfigSchema,
  type WorkspaceHookBundleSnapshotData,
  type WorkspaceHookSourceInput,
  type WorkspaceHooksConfig,
} from "@origin-ai/cf-shared/workspace-hook-discovery";
import { parseWorkspaceHookTrustStoreContent } from "@origin-ai/cf-shared/workspace-hook-trust-store-file";
import { createServiceLogger, type ServiceLogger } from "#src/logger/serviceLogger.js";
import type { IHooksService } from "./hooks.js";
import { atomicWriteWorkspaceHookConfig } from "./workspaceHookConfigMutation.js";
import {
  fromLegacyHooksConfig,
  fromProjectSnapshot,
  fromUserCfSource,
  resolveNextRootEnabled,
  toCfHooksEvents,
  type LegacyHooksConfig,
} from "./workspaceHookSettingsModel.js";

const SETTINGS_FILE = "settings.json";
const CF_CONFIG_FILE = "config.json";
const HOOK_EVENTS: readonly HookEvent[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Stop",
];

interface CfConfigFile {
  hooks?: WorkspaceHooksConfig;
  [key: string]: unknown;
}

function resolveUserHomeDir(): string {
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

function getRootDir(source: SettingsDirectorySource, workspacePath?: string): string {
  const baseDir = workspacePath ?? resolveUserHomeDir();
  if (source === "cf") {
    return workspacePath ? join(baseDir, ".cf") : join(baseDir, ".cf", "cli");
  }
  return join(baseDir, source === "agents" ? ".agents" : ".claude");
}

function getConfigPath(source: SettingsDirectorySource, workspacePath?: string): string {
  return join(
    getRootDir(source, workspacePath),
    source === "cf" ? CF_CONFIG_FILE : SETTINGS_FILE,
  );
}

function buildLocation(
  source: SettingsDirectorySource,
  workspacePath?: string,
): SettingsDirectoryLocation {
  return {
    source,
    scope: workspacePath ? "project" : "user",
    directoryPath: getRootDir(source, workspacePath),
    ...(workspacePath ? { projectPath: workspacePath } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHookEvent(value: string): value is HookEvent {
  return (HOOK_EVENTS as readonly string[]).includes(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    if (!existsSync(filePath)) return null;
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}

async function readUserCfSource(): Promise<WorkspaceHookSourceInput | undefined> {
  const path = getConfigPath("cf");
  const config = await readJsonFile<Record<string, unknown>>(path);
  const parsed = workspaceHooksConfigSchema.safeParse(config?.hooks);
  if (!parsed.success) return undefined;
  return {
    ...createWorkspaceHookSourceInput({
      path,
      workingDirectory: resolveUserHomeDir(),
      hooks: parsed.data,
      discoveryOrder: 0,
      explicitProjectConfig: true,
    }),
    editable: true,
  };
}

async function loadLegacyHooksFromLocation(
  source: "agents" | "claude",
  workspacePath?: string,
): Promise<Hook[]> {
  return fromLegacyHooksConfig({
    legacyConfig: await readJsonFile<LegacyHooksConfig>(getConfigPath(source, workspacePath)),
    location: buildLocation(source, workspacePath),
    isHookEvent,
  });
}

async function readPersistentWorkspaceHookTrustDigests(
  workspaceIdentity: string,
  logger: ServiceLogger,
): Promise<{ digests: Set<string>; corrupt: boolean }> {
  const userConfig = (await readJsonFile<Record<string, unknown>>(getConfigPath("cf"))) ?? {};
  const storage = isRecord(userConfig.storage) ? userConfig.storage : {};
  const configured = typeof storage.dir === "string" ? storage.dir.trim() : "";
  const home = resolveUserHomeDir();
  const storageRoot = configured
    ? configured.startsWith("~/")
      ? join(home, configured.slice(2))
      : isAbsolute(configured)
        ? resolve(configured)
        : resolve(home, configured)
    : join(home, ".cf");
  const trustFilePath = join(storageRoot, "security", "workspace-hook-trust-v1.json");

  let content: string;
  try {
    content = await readFile(trustFilePath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { digests: new Set<string>(), corrupt: false };
    }
    logger.warn(
      undefined,
      "Workspace Hook Trust store 不可读，已 fail-closed 忽略全部持久信任记录",
      {
        path: trustFilePath,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return { digests: new Set<string>(), corrupt: true };
  }

  const parsedStore = parseWorkspaceHookTrustStoreContent(content);
  if (parsedStore.status === "invalid") {
    logger.warn(
      undefined,
      "Workspace Hook Trust store 结构不符合 schema，已 fail-closed 忽略全部持久信任记录",
      { path: trustFilePath },
    );
    return { digests: new Set<string>(), corrupt: true };
  }

  const digests = new Set<string>(
    parsedStore.file.records
      .filter((record) => record.workspaceIdentity === workspaceIdentity)
      .map((record) => record.hookDeclarationDigest),
  );
  return { digests, corrupt: false };
}

async function loadHooksImpl(
  params: {
    workspaceIdentity?: string;
    workspacePath: string;
    scope?: "all" | "user";
  },
  logger: ServiceLogger,
): Promise<{
  hooks: Hook[];
  hooksEnabled: boolean;
  workspaceHookSnapshot?: WorkspaceHookBundleSnapshotData;
}> {
  const workspacePath = resolve(params.workspacePath);
  if (params.scope === "user") {
    const userSource = await readUserCfSource();
    const runtimeRoot = resolveWorkspaceHookRuntimeRoot([userSource?.hooks]);
    const hooks = [
      ...fromUserCfSource({
        source: userSource,
        runtimeRoot,
        workspacePath,
        location: buildLocation("cf"),
      }),
      ...(await loadLegacyHooksFromLocation("agents")),
      ...(await loadLegacyHooksFromLocation("claude")),
    ];
    return { hooks, hooksEnabled: hooks.some((hook) => hook.enabled) };
  }
  const workspaceIdentity = params.workspaceIdentity?.trim() || workspacePath;
  const [{ sources: projectSources }, userSource] = await Promise.all([
    readWorkspaceHookProjectSources({ workingDirectory: workspacePath }),
    readUserCfSource(),
  ]);
  const runtimeRoot = resolveWorkspaceHookRuntimeRoot([
    userSource?.hooks,
    ...projectSources.map((source) => source.hooks),
  ]);
  const workspaceHookSnapshot = buildWorkspaceHookBundleSnapshot({
    workspaceIdentity,
    workspacePath,
    sources: projectSources,
    runtimeRoot,
  });
  const persistentTrust = await readPersistentWorkspaceHookTrustDigests(workspaceIdentity, logger);
  const persistentTrustedDigests = persistentTrust.digests;
  const hooks = [
    ...fromProjectSnapshot({
      sources: projectSources,
      snapshot: workspaceHookSnapshot,
      workspaceIdentity,
      workspacePath,
      persistentTrustedDigests,
    }),
    ...(await loadLegacyHooksFromLocation("agents", workspacePath)),
    ...(await loadLegacyHooksFromLocation("claude", workspacePath)),
    ...fromUserCfSource({
      source: userSource,
      runtimeRoot,
      workspacePath,
      location: buildLocation("cf"),
    }),
    ...(await loadLegacyHooksFromLocation("agents")),
    ...(await loadLegacyHooksFromLocation("claude")),
  ];
  return {
    hooks,
    hooksEnabled: hooks.some((hook) => hook.enabled),
    ...(workspaceHookSnapshot ? { workspaceHookSnapshot } : {}),
    ...(persistentTrust.corrupt ? { trustStoreCorrupt: true } : {}),
  };
}

async function writeCfHooksConfig(
  workspacePath: string | undefined,
  hooks: Hook[],
): Promise<void> {
  const configPath = getConfigPath("cf", workspacePath);
  const existingConfig = (await readJsonFile<CfConfigFile>(configPath)) ?? {};
  const enabled = resolveNextRootEnabled(existingConfig.hooks?.enabled, hooks);
  await atomicWriteWorkspaceHookConfig(configPath, {
    ...existingConfig,
    hooks: {
      ...existingConfig.hooks,
      ...(enabled !== undefined ? { enabled } : {}),
      events: toCfHooksEvents(hooks),
    },
  });
}

async function saveHooksImpl(params: {
  workspaceIdentity?: string;
  workspacePath: string;
  scope?: "all" | "user";
  hooks: Hook[];
}): Promise<void> {
  const currentProjectConfigPath = resolve(params.workspacePath, ".cf", "config.json");
  const userHooks = params.hooks.filter(
    (hook) =>
      hook.editable !== false &&
      (!hook.location || (hook.location.source === "cf" && hook.location.scope === "user")),
  );
  const projectHooks = params.hooks.filter(
    (hook) =>
      hook.editable !== false &&
      hook.location?.source === "cf" &&
      hook.location.scope === "project" &&
      (!hook.configuredState ||
        resolve(hook.configuredState.sourcePath) === currentProjectConfigPath),
  );
  await writeCfHooksConfig(undefined, userHooks);
  if (params.scope !== "user") {
    await writeCfHooksConfig(params.workspacePath, projectHooks);
  }
}

export function createHooksService(
  options: {
    logger?: ServiceLogger;
    grantWorkspaceHookTrust?: NonNullable<IHooksService["grantWorkspaceHookTrust"]>;
  } = {},
): IHooksService {
  const logger = options.logger ?? createServiceLogger("hooks-service");
  return {
    loadHooks: (params) => loadHooksImpl(params, logger),
    saveHooks: saveHooksImpl,
    ...(options.grantWorkspaceHookTrust
      ? { grantWorkspaceHookTrust: options.grantWorkspaceHookTrust }
      : {}),
  };
}
