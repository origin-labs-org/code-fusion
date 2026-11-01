import { constants } from "node:fs";
import { access, mkdir, readFile, stat } from "node:fs/promises";
import {
  appSettingsSchema,
  formatZodError,
  resolveStartupLocalWorkspaceSessionIndex,
  type WorkspacePurpose,
} from "@origin-ai/cf-shared";

interface StartupWorkspaceLogger {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
}

async function readStartupSettings(settingsFile: string, logger?: StartupWorkspaceLogger) {
  try {
    const raw = await readFile(settingsFile, "utf-8");
    const parsed = JSON.parse(raw);
    const result = appSettingsSchema.safeParse(parsed);

    if (!result.success) {
      logger?.warn?.(
        "[startup-workspace] invalid settings file, falling back to default workspace:",
        formatZodError(result.error),
      );
      return appSettingsSchema.parse({});
    }

    return result.data;
  } catch {
    return appSettingsSchema.parse({});
  }
}

export interface StartupWorkspaceWarmupTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

export const STARTUP_AGENT_WARMUP_LIMIT = 1;

export interface StartupWindowBootstrap {
  restoreSession?: boolean;
  initialWorkspacePath?: string;
  initialWorkspacePurpose?: WorkspacePurpose;
  unavailableWorkspacePath?: string;
  agentWarmupTargets?: StartupWorkspaceWarmupTarget[];
}

async function isAvailableWorkspaceDirectory(workspacePath: string): Promise<boolean> {
  try {
    const workspaceStat = await stat(workspacePath);
    if (!workspaceStat.isDirectory()) {
      return false;
    }
    await access(workspacePath, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolvePersistedActiveSession(
  sessions: NonNullable<ReturnType<typeof appSettingsSchema.parse>["lastWorkspaceSession"]>,
  lastActiveTabIndex: number | undefined,
) {
  if (sessions.length === 0) {
    return undefined;
  }
  const activeIndex = Math.min(Math.max(lastActiveTabIndex ?? 0, 0), sessions.length - 1);
  return sessions[activeIndex];
}

export function createOpenWorkspaceStartupBootstrap(workspacePath: string): StartupWindowBootstrap {
  return {
    initialWorkspacePath: workspacePath,
    initialWorkspacePurpose: "project",
    agentWarmupTargets: [{ workspacePath }],
  };
}

export async function resolveStartupWindowBootstrap({
  settingsFile,
  conversationWorkspaceDir,
  logger,
}: {
  settingsFile: string;
  conversationWorkspaceDir: string;
  logger?: StartupWorkspaceLogger;
}): Promise<StartupWindowBootstrap> {
  const settings = await readStartupSettings(settingsFile, logger);
  const sessions =
    settings.lastActiveWorkspace === undefined
      ? (settings.lastWorkspaceSession ?? [])
      : settings.lastActiveWorkspace
        ? [settings.lastActiveWorkspace]
        : [];
  const activeIndex = settings.lastActiveWorkspace === undefined ? settings.lastActiveTabIndex : 0;

  if (sessions.length > 0) {
    const persistedActiveSession = resolvePersistedActiveSession(sessions, activeIndex);
    const unavailableWorkspacePath =
      persistedActiveSession?.kind === "local" &&
      !(await isAvailableWorkspaceDirectory(persistedActiveSession.workspacePath))
        ? persistedActiveSession.workspacePath
        : undefined;
    if (unavailableWorkspacePath) {
      await mkdir(conversationWorkspaceDir, { recursive: true });
      logger?.warn?.(
        "[startup-workspace] active local workspace unavailable; using read-only restore:",
        unavailableWorkspacePath,
      );
    }
    const localActiveSessionIndex = resolveStartupLocalWorkspaceSessionIndex(sessions, activeIndex);
    const activeSession =
      localActiveSessionIndex == null ? undefined : sessions[localActiveSessionIndex];
    if (activeSession?.kind === "local") {
      const agentWarmupTargets = [{ workspacePath: activeSession.workspacePath }];
      return {
        ...(unavailableWorkspacePath ? { unavailableWorkspacePath } : {}),
        agentWarmupTargets,
      };
    }
    await mkdir(conversationWorkspaceDir, { recursive: true });
    return unavailableWorkspacePath ? { unavailableWorkspacePath } : {};
  }

  await mkdir(conversationWorkspaceDir, { recursive: true });
  logger?.info?.("[startup-workspace] using conversation workspace:", conversationWorkspaceDir);
  return {
    initialWorkspacePath: conversationWorkspaceDir,
    initialWorkspacePurpose: "conversation",
    agentWarmupTargets: [{ workspacePath: conversationWorkspaceDir }],
  };
}
