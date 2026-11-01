
import type { ICfAgentService } from "#src/cf-agent/cfAgent.js";
import type { CfTaskIndexSyncer } from "#src/cf-agent/cfTaskIndexSyncer.js";
import { createServiceLogger } from "#src/logger/serviceLogger.js";
import {
  createSessionTraceId,
  type CfSessionStateSnapshot,
  type CfWorkspaceTaskListChanged,
} from "@origin-ai/cf-shared";
import type {
  ICfSessionService,
  CfSessionCreateParams,
  CfSessionEventsParams,
  CfSessionListParams,
  CfSessionMessagesParams,
  CfSessionReadParams,
  CfSessionReadWorkspacePresentationParams,
  CfSessionResumeParams,
  CfSessionSetModeParams,
  CfSessionSetModelParams,
  CfSessionSetThoughtLevelParams,
  CfTaskTarget,
  CfSessionWorkspaceTarget,
} from "#src/cf-session/cfSession.js";
import { formatModelPickerValue } from "#src/cf-agent/cfConfigOptions.js";
import { createCfSessionApiRetryRuntimeTracker } from "#src/cf-session/cfSessionApiRetry.js";
import { appendWorkspaceToFilesystemMcpServers } from "#src/session/mcpWorkspaceScope.js";
import { repairEmptyImportedClaudeSessionSnapshot } from "#src/cf-session/importedClaudeSessionRepair.js";
import { createCfDeferredDraftRegistry } from "#src/cf-session/cfSessionDraftRegistry.js";
import type { CuaProductMcpServerResolver } from "#src/cua-permission-broker/index.js";

const logger = createServiceLogger("cf-session-service");

interface CreateCfSessionServiceOptions {
  agentService: ICfAgentService;
  
  taskIndexSyncer?: CfTaskIndexSyncer;
  cuaProductMcpServerResolver?: CuaProductMcpServerResolver;
}

export function createCfSessionService({
  agentService,
  taskIndexSyncer,
  cuaProductMcpServerResolver,
}: CreateCfSessionServiceOptions): ICfSessionService {
  const { withApiRetryRuntime } = createCfSessionApiRetryRuntimeTracker();
  const deferredDraftSessions = createCfDeferredDraftRegistry();

  function notifySyncer(target: CfTaskTarget): void {
    if (!taskIndexSyncer) {
      return;
    }
    taskIndexSyncer.ensureSessionSubscription({
      workspacePath: target.workspacePath,
      workspaceIdentity: target.workspaceIdentity,
      sessionId: target.sessionId,
    });
  }

  function getSessionSnapshotDiagnostics(snapshot: CfSessionStateSnapshot) {
    const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
    const pendingRequestIds = Array.isArray(snapshot.runtime.pendingRequestIds)
      ? snapshot.runtime.pendingRequestIds
      : [];
    return {
      activeTurnId: snapshot.runtime.activeTurnId ?? null,
      eventSeq: snapshot.runtime.eventSeq,
      messageCount: messages.length,
      pendingRequestCount: pendingRequestIds.length,
      sessionStatus: snapshot.session.status,
      stateRevision: snapshot.runtime.stateRevision,
    };
  }

  function readSnapshotAvailableThoughtLevels(
    snapshot: CfSessionStateSnapshot,
  ): Set<string> | null {
    const thoughtLevel = snapshot.settings.thoughtLevel;
    if (!thoughtLevel.enabled) {
      return new Set();
    }
    const available = Array.isArray(thoughtLevel.available)
      ? (thoughtLevel.available as readonly unknown[])
      : [];
    if (available.length === 0) {
      return null;
    }
    const values = available
      .map((option) => {
        if (typeof option === "string") {
          return option.trim();
        }
        if (typeof option === "object" && option !== null && "value" in option) {
          const value = (option as { value?: unknown }).value;
          return typeof value === "string" ? value.trim() : "";
        }
        return "";
      })
      .filter((value) => value.length > 0);
    return values.length > 0 ? new Set(values) : null;
  }

  function canReplayThoughtLevelFromResumeSnapshot(params: {
    snapshot: CfSessionStateSnapshot;
    thoughtLevel: string;
  }): boolean {
    const availableThoughtLevels = readSnapshotAvailableThoughtLevels(params.snapshot);
    return availableThoughtLevels === null || availableThoughtLevels.has(params.thoughtLevel);
  }

  async function broadcastSnapshot(
    snapshot: CfSessionStateSnapshot,
    tag: string,
    options: {
      modelOverride?: string;
      thoughtLevelOverride?: string;
      moveGroupedTaskToTop?: boolean;
      
      broadcastReason: CfWorkspaceTaskListChanged["reason"];
    },
  ): Promise<void> {
    if (!taskIndexSyncer) {
      return;
    }
    try {
      logger.debug(
        undefined,
        `[list-refresh-trace] broadcastSnapshot tag=${tag} taskId=${snapshot.session.sessionId}`,
      );
      await taskIndexSyncer.syncSnapshotAndBroadcast(snapshot, options);
    } catch (error) {
      logger.warn(
        undefined,
        `[cf-session-service] ${tag} syncSnapshotAndBroadcast Failed taskId=${snapshot.session.sessionId}`,
        error,
      );
    }
  }

  async function repairEmptyImportedClaudeSession(
    snapshot: CfSessionStateSnapshot,
    params: CfSessionResumeParams | CfSessionReadParams,
  ): Promise<CfSessionStateSnapshot> {
    return withApiRetryRuntime(
      await repairEmptyImportedClaudeSessionSnapshot({
        agentService,
        snapshot,
        target: params,
      }),
    );
  }

  async function withResolvedMcpServers<
    T extends CfSessionCreateParams | CfSessionResumeParams,
  >(params: T): Promise<T> {
    const mcpServers = appendWorkspaceToFilesystemMcpServers(
      params.mcpServers,
      params.workspacePath,
    );
    const resolvedMcpServers = cuaProductMcpServerResolver
      ? await cuaProductMcpServerResolver.resolveMcpServers(mcpServers, {
          workspacePath: params.workspacePath,
        })
      : mcpServers;
    if (resolvedMcpServers === params.mcpServers) {
      return params;
    }
    return { ...params, mcpServers: resolvedMcpServers };
  }

  return {
    async initializeWorkspace(params: CfSessionWorkspaceTarget) {
      const result = await agentService.initialize(params);
      if (result.available && taskIndexSyncer) {
        taskIndexSyncer.ensureWorkspaceSubscription({
          workspacePath: params.workspacePath,
          workspaceIdentity: params.workspaceIdentity,
        });
      }
      return result;
    },

    getWorkspaceRuntimeIdentity(params: CfSessionWorkspaceTarget) {
      return agentService.getWorkspaceRuntimeIdentity(params);
    },

    readWorkspacePresentation(params: CfSessionReadWorkspacePresentationParams) {
      return agentService.readWorkspacePresentation(params);
    },

    async createSession(params: CfSessionCreateParams) {
      const startedAt = Date.now();
      const sessionTraceId = params.sessionTraceId ?? createSessionTraceId();
      const agentParams = await withResolvedMcpServers({ ...params, sessionTraceId });
      logger.info(sessionTraceId, "[cf-session-service] createSession 分配 session trace", {
        persistence: agentParams.persistence,
        workspaceIdentity: agentParams.workspaceIdentity,
        workspacePath: agentParams.workspacePath,
      });
      const snapshot = await agentService.createSession(agentParams);
      logger.info(sessionTraceId, "[cf-session-service] createSession agent 返回", {
        durationMs: Date.now() - startedAt,
        mcpServerCount: agentParams.mcpServers?.length ?? 0,
        persistence: agentParams.persistence,
        snapshotTraceId: snapshot.session.traceId ?? null,
        sessionId: snapshot.session.sessionId,
        workspaceIdentity: agentParams.workspaceIdentity,
        workspacePath: agentParams.workspacePath,
      });
      if (agentParams.persistence === "deferred") {
        deferredDraftSessions.remember(agentParams, snapshot);
        return snapshot;
      }
      notifySyncer({
        workspacePath: snapshot.session.workspace.workspacePath,
        workspaceIdentity: snapshot.session.workspace.workspaceIdentity,
        sessionId: snapshot.session.sessionId,
      });
      const snapshotWithRuntime = withApiRetryRuntime(snapshot);
      const broadcastStartedAt = Date.now();
      await broadcastSnapshot(snapshotWithRuntime, "createSession", {
        moveGroupedTaskToTop: true,
        broadcastReason: "task_meta_changed",
      });
      logger.info(sessionTraceId, "[cf-session-service] createSession task index 同步完成", {
        broadcastDurationMs: Date.now() - broadcastStartedAt,
        durationMs: Date.now() - startedAt,
        sessionId: snapshot.session.sessionId,
        workspaceIdentity: params.workspaceIdentity,
        workspacePath: params.workspacePath,
      });
      return snapshotWithRuntime;
    },

    async resumeSession(params: CfSessionResumeParams) {
      const startedAt = Date.now();
      const { broadcastSnapshot: shouldBroadcastSnapshot = true, ...resumeParams } = params;
      const agentParams = await withResolvedMcpServers(resumeParams);
      let snapshot = await repairEmptyImportedClaudeSession(
        withApiRetryRuntime(await agentService.resumeSession(agentParams)),
        agentParams,
      );
      const requestedThoughtLevelOverride = agentParams.thoughtLevel?.trim();
      let thoughtLevelOverride = requestedThoughtLevelOverride;
      if (
        requestedThoughtLevelOverride &&
        snapshot.settings.thoughtLevel.current !== requestedThoughtLevelOverride
      ) {
        if (
          !canReplayThoughtLevelFromResumeSnapshot({
            snapshot,
            thoughtLevel: requestedThoughtLevelOverride,
          })
        ) {
          thoughtLevelOverride = undefined;
          logger.warn(
            undefined,
            "[cf-session-service] resumeSession 跳过不支持的 task 思考强度",
            {
              availableThoughtLevels: Array.from(
                readSnapshotAvailableThoughtLevels(snapshot) ?? [],
              ),
              requestedThoughtLevel: requestedThoughtLevelOverride,
              sessionId: agentParams.sessionId,
              snapshotThoughtLevel: snapshot.settings.thoughtLevel.current ?? null,
              workspaceIdentity: agentParams.workspaceIdentity ?? null,
              workspacePath: agentParams.workspacePath,
            },
          );
        }
      }
      if (thoughtLevelOverride && snapshot.settings.thoughtLevel.current !== thoughtLevelOverride) {
        logger.info(undefined, "[cf-session-service] resumeSession 重放 task 思考强度", {
          requestedThoughtLevel: thoughtLevelOverride,
          sessionId: agentParams.sessionId,
          snapshotThoughtLevel: snapshot.settings.thoughtLevel.current ?? null,
          workspaceIdentity: agentParams.workspaceIdentity ?? null,
          workspacePath: agentParams.workspacePath,
        });
        snapshot = await repairEmptyImportedClaudeSession(
          withApiRetryRuntime(
            await agentService.setThoughtLevel({
              workspacePath: agentParams.workspacePath,
              workspaceIdentity: agentParams.workspaceIdentity,
              sessionId: agentParams.sessionId,
              thoughtLevel: thoughtLevelOverride,
            }),
          ),
          agentParams,
        );
      }
      const agentDurationMs = Date.now() - startedAt;
      notifySyncer(agentParams);
      const broadcastStartedAt = Date.now();
      const modelOverride = agentParams.model
        ? formatModelPickerValue(agentParams.model)
        : undefined;
      const syncOptions =
        modelOverride || thoughtLevelOverride
          ? {
              ...(modelOverride ? { modelOverride } : {}),
              ...(thoughtLevelOverride ? { thoughtLevelOverride } : {}),
            }
          : undefined;
      if (shouldBroadcastSnapshot) {
        await broadcastSnapshot(snapshot, "resumeSession", {
          ...syncOptions,
          broadcastReason: "task_status_changed",
        });
      } else if (modelOverride && taskIndexSyncer) {
        await taskIndexSyncer.syncTaskModel(
          {
            workspacePath: agentParams.workspacePath,
            workspaceIdentity: agentParams.workspaceIdentity,
            sessionId: agentParams.sessionId,
          },
          modelOverride,
        );
      }
      logger.info(undefined, "[cf-session-service] resumeSession 历史恢复完成", {
        agentDurationMs,
        broadcastDurationMs: shouldBroadcastSnapshot ? Date.now() - broadcastStartedAt : 0,
        broadcastSnapshot: shouldBroadcastSnapshot,
        durationMs: Date.now() - startedAt,
        mcpServerCount: agentParams.mcpServers?.length ?? 0,
        sessionId: agentParams.sessionId,
        snapshot: getSessionSnapshotDiagnostics(snapshot),
        workspaceIdentity: agentParams.workspaceIdentity ?? null,
        workspacePath: agentParams.workspacePath,
      });
      return snapshot;
    },

    listSessions(params: CfSessionListParams) {
      return agentService.listSessions(params);
    },

    async readSession(params: CfSessionReadParams) {
      const startedAt = Date.now();
      const snapshot = await repairEmptyImportedClaudeSession(
        withApiRetryRuntime(await agentService.readSession(params)),
        params,
      );
      logger.info(undefined, "[cf-session-service] readSession 历史快照读取完成", {
        deliveryKind: params.deliveryKind,
        durationMs: Date.now() - startedAt,
        messageLimit: params.messageLimit ?? null,
        sessionId: params.sessionId,
        snapshot: getSessionSnapshotDiagnostics(snapshot),
        workspaceIdentity: params.workspaceIdentity ?? null,
        workspacePath: params.workspacePath,
      });
      return snapshot;
    },

    readSessionMessages(params: CfSessionMessagesParams) {
      return agentService.readSessionMessages(params);
    },

    readSessionEvents(params: CfSessionEventsParams) {
      return agentService.readSessionEvents(params);
    },

    promoteDeferredDraftSession(params: CfTaskTarget) {
      const wasDeferredDraft = deferredDraftSessions.has(params);
      deferredDraftSessions.forget(params);
      if (!wasDeferredDraft) {
        return Promise.resolve();
      }
      notifySyncer(params);
      logger.info(undefined, "[cf-session-service] deferred draft session 已提升为 task", {
        sessionId: params.sessionId,
        workspaceIdentity: params.workspaceIdentity ?? null,
        workspacePath: params.workspacePath,
      });
      return Promise.resolve();
    },

    closeSession(params: CfTaskTarget) {
      deferredDraftSessions.forget(params);
      return agentService.closeSession(params).then(() => undefined);
    },

    async closeDeferredDraftSession(params: CfTaskTarget) {
      try {
        const closed = await agentService.closeSession({
          ...params,
          expectedPersistence: "deferred",
        });
        if (closed) {
          deferredDraftSessions.forget(params);
        }
        return closed;
      } catch (error) {
        logger.warn(
          undefined,
          "[cf-session-service] 条件关闭 deferred draft 失败，保留旧 session",
          {
            error: error instanceof Error ? error.message : String(error),
            sessionId: params.sessionId,
            workspaceIdentity: params.workspaceIdentity ?? null,
            workspacePath: params.workspacePath,
          },
        );
        return false;
      }
    },

    async setModel(params: CfSessionSetModelParams) {
      const isDeferredDraft = deferredDraftSessions.has(params);
      if (!isDeferredDraft) {
        notifySyncer(params);
      }
      const snapshot = withApiRetryRuntime(await agentService.setModel(params));
      if (isDeferredDraft) {
        return snapshot;
      }
      await broadcastSnapshot(snapshot, "setModel", {
        modelOverride: formatModelPickerValue(params.model),
        broadcastReason: "task_model_changed",
      });
      return snapshot;
    },

    async setThoughtLevel(params: CfSessionSetThoughtLevelParams) {
      return withApiRetryRuntime(await agentService.setThoughtLevel(params));
    },

    async setMode(params: CfSessionSetModeParams) {
      return withApiRetryRuntime(await agentService.setMode(params));
    },

    respondProviderRuntimeHeaders(params) {
      return agentService.respondProviderRuntimeHeaders(params);
    },

  };
}
