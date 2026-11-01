import { readFile, mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type {
  AppSettings,
  ProviderFamilyDomain,
  ProviderFamilyConnectionSelectionSettings,
} from "@origin-ai/cf-shared";
import {
  appSettingsPatchSchema,
  appSettingsSchema,
  formatLogPrefix,
  formatZodError,
} from "@origin-ai/cf-shared";
import type { ISettingService, WorkspaceSettingsProjection } from "./setting.js";
import { normalizeSettingsPatch } from "#src/setting/normalizeSettingsPatch.js";
import { copyDataDirectory, getDataBaseDir, validateDataBaseDirTarget } from "../paths.js";
import { isEffectiveDevelopmentNodeEnv } from "../runtime-tools/nodeEnv.js";
import { maybeThrowInjectedFsFault } from "../fs/fsFaultInjection.js";
import { atomicWriteText, withAtomicFileLock } from "../fs/atomicFileUtils.js";
import { withSettingsWriteQueueTimeout } from "./settingsWriteQueue.js";
import {
  migrateLegacyAccountConnectionSettings,
  needsLegacyAccountConnectionMigration,
  readLegacyAccountConnectionSettingsFile,
  readIncompleteLegacyTeamConnections,
  retainLegacyAccountConnectionFields,
  type LegacyTeamConnection,
} from "#src/setting/legacyAccountConnectionSettings.js";
const MAX_RECENT_PROJECTS = 10;
const SETTINGS_PARSE_RETRY_DELAY_MS = 300;
const SETTINGS_PARSE_RETRY_COUNT = 3;

const log = (...args: unknown[]) =>
  console.log(formatLogPrefix("settingService", process.pid), ...args);
const debugLog = (...args: unknown[]) => {
  if (!isEffectiveDevelopmentNodeEnv()) {
    return;
  }
  console.debug(formatLogPrefix("settingService", process.pid), ...args);
};

function resolveUserHomeDir() {
  const envHome =
    process.env.CF_DESKTOP_HOME_DIR?.trim() ||
    process.env.HOME?.trim() ||
    process.env.USERPROFILE?.trim();
  return envHome && envHome.length > 0 ? envHome : homedir();
}

function defaultSettings(): AppSettings {
  return appSettingsSchema.parse({});
}

function buildCorruptSettingsBackupPath(settingsFile: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${settingsFile}.corrupt-${timestamp}`;
}

async function quarantineCorruptSettingsFile(settingsFile: string, error: unknown): Promise<void> {
  const backupPath = buildCorruptSettingsBackupPath(settingsFile);
  try {
    maybeThrowInjectedFsFault({ operation: "rename", path: settingsFile });
    await rename(settingsFile, backupPath);
    log("invalid settings json backed up:", backupPath, "error:", error);
  } catch (renameError) {
    if (
      renameError &&
      typeof renameError === "object" &&
      "code" in renameError &&
      (renameError as { code?: string }).code === "ENOENT"
    ) {
      log("invalid settings json already quarantined by another reader, returning defaults");
      return;
    }
    log("invalid settings json backup failed, returning defaults. error:", renameError);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldPersistSettingsMigrations(rawValue: unknown): boolean {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return false;
  const raw = rawValue as Record<string, unknown>;
  return (
    raw.remoteBoundaryOnboardingVersion === 3 ||
    (needsLegacyAccountConnectionMigration(rawValue) &&
      readIncompleteLegacyTeamConnections(rawValue).length === 0) ||
    raw.closeToTrayOnWindowsMigrationInitialized !== true ||
    raw.messageStreamShowReasoningMigrationInitialized !== true ||
    raw.taskAutoArchiveResetVersion !== 1
  );
}

interface ReadSettingsResult {
  settings: AppSettings;
  needsMigrationPersist: boolean;
}

async function readSettingsWithMetaAt(settingsFile: string): Promise<ReadSettingsResult> {
  try {
    debugLog("reading settings from:", settingsFile);
    const raw = await readFile(settingsFile, "utf-8");
    let rawValue: unknown;
    try {
      rawValue = JSON.parse(raw);
    } catch (parseError) {
      let lastParseError: unknown = parseError;
      for (let retryAttempt = 1; retryAttempt <= SETTINGS_PARSE_RETRY_COUNT; retryAttempt += 1) {
        await delay(SETTINGS_PARSE_RETRY_DELAY_MS);
        try {
          rawValue = JSON.parse(await readFile(settingsFile, "utf-8"));
          break;
        } catch (retryParseError) {
          lastParseError = retryParseError;
        }
      }
      if (rawValue === undefined) {
        await quarantineCorruptSettingsFile(settingsFile, lastParseError);
        return {
          settings: defaultSettings(),
          needsMigrationPersist: false,
        };
      }
    }
    const result = appSettingsSchema.safeParse(migrateLegacyAccountConnectionSettings(rawValue));
    if (!result.success) {
      log(
        "read failed schema validation, returning defaults. error:",
        formatZodError(result.error),
      );
      return {
        settings: defaultSettings(),
        needsMigrationPersist: false,
      };
    }
    return {
      settings: result.data,
      needsMigrationPersist: shouldPersistSettingsMigrations(rawValue),
    };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      debugLog("settings file missing, using defaults");
      return {
        settings: defaultSettings(),
        needsMigrationPersist: false,
      };
    }

    log("read failed, returning defaults. error:", err);
    return {
      settings: defaultSettings(),
      needsMigrationPersist: false,
    };
  }
}

async function writeSettingsAt(
  settingsFile: string,
  settings: AppSettings,
  shouldCommit: () => boolean = () => true,
  enterCommitPhase: () => void = () => undefined,
  commitAccountSelection = false,
): Promise<void> {
  const settingsDir = dirname(settingsFile);
  log("writing settings to:", settingsFile, JSON.stringify(settings));
  maybeThrowInjectedFsFault({ operation: "mkdir", path: settingsDir });
  await mkdir(settingsDir, { recursive: true });
  if (!shouldCommit()) return;
  maybeThrowInjectedFsFault({ operation: "writeFile", path: settingsFile });
  const raw = await readLegacyAccountConnectionSettingsFile(settingsFile);
  const rollbackFields = retainLegacyAccountConnectionFields(raw);
  const persisted = { ...rollbackFields, ...settings };
  if (!commitAccountSelection && readIncompleteLegacyTeamConnections(raw).length > 0) {
    delete persisted.providerFamilyConnectionSelections;
  }
  await atomicWriteText(settingsFile, JSON.stringify(persisted, null, 2), {
    useFileLock: false,
    beforeRename: () => {
      if (!shouldCommit()) {
        throw new Error("stale settings write skipped before atomic rename");
      }
      enterCommitPhase();
    },
  });
  log("write done");
}

export function createSettingService(): ISettingService {
  return createSettingServiceWithMigrations().service;
}

export function createSettingServiceWithMigrations(): {
  service: ISettingService;
  setWorkspaceProjection: (
    reader: (settings: AppSettings) => Promise<WorkspaceSettingsProjection>,
  ) => void;
  prepareLegacyAccountConnections: (
    resolveOrganization: (connection: LegacyTeamConnection) => Promise<string | null>,
  ) => Promise<readonly ProviderFamilyDomain[]>;
} {
  const settingsFile = join(resolveUserHomeDir(), ".cf", "v2", "setting.json");
  const getSettingsFile = () => settingsFile;
  const getSettingsDir = () => dirname(settingsFile);
  const readSettingsWithMeta = () => readSettingsWithMetaAt(settingsFile);
  const readSettings = async () => (await readSettingsWithMeta()).settings;
  const writeSettings = (
    settings: AppSettings,
    shouldCommit?: () => boolean,
    enterCommitPhase?: () => void,
    commitAccountSelection?: boolean,
  ) =>
    writeSettingsAt(settingsFile, settings, shouldCommit, enterCommitPhase, commitAccountSelection);
  let updateQueue = Promise.resolve();
  let writeQueueGeneration = 0;
  let workspaceProjection:
    | ((settings: AppSettings) => Promise<WorkspaceSettingsProjection>)
    | undefined;
  const projectSettings = async (settings: AppSettings): Promise<AppSettings> =>
    workspaceProjection
      ? appSettingsSchema.parse({ ...settings, ...(await workspaceProjection(settings)) })
      : settings;

  const enqueueSettingsWrite = async (
    runUpdate: (shouldCommit: () => boolean, enterCommitPhase: () => void) => Promise<void>,
  ) => {
    const runCurrentUpdate = async () => {
      const currentGeneration = ++writeQueueGeneration;
      const shouldCommit = () => currentGeneration === writeQueueGeneration;
      await mkdir(getSettingsDir(), { recursive: true });
      return withAtomicFileLock(getSettingsFile(), () =>
        withSettingsWriteQueueTimeout(
          (enterCommitPhase) => runUpdate(shouldCommit, enterCommitPhase),
          () => {
            if (writeQueueGeneration === currentGeneration) {
              writeQueueGeneration += 1;
            }
          },
        ),
      );
    };
    const queued = updateQueue.then(
      () => runCurrentUpdate(),
      () => runCurrentUpdate(),
    );
    updateQueue = queued.catch(() => {});
    await queued;
  };

  const service: ISettingService = {
    async get(): Promise<AppSettings> {
      await updateQueue;
      const result = await readSettingsWithMeta();
      const projected = await projectSettings(result.settings);
      if (
        !result.needsMigrationPersist &&
        JSON.stringify(projected) === JSON.stringify(result.settings)
      ) {
        return projected;
      }

      await enqueueSettingsWrite(async (shouldCommit, enterCommitPhase) => {
        const latest = await readSettingsWithMeta();
        const projected = await projectSettings(latest.settings);
        if (
          !latest.needsMigrationPersist &&
          JSON.stringify(projected) === JSON.stringify(latest.settings)
        ) {
          return;
        }

        await writeSettings(projected, shouldCommit, enterCommitPhase);
      });

      return readSettings();
    },

    async update(patch: Partial<AppSettings>, expectedAccountSettings): Promise<void> {
      const runUpdate = async (shouldCommit: () => boolean, enterCommitPhase: () => void) => {
        const validatedPatch = appSettingsPatchSchema.parse(normalizeSettingsPatch(patch));
        const current = await readSettings();
        const writesConnections = Object.hasOwn(patch, "providerFamilyConnectionSelections");
        if (
          writesConnections &&
          expectedAccountSettings?.providerFamilyDomainUpdatedAt === undefined
        ) {
          throw new Error("Account connection CAS required");
        }
        if (expectedAccountSettings) {
          const expected = appSettingsPatchSchema.parse(expectedAccountSettings);
          if (
            current.providerFamilyDomain !== expected.providerFamilyDomain ||
            (expected.providerFamilyDomainUpdatedAt !== undefined &&
              (current.providerFamilyDomainUpdatedAt ?? 0) !==
                expected.providerFamilyDomainUpdatedAt) ||
            JSON.stringify(current.providerFamilyConnectionSelections ?? {}) !==
              JSON.stringify(expected.providerFamilyConnectionSelections ?? {})
          ) {
            throw new Error("Account connection settings changed");
          }
        }
        const merged = appSettingsSchema.parse({
          ...current,
          ...validatedPatch,
        });

        if (writesConnections) {
          merged.providerFamilyDomainUpdatedAt = Math.max(
            validatedPatch.providerFamilyDomainUpdatedAt ?? Date.now(),
            (current.providerFamilyDomainUpdatedAt ?? 0) + 1,
          );
        }

        if (merged.recentProjects) {
          merged.recentProjects = [...new Set(merged.recentProjects)].slice(0, MAX_RECENT_PROJECTS);
        }

        await writeSettings(
          await projectSettings(merged),
          shouldCommit,
          enterCommitPhase,
          Object.hasOwn(patch, "providerFamilyConnectionSelections"),
        );
      };

      await enqueueSettingsWrite(runUpdate);
    },

    async updateDataBaseDir(newDir: string | undefined): Promise<void> {
      const currentBaseDir = getDataBaseDir();
      const targetBaseDir = newDir?.trim() || homedir();
      const validation = validateDataBaseDirTarget(targetBaseDir);
      if (!validation.ok) {
        const error = new Error(`${validation.code}: ${validation.forbiddenDir}`);
        (error as Error & { code: string }).code = validation.code;
        throw error;
      }

      if (currentBaseDir !== targetBaseDir) {
        log("copying data directory from", currentBaseDir, "to", targetBaseDir);
        await copyDataDirectory(currentBaseDir, targetBaseDir);
        log("data directory copy done");
      }

      await this.update({ dataBaseDir: newDir });
    },
  };

  let inFlight: Promise<readonly ProviderFamilyDomain[]> | null = null;
  let migrationComplete = false;
  return {
    service,
    setWorkspaceProjection(reader) {
      if (workspaceProjection) throw new Error("settings.workspace-projection-already-bound");
      workspaceProjection = reader;
    },
    prepareLegacyAccountConnections(resolveOrganization) {
      if (migrationComplete) return Promise.resolve([]);
      if (inFlight) return inFlight;
      const run = async (): Promise<readonly ProviderFamilyDomain[]> => {
        await service.get();
        const original = await readLegacyAccountConnectionSettingsFile(getSettingsFile());
        const incomplete = readIncompleteLegacyTeamConnections(original);
        if (incomplete.length === 0) return [];
        const resolved = await Promise.all(
          incomplete.map(async (connection) => ({
            ...connection,
            organizationId: await resolveOrganization(connection).catch(() => null),
          })),
        );
        await enqueueSettingsWrite(async (shouldCommit, enterCommitPhase) => {
          const latest = await readLegacyAccountConnectionSettingsFile(getSettingsFile());
          if (
            Object.hasOwn(latest, "providerFamilyConnectionSelections") ||
            latest.providerFamilyDomain !== original.providerFamilyDomain ||
            JSON.stringify(retainLegacyAccountConnectionFields(latest)) !==
              JSON.stringify(retainLegacyAccountConnectionFields(original))
          )
            return;
          if (resolved.some((entry) => !entry.organizationId?.trim())) return;
          const migrated = appSettingsSchema.parse(migrateLegacyAccountConnectionSettings(latest));
          const selections: ProviderFamilyConnectionSelectionSettings = {
            ...migrated.providerFamilyConnectionSelections,
          };
          for (const { family, productId, projectId, organizationId } of resolved) {
            selections[family] = {
              kind: "team-coding-plan",
              productId,
              projectId,
              organizationId: organizationId!.trim(),
            };
          }
          await writeSettings(
            await projectSettings({ ...migrated, providerFamilyConnectionSelections: selections }),
            shouldCommit,
            enterCommitPhase,
            true,
          );
        });
        return readIncompleteLegacyTeamConnections(
          await readLegacyAccountConnectionSettingsFile(getSettingsFile()),
        ).map((entry) => entry.family);
      };
      const pending = run();
      inFlight = pending;
      void pending.then(
        (unresolved) => {
          migrationComplete = unresolved.length === 0;
          if (inFlight === pending) inFlight = null;
        },
        () => {
          if (inFlight === pending) inFlight = null;
        },
      );
      return pending;
    },
  };
}
