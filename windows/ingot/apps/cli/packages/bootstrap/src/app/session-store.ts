import { isAbsolute, resolve } from "node:path";
import { SqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import { resolvePath, type ConfigResult } from "@origin-ai/cf-adapters/config";
import {
  SESSION_ENTRY_MODEL_SELECTION,
  parseModelSelectionValue,
  type SessionId,
  type SessionStorePort,
  type CollaborationMode,
  type InputHistoryStorePort,
  type LocalSettingStorePort,
  type ProjectId,
} from "@origin-ai/cf-contracts";
import type { ModelSelection } from "@origin-ai/cf-provider";
import { isHighspeedProviderId } from "@origin-ai/cf-shared";
import { StartupTimer } from "../startup-logging.js";

export function isClosableSessionStore(
  store: SessionStorePort,
): store is SessionStorePort & { close(): void } {
  return "close" in store && typeof store.close === "function";
}

export function asInputHistoryStore(store: SessionStorePort): InputHistoryStorePort | undefined {
  const candidate = store as Partial<InputHistoryStorePort>;
  return typeof candidate.recordInputHistory === "function" &&
    typeof candidate.recallPreviousInputHistory === "function"
    ? (store as SessionStorePort & InputHistoryStorePort)
    : undefined;
}

export function asLocalSettingStore(store: SessionStorePort): LocalSettingStorePort | undefined {
  const candidate = store as Partial<LocalSettingStorePort>;
  return typeof candidate.getProjectPermissionMode === "function" &&
    typeof candidate.saveProjectPermissionMode === "function"
    ? (store as SessionStorePort & LocalSettingStorePort)
    : undefined;
}

export function readProjectPermissionMode(
  store: LocalSettingStorePort | undefined,
  projectID: ProjectId,
): CollaborationMode | undefined {
  if (!store) return undefined;
  const mode = store.getProjectPermissionMode(projectID);
  return isPromiseLike(mode) ? undefined : (mode ?? undefined);
}

export async function readSessionModelSelection(
  store: Pick<SessionStorePort, "sessionEntries">,
  sessionID: SessionId,
): Promise<ModelSelection | undefined> {
  if (!store.sessionEntries) return undefined;
  const entries = await store.sessionEntries({
    sessionID,
    type: SESSION_ENTRY_MODEL_SELECTION,
  });
  const data = entries.at(-1)?.data;
  const complete = parseModelSelectionValue(data);
  if (complete) return residentModelSelection(complete);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const current = data as Record<string, unknown>;
    return residentModelSelection(
      parseModelSelectionValue({ providerId: current.providerId, modelId: current.modelId }),
    );
  }
  return undefined;
}

function residentModelSelection(selection: ModelSelection | undefined): ModelSelection | undefined {
  if (!selection) return undefined;
  return isHighspeedProviderId(selection.providerId) ? undefined : selection;
}

export function closeSessionStore(store: SqliteSessionStore): void {
  store.close();
}

export async function openStartupSessionStore(
  configResult: ConfigResult,
  startupTimer: StartupTimer,
): Promise<SqliteSessionStore> {
  const dbPath = getSessionDbPath(configResult);
  startupTimer.start("CodeFusion SQLite migration started", {
    context: { dbPath },
    event: "bootstrap.app.startup.sqlite_migration.started",
    stage: "migrate_session_db",
  });
  const store = await SqliteSessionStore.openStartup(
    { dbPath },
    {
      onProgress: async (progress) => {
        startupTimer.mark("SQLite startup state", {
          event: "bootstrap.app.startup.storage_state",
          stage: "migrate_session_db",
          context: { ...progress },
        });
      },
    },
  );
  startupTimer.mark("CodeFusion SQLite migration completed", {
    context: { dbPath },
    event: "bootstrap.app.startup.sqlite_migration.completed",
    stage: "migrate_session_db",
  });
  return store;
}

export async function openStartupCfProtocolSessionStore(
  configResult: ConfigResult,
  startupTimer: StartupTimer,
): Promise<SqliteSessionStore> {
  const dbPath = getSessionDbPath(configResult);
  startupTimer.start("CodeFusion Protocol SQLite migration started", {
    context: { dbPath },
    event: "cf_protocol.startup.sqlite_migration.started",
    stage: "migrate_session_db",
  });
  const store = await SqliteSessionStore.openStartup({ dbPath });
  startupTimer.mark("CodeFusion Protocol SQLite migration completed", {
    context: { dbPath },
    event: "cf_protocol.startup.sqlite_migration.completed",
    stage: "migrate_session_db",
  });
  return store;
}

export function getSessionDbPath(configResult: ConfigResult, workingDirectory?: string): string {
  const configured = configResult.config.storage.sessionDbPath;
  if (workingDirectory && !isAbsolute(configured) && !configured.startsWith("~/"))
    return resolve(workingDirectory, configured);
  return resolvePath(configured);
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
