
import { Emitter, Event } from "@origin-ai/cf-rpc";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import type {
  ControllerSubscribeParams,
  WindowHostControllerTaskRow,
  WindowHostTaskAddress,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  matchesTaskListMembershipKind,
  windowHostTaskAddressSchema,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type {
  IWindowControllerService,
  ICfAgentService,
  ICfTaskService,
  WindowHostControllerFrame,
  WindowHostControllerTaskListItem,
  WindowHostControllerTaskListResult,
  WindowHostTaskUnreadSignal,
  CfTaskListQuery,
  CfTaskListWorkspaceScope,
} from "@origin-ai/cf-services";
import {
  createWindowHostControllerProjection,
  type WindowHostControllerMutation,
  type WindowHostControllerMutationResult,
  type WindowHostControllerSessionOverlay,
  type WindowHostControllerSourceScope,
} from "./windowHostControllerProjection.js";
import {
  createWindowHostSessionsIndexObserver,
  type WindowHostSessionsIndexObserver,
} from "./windowHostSessionsIndexObserver.js";

export interface ResolvedWindowHostControllerSource {
  scope: WindowHostControllerSourceScope;
  taskService?: ICfTaskService;
  agentService?: ICfAgentService;
  sourceAvailability: "online" | "offline";
}

function sourceKey(scope: WindowHostControllerSourceScope): string {
  return `${scope.kind}\0${scope.kind === "remote" ? (scope.sourceServerId ?? scope.remoteSessionId) : "local"}\0${scope.workspaceIdentity?.trim() || scope.workspacePath}`;
}

function taskKey(task: Pick<CfTaskMeta, "taskId" | "workspacePath" | "workspaceIdentity">) {
  return `${task.workspaceIdentity?.trim() || task.workspacePath}\0${task.taskId}`;
}

function normalizeTaskMeta(
  meta: CfTaskMeta,
  scope: WindowHostControllerSourceScope,
): CfTaskMeta {
  return {
    ...meta,
    workspacePath: scope.workspacePath,
    ...(scope.workspaceIdentity
      ? { workspaceIdentity: scope.workspaceIdentity }
      : { workspaceIdentity: undefined }),
  };
}

function compareItems(
  left: WindowHostControllerTaskListItem,
  right: WindowHostControllerTaskListItem,
  sortBy: CfTaskListQuery["sortBy"],
): number {
  const leftAt = sortBy === "created" ? left.createdAt : left.updatedAt;
  const rightAt = sortBy === "created" ? right.createdAt : right.updatedAt;
  return rightAt - leftAt || left.taskId.localeCompare(right.taskId);
}

function mutationParams(address: WindowHostTaskAddress) {
  return {
    taskId: address.taskId,
    workspacePath: address.workspacePath,
    ...(address.workspaceIdentity ? { workspaceIdentity: address.workspaceIdentity } : {}),
  };
}

function sessionOverlay(
  summary: import("@origin-ai/cf-shared/cf-protocol-v4").SessionSummary,
): WindowHostControllerSessionOverlay {
  const liveStatus: WindowHostControllerSessionOverlay["liveStatus"] =
    summary.pendingInteraction ||
    (summary.pendingInteractionSummary &&
      summary.pendingInteractionSummary.permissionCount +
        summary.pendingInteractionSummary.userInputCount >
        0)
      ? "waiting"
      : summary.phase === "prewarming" || summary.phase === "running"
        ? "running"
        : summary.phase === "error"
          ? "error"
          : summary.phase === "completedSuccess" || summary.phase === "completedInterrupted"
            ? "completed"
            : "idle";
  return {
    taskId: summary.sessionId,
    liveStatus,
    title: summary.title,
    ...(summary.titleSource ? { titleSource: summary.titleSource } : {}),
    updatedAt: summary.lastActivityAt,
    ...(summary.pendingInteraction
      ? {
          pendingInteraction: {
            interactionId: summary.pendingInteraction.interactionId,
            kind: summary.pendingInteraction.kind,
            ...(summary.pendingInteraction.toolName
              ? { toolName: summary.pendingInteraction.toolName }
              : {}),
            ...(summary.pendingInteraction.autoResolution
              ? { autoResolution: summary.pendingInteraction.autoResolution }
              : {}),
          },
        }
      : {}),
    activity: {
      phase: summary.phase,
      lastActivityAt: summary.lastActivityAt,
      hasBackgroundWork: summary.hasBackgroundWork,
      ...(summary.pendingInteractionSummary
        ? { pendingInteractions: summary.pendingInteractionSummary }
        : {}),
      ...(summary.workflowActivity ? { workflowActivity: summary.workflowActivity } : {}),
    },
  };
}

function liveStatusFromMeta(meta: CfTaskMeta): WindowHostControllerTaskRow["liveStatus"] {
  if (meta.status === "completed") return "completed";
  if (meta.status === "error") return "error";
  return "idle";
}

export function createWindowHostControllerRuntime(options: {
  createId: () => string;
  resolveSource: (scope: CfTaskListWorkspaceScope) => ResolvedWindowHostControllerSource | null;
  onSourceError?: (
    scope: WindowHostControllerSourceScope,
    operation: "refresh" | "search",
    error: unknown,
  ) => void;
}) {
  const projection = createWindowHostControllerProjection({ createId: options.createId });
  const unreadSignals = new Emitter<WindowHostTaskUnreadSignal>();
  const registeredScopes = new Map<string, WindowHostControllerSourceScope>();
  const sourceAvailability = new Map<string, "online" | "offline">();
  const sourceTaskServices = new Map<string, ICfTaskService>();
  const sourceSnapshotTaskServices = new Map<string, ICfTaskService>();
  const sourceEventSubscriptions = new Map<string, { dispose(): void }>();
  const sourceRefreshFlights = new Map<
    string,
    { taskService: ICfTaskService; promise: Promise<void> }
  >();
  const sourceRefreshGenerations = new Map<string, number>();
  const sourceLiveOverlays = new Map<string, WindowHostControllerSessionOverlay[]>();
  const sourceSessionObservers = new Map<
    string,
    { agentService: ICfAgentService; observer: WindowHostSessionsIndexObserver }
  >();
  const pendingReplacementByNextSourceKey = new Map<string, WindowHostControllerSourceScope>();

  function forgetRegisteredSource(scope: WindowHostControllerSourceScope): void {
    const key = sourceKey(scope);
    registeredScopes.delete(key);
    sourceAvailability.delete(key);
    sourceTaskServices.delete(key);
    sourceSnapshotTaskServices.delete(key);
    sourceEventSubscriptions.get(key)?.dispose();
    sourceEventSubscriptions.delete(key);
    sourceSessionObservers.get(key)?.observer.dispose();
    sourceSessionObservers.delete(key);
    sourceLiveOverlays.delete(key);
    sourceRefreshGenerations.set(key, (sourceRefreshGenerations.get(key) ?? 0) + 1);
    sourceRefreshFlights.delete(key);
  }

  function ensureSourceSessionObserver(
    resolved: ResolvedWindowHostControllerSource,
  ): WindowHostSessionsIndexObserver | null {
    const key = sourceKey(resolved.scope);
    if (resolved.sourceAvailability !== "online") {
      return sourceSessionObservers.get(key)?.observer ?? null;
    }
    if (!resolved.agentService) {
      sourceSessionObservers.get(key)?.observer.dispose();
      sourceSessionObservers.delete(key);
      if (sourceLiveOverlays.delete(key)) {
        projection.replaceSourceSessionOverlays(resolved.scope, []);
      }
      return null;
    }
    const current = sourceSessionObservers.get(key);
    if (current?.agentService === resolved.agentService) return current.observer;
    current?.observer.dispose();
    if (sourceLiveOverlays.delete(key)) {
      projection.replaceSourceSessionOverlays(resolved.scope, []);
    }
    let observer!: WindowHostSessionsIndexObserver;
    observer = createWindowHostSessionsIndexObserver({
      agentService: resolved.agentService,
      target: {
        workspacePath: resolved.scope.workspacePath,
        ...(resolved.scope.workspaceIdentity
          ? { workspaceIdentity: resolved.scope.workspaceIdentity }
          : {}),
      },
      onSessionsChange: (sessions) => {
        if (sourceSessionObservers.get(key)?.observer !== observer) return;
        const overlays = sessions.map(sessionOverlay);
        sourceLiveOverlays.set(key, overlays);
        projection.replaceSourceSessionOverlays(resolved.scope, overlays);
      },
      onError: (error) => options.onSourceError?.(resolved.scope, "refresh", error),
    });
    sourceSessionObservers.set(key, { agentService: resolved.agentService, observer });
    return observer;
  }

  function resolveCurrentSource(
    scope: WindowHostControllerSourceScope,
  ): ResolvedWindowHostControllerSource | null {
    return options.resolveSource({
      workspacePath: scope.workspacePath,
      ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
    });
  }

  async function executeMutation(
    scope: WindowHostControllerSourceScope,
    address: WindowHostTaskAddress,
    mutation: WindowHostControllerMutation,
  ): Promise<WindowHostControllerMutationResult> {
    const current = resolveCurrentSource(scope);
    if (!current?.taskService || current.sourceAvailability !== "online") {
      throw new Error(
        scope.kind === "remote" ? "Remote source currently offline; list write operations forbidden." : "Local source currently unavailable.",
      );
    }
    const service = current.taskService;
    const base = mutationParams(address);
    switch (mutation.kind) {
      case "rename":
        await service.renameTask({ ...base, title: mutation.title });
        break;
      case "pin":
        await service.setTaskPinned({ ...base, pinned: mutation.pinned });
        break;
      case "archive":
        if (mutation.archived) {
          await service.archiveTask(base);
        } else {
          await service.unarchiveTask(base);
        }
        break;
      case "delete":
        await service.deleteTask(base);
        break;
      case "delete-archived":
        return service.deleteArchivedTask(base);
      case "delete-archived-batch":
        if (sourceKey(current.scope) !== sourceKey(scope)) {
          throw new Error("Source for archive deletion batch has been replaced.");
        }
        return service.deleteArchivedTasks({
          workspacePath: base.workspacePath,
          workspaceIdentity: base.workspaceIdentity,
          taskIds: mutation.taskIds,
        });
      case "mark-read":
        return normalizeTaskMeta(
          await service.setTaskUnread({
            ...base,
            unread: false,
            ...(mutation.expectedUnreadAt != null
              ? { expectedUnreadAt: mutation.expectedUnreadAt }
              : {}),
          }),
          current.scope,
        );
      case "mark-unread":
        return normalizeTaskMeta(
          await service.setTaskUnread({ ...base, unread: true }),
          current.scope,
        );
      case "open":
      case "resume":
        break;
      default: {
        const exhaustive: never = mutation;
        throw new Error(`Unknown Controller mutation: ${String(exhaustive)}`);
      }
    }
  }

  function registerResolvedSource(resolved: ResolvedWindowHostControllerSource): void {
    const key = sourceKey(resolved.scope);
    if (!registeredScopes.has(key)) {
      registeredScopes.set(key, resolved.scope);
      projection.registerSource({
        scope: resolved.scope,
        mutate: (address, mutation) => executeMutation(resolved.scope, address, mutation),
      });
    }
    const previousAvailability = sourceAvailability.get(key);
    sourceAvailability.set(key, resolved.sourceAvailability);
    if (
      resolved.taskService &&
      sourceSnapshotTaskServices.has(key) &&
      sourceSnapshotTaskServices.get(key) !== resolved.taskService
    ) {
      sourceSnapshotTaskServices.delete(key);
    }
    if (
      resolved.taskService &&
      resolved.sourceAvailability === "online" &&
      typeof resolved.taskService.onDynamicWorkspaceEvent === "function" &&
      sourceTaskServices.get(key) !== resolved.taskService
    ) {
      sourceEventSubscriptions.get(key)?.dispose();
      const taskService = resolved.taskService;
      const isCurrentSource = () => {
        const current = resolveCurrentSource(resolved.scope);
        return (
          sourceTaskServices.get(key) === taskService &&
          sourceAvailability.get(key) === "online" &&
          current?.taskService === taskService &&
          current?.sourceAvailability === "online"
        );
      };
      sourceTaskServices.set(key, taskService);
      sourceEventSubscriptions.set(
        key,
        taskService.onDynamicWorkspaceEvent({
          workspacePath: resolved.scope.workspacePath,
          ...(resolved.scope.workspaceIdentity
            ? { workspaceIdentity: resolved.scope.workspaceIdentity }
            : {}),
        })((event) => {
          if (!isCurrentSource()) return;
          const signal: WindowHostTaskUnreadSignal | undefined =
            event.type === "workspace_task_list_changed" &&
            event.reason === "task_status_changed" &&
            event.unreadSignal === "background_terminal" &&
            event.taskMeta &&
            (event.taskMeta.status === "completed" || event.taskMeta.status === "error")
              ? {
                  address: {
                    taskId: event.taskId ?? event.taskMeta.taskId,
                    workspacePath: resolved.scope.workspacePath,
                    ...(resolved.scope.workspaceIdentity
                      ? { workspaceIdentity: resolved.scope.workspaceIdentity }
                      : {}),
                    ...(resolved.scope.kind === "remote"
                      ? {
                          ...(resolved.scope.sourceServerId
                            ? { sourceServerId: resolved.scope.sourceServerId }
                            : {}),
                          ...(resolved.scope.remoteSessionId
                            ? { remoteSessionId: resolved.scope.remoteSessionId }
                            : {}),
                        }
                      : {}),
                  },
                  updatedAt: event.taskMeta.updatedAt,
                  status: event.taskMeta.status,
                }
              : undefined;
          if (signal) unreadSignals.fire(signal);
          const inFlight = sourceRefreshFlights.get(key)?.promise;
          void (async () => {
            await inFlight?.catch(() => {});
            if (!isCurrentSource()) return;
            const current = resolveCurrentSource(resolved.scope);
            if (current) {
              await refreshSource(current, true).catch((error) =>
                options.onSourceError?.(current.scope, "refresh", error),
              );
            }
          })().catch((error) => options.onSourceError?.(resolved.scope, "refresh", error));
        }),
      );
    }
    if (resolved.sourceAvailability === "offline" && previousAvailability === "online") {
      sourceSessionObservers.get(key)?.observer.dispose();
      sourceSessionObservers.delete(key);
      sourceSnapshotTaskServices.delete(key);
      projection.disconnectSource(resolved.scope);
    }
  }

  async function readSourceTaskIndex(resolved: ResolvedWindowHostControllerSource) {
    if (!resolved.taskService || resolved.sourceAvailability !== "online") {
      throw new Error("Controller source currently unreadable.");
    }
    const request = {
      workspacePath: resolved.scope.workspacePath,
      ...(resolved.scope.workspaceIdentity
        ? { workspaceIdentity: resolved.scope.workspaceIdentity }
        : {}),
    };
    const [active, pinned, archived] = await Promise.all([
      resolved.taskService.listTasks(request),
      resolved.taskService.listPinnedTasks(request),
      resolved.taskService.listArchivedTasks(request),
    ]);
    const membershipByTaskKey = new Map<
      string,
      {
        meta: CfTaskMeta;
        membership: { pinned: boolean; archived: boolean; active: boolean };
      }
    >();
    for (const task of active) {
      const normalized = normalizeTaskMeta(task, resolved.scope);
      membershipByTaskKey.set(taskKey(normalized), {
        meta: normalized,
        membership: { pinned: false, archived: false, active: true },
      });
    }
    for (const task of pinned) {
      const normalized = normalizeTaskMeta(task, resolved.scope);
      membershipByTaskKey.set(taskKey(normalized), {
        meta: normalized,
        membership: { pinned: true, archived: false, active: true },
      });
    }
    for (const task of archived) {
      const normalized = normalizeTaskMeta(task, resolved.scope);
      membershipByTaskKey.set(taskKey(normalized), {
        meta: normalized,
        membership: { pinned: false, archived: true, active: false },
      });
    }
    return Array.from(membershipByTaskKey.values());
  }

  async function refreshSource(
    resolved: ResolvedWindowHostControllerSource,
    force = false,
    beforeCommit?: () => void,
  ): Promise<void> {
    registerResolvedSource(resolved);
    if (!resolved.taskService || resolved.sourceAvailability !== "online") {
      return;
    }
    const key = sourceKey(resolved.scope);
    await ensureSourceSessionObserver(resolved)?.start();
    if (!force && sourceSnapshotTaskServices.get(key) === resolved.taskService) return;
    const existing = sourceRefreshFlights.get(key);
    if (existing?.taskService === resolved.taskService) return existing.promise;
    const generation = (sourceRefreshGenerations.get(key) ?? 0) + 1;
    sourceRefreshGenerations.set(key, generation);
    const promise = (async () => {
      const taskIndex = await readSourceTaskIndex(resolved);
      if (sourceRefreshGenerations.get(key) !== generation) {
        throw new Error("Controller source refresh generation is obsolete");
      }
      beforeCommit?.();
      const previousScope = pendingReplacementByNextSourceKey.get(key);
      projection.replaceSourceSnapshot({
        scope: resolved.scope,
        ...(previousScope ? { replacesScope: previousScope } : {}),
        taskIndex,
        sessionsIndex: sourceLiveOverlays.get(key) ?? [],
      });
      if (previousScope) {
        forgetRegisteredSource(previousScope);
        pendingReplacementByNextSourceKey.delete(key);
      }
      sourceAvailability.set(key, "online");
      sourceSnapshotTaskServices.set(key, resolved.taskService!);
    })();
    sourceRefreshFlights.set(key, { taskService: resolved.taskService, promise });
    try {
      await promise;
    } finally {
      if (sourceRefreshFlights.get(key)?.promise === promise) {
        sourceRefreshFlights.delete(key);
      }
    }
  }

  async function replaceDisconnectedSource(
    previousScope: WindowHostControllerSourceScope,
    resolved: ResolvedWindowHostControllerSource,
    transaction?: {
      canCommit?: () => boolean;
      rollbackOnFailure?: boolean;
    },
  ): Promise<void> {
    if (!resolved.taskService || resolved.sourceAvailability !== "online") {
      throw new Error("重连 source 尚未 online，不能替换离线投影");
    }
    registerResolvedSource(resolved);
    const previousKey = sourceKey(previousScope);
    const retainedPreviousScope =
      pendingReplacementByNextSourceKey.get(previousKey) ?? previousScope;
    if (sourceKey(retainedPreviousScope) !== previousKey) {
      pendingReplacementByNextSourceKey.delete(previousKey);
      forgetRegisteredSource(previousScope);
      projection.removeSource(previousScope);
    }
    pendingReplacementByNextSourceKey.set(sourceKey(resolved.scope), retainedPreviousScope);
    try {
      await refreshSource(resolved, true, () => {
        if (transaction?.canCommit?.() === false) {
          throw new Error("Controller source replacement generation is obsolete");
        }
      });
    } catch (error) {
      if (transaction?.rollbackOnFailure) {
        const key = sourceKey(resolved.scope);
        if (pendingReplacementByNextSourceKey.has(key)) {
          pendingReplacementByNextSourceKey.delete(key);
          forgetRegisteredSource(resolved.scope);
          projection.discardSource(resolved.scope);
        }
      }
      throw error;
    }
  }

  function resolveQuerySources(
    scopes: CfTaskListWorkspaceScope[],
  ): ResolvedWindowHostControllerSource[] {
    const resolved = new Map<string, ResolvedWindowHostControllerSource>();
    for (const scope of scopes) {
      const source = options.resolveSource(scope);
      if (!source) {
        continue;
      }
      resolved.set(sourceKey(source.scope), source);
    }
    return Array.from(resolved.values());
  }

  async function listTaskList(
    query: CfTaskListQuery,
  ): Promise<WindowHostControllerTaskListResult> {
    const resolvedSources = resolveQuerySources(query.workspaceScopes);
    await Promise.all(
      resolvedSources.map(async (source) => {
        try {
          await refreshSource(source);
        } catch (error) {
          options.onSourceError?.(source.scope, "refresh", error);
        }
      }),
    );

    const search = query.search?.trim();
    let items: WindowHostControllerTaskListItem[];
    if (search) {
      const results = await Promise.all(
        resolvedSources
          .filter((source) => source.sourceAvailability === "online" && source.taskService != null)
          .map(async (source) => {
            try {
              const result = await source.taskService!.listTaskList({
                ...query,
                workspaceScopes: [
                  {
                    workspacePath: source.scope.workspacePath,
                    ...(source.scope.workspaceIdentity
                      ? { workspaceIdentity: source.scope.workspaceIdentity }
                      : {}),
                  },
                ],
                limit: undefined,
              });
              return result.items.map((item) => {
                const normalized = normalizeTaskMeta(item, source.scope);
                const projected = projection
                  .getTasks()
                  .find(
                    (row) =>
                      row.address.taskId === normalized.taskId &&
                      row.address.workspacePath === normalized.workspacePath &&
                      row.address.workspaceIdentity === normalized.workspaceIdentity &&
                      row.address.remoteSessionId ===
                        (source.scope.kind === "remote" ? source.scope.remoteSessionId : undefined),
                  );
                return {
                  ...(projected?.meta ?? normalized),
                  ...(source.scope.kind === "remote"
                    ? {
                        ...(source.scope.sourceServerId
                          ? { sourceServerId: source.scope.sourceServerId }
                          : {}),
                        ...(source.scope.serverDisplayName
                          ? { serverDisplayName: source.scope.serverDisplayName }
                          : {}),
                        remoteSessionId: source.scope.remoteSessionId,
                      }
                    : {}),
                  sourceAvailability: "online" as const,
                  liveStatus: projected?.liveStatus ?? liveStatusFromMeta(normalized),
                  ...(projected?.activity ? { activity: projected.activity } : {}),
                  ...(item.searchSnippets ? { searchSnippets: item.searchSnippets } : {}),
                };
              });
            } catch (error) {
              options.onSourceError?.(source.scope, "search", error);
              return [];
            }
          }),
      );
      items = results.flat();
    } else {
      const selectedSources = new Set<string>();
      for (const source of resolvedSources) {
        const key = sourceKey(source.scope);
        selectedSources.add(key);
        const pendingPreviousScope = pendingReplacementByNextSourceKey.get(key);
        if (pendingPreviousScope) {
          selectedSources.add(sourceKey(pendingPreviousScope));
        }
      }
      items = projection
        .getTasks()
        .filter((row) => {
          const scope: WindowHostControllerSourceScope =
            row.address.sourceServerId || row.address.remoteSessionId
              ? {
                  kind: "remote",
                  ...(row.address.sourceServerId
                    ? { sourceServerId: row.address.sourceServerId }
                    : {}),
                  remoteSessionId: row.address.remoteSessionId,
                  workspacePath: row.address.workspacePath,
                  workspaceIdentity: row.address.workspaceIdentity!,
                }
              : {
                  kind: "local",
                  workspacePath: row.address.workspacePath,
                  ...(row.address.workspaceIdentity
                    ? { workspaceIdentity: row.address.workspaceIdentity }
                    : {}),
                };
          return (
            selectedSources.has(sourceKey(scope)) &&
            matchesTaskListMembershipKind(row.membership, query.kind)
          );
        })
        .map((row) => {
          const resolvedSource = resolvedSources.find((source) => {
            const addressKey = row.address.workspaceIdentity?.trim() || row.address.workspacePath;
            const scopeKeyValue =
              source.scope.workspaceIdentity?.trim() || source.scope.workspacePath;
            return (
              addressKey === scopeKeyValue &&
              (source.scope.kind !== "remote" ||
                (row.address.sourceServerId
                  ? source.scope.sourceServerId === row.address.sourceServerId
                  : source.scope.remoteSessionId === row.address.remoteSessionId))
            );
          });
          return {
            ...row.meta,
            ...(row.address.sourceServerId ? { sourceServerId: row.address.sourceServerId } : {}),
            ...(resolvedSource?.scope.kind === "remote" && resolvedSource.scope.serverDisplayName
              ? { serverDisplayName: resolvedSource.scope.serverDisplayName }
              : {}),
            ...(row.address.remoteSessionId
              ? { remoteSessionId: row.address.remoteSessionId }
              : {}),
            sourceAvailability: row.sourceAvailability,
            liveStatus: row.liveStatus,
            ...(row.activity ? { activity: row.activity } : {}),
            ...(row.searchSnippets ? { searchSnippets: row.searchSnippets } : {}),
          };
        });
    }
    items.sort((left, right) => compareItems(left, right, query.sortBy));
    const total = items.length;
    const visible = query.limit == null ? items : items.slice(0, query.limit);
    return { items: visible, total, hasMore: total > visible.length };
  }

  function createAttachmentService(
    ownsUnreadSignals = true,
  ): IWindowControllerService & { dispose(): void } {
    const frameEmitter = new Emitter<WindowHostControllerFrame>();
    const unreadEmitter = new Emitter<WindowHostTaskUnreadSignal>();
    const unreadSubscription = ownsUnreadSignals
      ? unreadSignals.event((signal) => unreadEmitter.fire(signal))
      : undefined;
    const subscriptions = new Map<string, { dispose(): void }>();
    let attachmentDisposed = false;
    return {
      listTaskList,
      async getTaskMeta(params) {
        const address = windowHostTaskAddressSchema.parse(params.address);
        const resolved = options.resolveSource({
          workspacePath: address.workspacePath,
          ...(address.workspaceIdentity ? { workspaceIdentity: address.workspaceIdentity } : {}),
        });
        const taskService = resolved?.taskService;
        const assertCurrentSource = (current: ResolvedWindowHostControllerSource | null) => {
          if (
            attachmentDisposed ||
            !resolved ||
            !taskService ||
            !current ||
            current.sourceAvailability !== "online" ||
            current.taskService !== taskService ||
            current.scope.workspacePath !== address.workspacePath ||
            current.scope.workspaceIdentity !== address.workspaceIdentity ||
            sourceKey(current.scope) !== sourceKey(resolved.scope) ||
            (current.scope.kind === "remote" &&
              resolved.scope.kind === "remote" &&
              current.scope.remoteSessionId !== resolved.scope.remoteSessionId)
          )
            throw new Error("Source invalidated during task read");
          const mismatched =
            current.scope.kind === "remote"
              ? (address.sourceServerId
                  ? address.sourceServerId !== current.scope.sourceServerId
                  : address.remoteSessionId !== current.scope.remoteSessionId) ||
                (address.remoteSessionId != null &&
                  address.remoteSessionId !== current.scope.remoteSessionId)
              : address.remoteSessionId != null || address.sourceServerId != null;
          if (mismatched) throw new Error("任务地址与 source 不匹配");
        };
        assertCurrentSource(resolved);
        const result = await taskService!.getTaskMeta(mutationParams(address));
        assertCurrentSource(resolveCurrentSource(resolved!.scope));
        if (result && result.taskId !== address.taskId) throw new Error("Returned address from task read does not match");
        return result ? normalizeTaskMeta(result, resolved!.scope) : null;
      },
      async deleteArchivedTasks({ address, taskIds }) {
        if (taskIds.length === 0) {
          return { deletedTaskIds: [], skippedTaskIds: [], failedTaskIds: [] };
        }
        const result = await projection.mutate(address, { kind: "delete-archived-batch", taskIds });
        if (!result || typeof result === "boolean" || !("deletedTaskIds" in result)) {
          throw new Error("Archive deletion batch did not return item-by-item target results");
        }
        const resolved = options.resolveSource({
          workspacePath: address.workspacePath,
          workspaceIdentity: address.workspaceIdentity,
        });
        if (resolved) {
          await refreshSource(resolved, true).catch((error) =>
            options.onSourceError?.(resolved.scope, "refresh", error),
          );
        }
        return result;
      },
      async deleteArchivedTask({ address }) {
        const deleted = await projection.mutate(address, { kind: "delete-archived" });
        const resolved = options.resolveSource({
          workspacePath: address.workspacePath,
          workspaceIdentity: address.workspaceIdentity,
        });
        if (resolved) {
          await refreshSource(resolved, true).catch((error) =>
            options.onSourceError?.(resolved.scope, "refresh", error),
          );
        }
        return deleted === true;
      },
      async mutateTask({ address, mutation }) {
        const resolved = options.resolveSource({
          workspacePath: address.workspacePath,
          ...(address.workspaceIdentity ? { workspaceIdentity: address.workspaceIdentity } : {}),
        });
        if (!resolved || resolved.sourceAvailability !== "online")
          throw new Error(
            resolved?.scope.kind === "remote"
              ? "Remote source currently offline; list write operations forbidden."
              : "任务 source 当前不可用",
          );
        const taskService = resolved.taskService;
        const assertCurrentUnreadSource = () => {
          const current = resolveCurrentSource(resolved.scope);
          if (
            current?.taskService !== taskService ||
            current?.sourceAvailability !== "online" ||
            sourceAvailability.get(sourceKey(resolved.scope)) !== "online"
          ) {
            throw new Error("Source invalidated during unread write");
          }
        };
        await refreshSource(resolved);
        if (mutation.kind === "mark-read" || mutation.kind === "mark-unread") {
          await sourceRefreshFlights.get(sourceKey(resolved.scope))?.promise.catch(() => {});
          assertCurrentUnreadSource();
          const known = projection
            .getTasks()
            .some(
              (row) =>
                row.address.taskId === address.taskId &&
                row.address.workspacePath === address.workspacePath &&
                row.address.workspaceIdentity === address.workspaceIdentity &&
                (address.sourceServerId
                  ? row.address.sourceServerId === address.sourceServerId
                  : row.address.remoteSessionId === address.remoteSessionId),
            );
          if (!known) {
            await refreshSource(resolved, true);
            assertCurrentUnreadSource();
          }
        }
        const mutationResult = await projection.mutate(
          address,
          mutation as WindowHostControllerMutation,
        );
        if (mutationResult && typeof mutationResult !== "boolean" && "taskId" in mutationResult) {
          assertCurrentUnreadSource();
          await refreshSource(resolved, true).catch((error) =>
            options.onSourceError?.(resolved.scope, "refresh", error),
          );
          assertCurrentUnreadSource();
          return mutationResult;
        }
        await refreshSource(resolved, true);
        return (
          projection
            .getTasks()
            .find(
              (row) =>
                row.address.taskId === address.taskId &&
                row.address.workspacePath === address.workspacePath &&
                row.address.workspaceIdentity === address.workspaceIdentity &&
                (address.sourceServerId
                  ? row.address.sourceServerId === address.sourceServerId
                  : row.address.remoteSessionId === address.remoteSessionId),
            )?.meta ?? null
        );
      },
      async subscribeControllerV4(params: ControllerSubscribeParams) {
        const subscription = projection.subscribe({
          topic: params.topic,
          onFrame: (frame) => frameEmitter.fire(frame),
        });
        subscriptions.set(subscription.subscriptionId, subscription);
        return { ack: subscription.ack };
      },
      async resyncControllerV4(params) {
        return { ack: projection.resync(params.subscriptionId) };
      },
      async unsubscribeControllerV4(params) {
        subscriptions.get(params.subscriptionId)?.dispose();
        subscriptions.delete(params.subscriptionId);
      },
      onDynamicControllerFrame() {
        return frameEmitter.event;
      },
      onDynamicTaskUnreadSignal() {
        return ownsUnreadSignals ? unreadEmitter.event : Event.None;
      },
      dispose() {
        attachmentDisposed = true;
        unreadSubscription?.dispose();
        unreadEmitter.dispose();
        for (const subscription of subscriptions.values()) {
          subscription.dispose();
        }
        subscriptions.clear();
        frameEmitter.dispose();
      },
    };
  }

  const service = createAttachmentService();
  return {
    service,
    createAttachmentService,
    replaceDisconnectedSource,
    async resolveTaskAddress(params: {
      taskId: string;
      workspacePath: string;
      workspaceIdentity?: string;
      attachmentScope?: import("@origin-ai/cf-shared").WindowHostAttachmentScope;
      allowMissingTask?: boolean;
    }): Promise<WindowHostTaskAddress> {
      const remoteAttachmentScope =
        params.attachmentScope?.kind === "remote" ? params.attachmentScope : undefined;
      if (remoteAttachmentScope) {
        if (
          remoteAttachmentScope.workspacePath !== params.workspacePath ||
          remoteAttachmentScope.workspaceIdentity !== params.workspaceIdentity
        ) {
          throw new Error("列表 mutation 与 remote attachment scope 不匹配");
        }
      }
      const resolved = options.resolveSource({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
      });
      const assertAttachmentSource = (source: ResolvedWindowHostControllerSource | null) => {
        if (
          remoteAttachmentScope &&
          (!source ||
            source.scope.kind !== "remote" ||
            source.scope.remoteSessionId !== remoteAttachmentScope.remoteSessionId ||
            source.scope.workspacePath !== remoteAttachmentScope.workspacePath ||
            source.scope.workspaceIdentity !== remoteAttachmentScope.workspaceIdentity)
        ) {
          throw new Error("列表 mutation 与 remote attachment source 不匹配");
        }
      };
      assertAttachmentSource(resolved);
      if (resolved) {
        await refreshSource(resolved);
        assertAttachmentSource(resolveCurrentSource(resolved.scope));
      }
      const sourceServerId =
        resolved?.scope.kind === "remote" ? resolved.scope.sourceServerId : undefined;
      const matches = projection
        .getTasks()
        .filter(
          (row) =>
            row.address.taskId === params.taskId &&
            row.address.workspacePath === params.workspacePath &&
            row.address.workspaceIdentity === params.workspaceIdentity &&
            (!remoteAttachmentScope ||
              (sourceServerId
                ? row.address.sourceServerId === sourceServerId
                : row.address.remoteSessionId === remoteAttachmentScope.remoteSessionId)),
        );
      if (matches.length !== 1) {
        if (matches.length === 0 && params.allowMissingTask && resolved) {
          return {
            taskId: params.taskId,
            workspacePath: resolved.scope.workspacePath,
            ...(resolved.scope.workspaceIdentity
              ? { workspaceIdentity: resolved.scope.workspaceIdentity }
              : {}),
            ...(resolved.scope.kind === "remote"
              ? { remoteSessionId: resolved.scope.remoteSessionId }
              : {}),
          };
        }
        throw new Error(
          `list mutation 无法解析唯One source，taskId=${params.taskId}, matches=${matches.length}`,
        );
      }
      return matches[0]!.address;
    },
    disconnectSource(scope: WindowHostControllerSourceScope): void {
      const key = sourceKey(scope);
      if (!registeredScopes.has(key) || sourceAvailability.get(key) === "offline") {
        return;
      }
      sourceAvailability.set(key, "offline");
      sourceRefreshGenerations.set(key, (sourceRefreshGenerations.get(key) ?? 0) + 1);
      sourceRefreshFlights.delete(key);
      sourceSessionObservers.get(key)?.observer.dispose();
      sourceSessionObservers.delete(key);
      sourceSnapshotTaskServices.delete(key);
      projection.disconnectSource(scope);
    },
    removeSource(scope: WindowHostControllerSourceScope): void {
      const key = sourceKey(scope);
      if (!registeredScopes.has(key)) {
        return;
      }
      const retainedPreviousScope = pendingReplacementByNextSourceKey.get(key);
      forgetRegisteredSource(scope);
      pendingReplacementByNextSourceKey.delete(key);
      for (const [nextKey, previousScope] of pendingReplacementByNextSourceKey) {
        if (sourceKey(previousScope) === key) {
          pendingReplacementByNextSourceKey.delete(nextKey);
        }
      }
      projection.removeSource(scope);
      if (retainedPreviousScope && sourceKey(retainedPreviousScope) !== key) {
        forgetRegisteredSource(retainedPreviousScope);
        projection.removeSource(retainedPreviousScope);
      }
    },
    dispose(): void {
      service.dispose();
      unreadSignals.dispose();
      for (const scope of registeredScopes.values()) {
        projection.removeSource(scope);
      }
      for (const subscription of sourceEventSubscriptions.values()) {
        subscription.dispose();
      }
      registeredScopes.clear();
      sourceAvailability.clear();
      sourceTaskServices.clear();
      sourceSnapshotTaskServices.clear();
      sourceEventSubscriptions.clear();
      sourceRefreshFlights.clear();
      sourceRefreshGenerations.clear();
      for (const entry of sourceSessionObservers.values()) entry.observer.dispose();
      sourceSessionObservers.clear();
      sourceLiveOverlays.clear();
      pendingReplacementByNextSourceKey.clear();
    },
  };
}
