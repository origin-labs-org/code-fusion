import type { ICfSessionService, ICfTaskService } from "@origin-ai/cf-services";
import type {
  CfConfigOption,
  ModelSelection,
  CfSessionStateSnapshot,
  CfTaskSnapshot,
} from "@origin-ai/cf-shared";
import {
  cfSessionSettingsToConfigOptions,
  cfSessionSnapshotToCfTaskSnapshot,
} from "@/lib/cfSessionProjection.js";
import { normalizeCfUiError, type CfUiError } from "@/lib/cfUiError.js";
import { logger } from "@/logger.js";

export type CfSessionRestoreService = Pick<
  ICfSessionService,
  "readSession" | "resumeSession"
>;
export type CfLegacyTaskSnapshotRestoreService = Pick<ICfTaskService, "getTaskSnapshot">;

export interface DesktopContinuousSessionRestoreSnapshot {
  snapshot: CfTaskSnapshot;
  restoreWarning?: CfUiError;
  resumedSessionSnapshot?: CfSessionStateSnapshot;
  usedLegacySnapshot?: boolean;
}

function isSessionMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bSession (not found|is not active):/i.test(message);
}

function isRuntimeModelUnavailableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "CF_RUNTIME_MODEL_UNAVAILABLE"
  );
}

function getRuntimeModelUnavailableDiagnostics(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return {};
  }
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) {
    return {};
  }
  const model = "model" in data ? (data as { model?: unknown }).model : undefined;
  return {
    errorData: data,
    errorModel:
      typeof model === "object" && model !== null
        ? {
            modelId: "modelId" in model ? (model as { modelId?: unknown }).modelId : null,
            providerId:
              "providerId" in model ? (model as { providerId?: unknown }).providerId : null,
          }
        : null,
  };
}

function getSessionSnapshotDiagnostics(snapshot: CfSessionStateSnapshot) {
  return {
    activeTurnId: snapshot.runtime.activeTurnId ?? null,
    eventSeq: snapshot.runtime.eventSeq,
    messageCount: snapshot.messages.length,
    pendingRequestCount: snapshot.runtime.pendingRequestIds.length,
    sessionStatus: snapshot.session.status,
    stateRevision: snapshot.runtime.stateRevision,
  };
}

export async function readDesktopContinuousSessionRestoreSnapshot(params: {
  cfSessionService: CfSessionRestoreService;
  cfTaskService?: CfLegacyTaskSnapshotRestoreService;
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  messageLimit?: number;
  model?: ModelSelection;
  thoughtLevel?: string;
}): Promise<DesktopContinuousSessionRestoreSnapshot> {
  const startedAt = Date.now();
  let resumedSessionSnapshot: CfSessionStateSnapshot;
  try {
    const resumeStartedAt = Date.now();
    resumedSessionSnapshot = await params.cfSessionService.resumeSession({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
      sessionId: params.sessionId,
      ...(params.model ? { model: params.model } : {}),
      ...(params.thoughtLevel ? { thoughtLevel: params.thoughtLevel } : {}),
    });
    logger.info("[cfSessionRestore] desktop resumeSession 完成", {
      durationMs: Date.now() - resumeStartedAt,
      messageLimit: params.messageLimit ?? null,
      sessionId: params.sessionId,
      snapshot: getSessionSnapshotDiagnostics(resumedSessionSnapshot),
      totalDurationMs: Date.now() - startedAt,
      workspaceIdentity: params.workspaceIdentity ?? null,
      workspacePath: params.workspacePath,
    });
  } catch (error) {
    if (
      !params.cfTaskService ||
      (!isSessionMissingError(error) && !isRuntimeModelUnavailableError(error))
    ) {
      throw error;
    }

    const runtimeModelUnavailable = isRuntimeModelUnavailableError(error);
    if (runtimeModelUnavailable) {
      logger.info(
        "[cfSessionRestore][diag:model-unavailable] desktop resumeSession 模型不可用",
        {
          messageLimit: params.messageLimit ?? null,
          requestedModelId: params.model?.modelId ?? null,
          requestedProviderId: params.model?.providerId ?? null,
          sessionId: params.sessionId,
          workspaceIdentity: params.workspaceIdentity ?? null,
          workspacePath: params.workspacePath,
          ...getRuntimeModelUnavailableDiagnostics(error),
        },
      );
    }
    const legacyStartedAt = Date.now();
    const legacySnapshot = await params.cfTaskService.getTaskSnapshot({
      taskId: params.sessionId,
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
      ...(typeof params.messageLimit === "number" ? { messageLimit: params.messageLimit } : {}),
      clientMode: "desktop-continuous",
    });
    if (!legacySnapshot) {
      throw error;
    }
    logger.info("[cfSessionRestore] desktop legacy 快照读取完成", {
      durationMs: Date.now() - legacyStartedAt,
      messageCount: legacySnapshot.messages.length,
      messageLimit: params.messageLimit ?? null,
      sessionId: params.sessionId,
      totalDurationMs: Date.now() - startedAt,
      workspaceIdentity: params.workspaceIdentity ?? null,
      workspacePath: params.workspacePath,
    });
    return {
      snapshot: legacySnapshot,
      ...(runtimeModelUnavailable
        ? {
            restoreWarning: normalizeCfUiError(error, {
              fallbackCode: "CF_RUNTIME_MODEL_UNAVAILABLE",
              taskId: params.sessionId,
            }),
          }
        : {}),
      usedLegacySnapshot: true,
    };
  }
  const readStartedAt = Date.now();
  const readSessionSnapshot = await params.cfSessionService.readSession({
    workspacePath: params.workspacePath,
    workspaceIdentity: params.workspaceIdentity,
    sessionId: params.sessionId,
    deliveryKind: "desktop-continuous",
    ...(typeof params.messageLimit === "number" ? { messageLimit: params.messageLimit } : {}),
  });
  const readDurationMs = Date.now() - readStartedAt;
  const projectionStartedAt = Date.now();
  const snapshot = cfSessionSnapshotToCfTaskSnapshot(readSessionSnapshot);
  logger.info("[cfSessionRestore] desktop readSession 快照转换完成", {
    durationMs: Date.now() - startedAt,
    messageLimit: params.messageLimit ?? null,
    projectionDurationMs: Date.now() - projectionStartedAt,
    readDurationMs,
    sessionId: params.sessionId,
    snapshot: {
      history: snapshot.history ?? null,
      messageCount: snapshot.messages.length,
      status: snapshot.meta.status,
    },
    workspaceIdentity: params.workspaceIdentity ?? null,
    workspacePath: params.workspacePath,
  });
  return {
    resumedSessionSnapshot,
    snapshot,
  };
}

export async function readWebRemoteReplayableSessionConfigOptions(params: {
  cfSessionService: CfSessionRestoreService;
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string;
  model?: ModelSelection;
  thoughtLevel?: string;
}): Promise<CfConfigOption[] | null> {
  const startedAt = Date.now();
  try {
    if (params.model) {
      const resumeStartedAt = Date.now();
      const resumed = await params.cfSessionService.resumeSession({
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
        sessionId: params.sessionId,
        model: params.model,
        ...(params.thoughtLevel ? { thoughtLevel: params.thoughtLevel } : {}),
      });
      logger.info("[cfSessionRestore] replayable task 配置读取前 resumeSession 完成", {
        durationMs: Date.now() - resumeStartedAt,
        requestedModelId: params.model.modelId,
        requestedProviderId: params.model.providerId,
        sessionId: params.sessionId,
        snapshot: getSessionSnapshotDiagnostics(resumed),
        totalDurationMs: Date.now() - startedAt,
        workspaceIdentity: params.workspaceIdentity ?? null,
        workspacePath: params.workspacePath,
      });
    }
    const snapshot = await params.cfSessionService.readSession({
      workspacePath: params.workspacePath,
      workspaceIdentity: params.workspaceIdentity,
      sessionId: params.sessionId,
      deliveryKind: "web-remote-replayable",
      messageLimit: 1,
    });
    const options = cfSessionSettingsToConfigOptions(snapshot.settings);
    logger.info("[cfSessionRestore] replayable task 配置读取完成", {
      configOptionCount: options.length,
      durationMs: Date.now() - startedAt,
      sessionId: params.sessionId,
      snapshot: getSessionSnapshotDiagnostics(snapshot),
      workspaceIdentity: params.workspaceIdentity ?? null,
      workspacePath: params.workspacePath,
    });
    return options;
  } catch (error) {
    if (isSessionMissingError(error)) {
      logger.info("[cfSessionRestore] replayable task config read skipped, session inactive", {
        durationMs: Date.now() - startedAt,
        sessionId: params.sessionId,
        workspaceIdentity: params.workspaceIdentity ?? null,
        workspacePath: params.workspacePath,
      });
      return null;
    }
    throw error;
  }
}
