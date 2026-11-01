import { useEffect, useRef, useState } from "react";
import type { CfProvider, CfTaskMeta } from "@origin-ai/cf-shared";
import { useCfTaskService } from "@/hooks/useCfTaskService.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useTaskNativeSessionLogFile } from "@/hooks/useTaskNativeSessionLogFile.js";
import { useTaskSessionFilePath } from "@/hooks/useTaskSessionFilePath.js";
import { logger } from "@/logger.js";
import { resolveWorkspaceHeaderProvider } from "@/lib/workspaceHeaderProvider.js";
import { selectWorkspaceCfState, useCfSessionStore } from "@/store/cfSessionStore.js";

interface UseWorkspaceActiveTaskStateParams {
  workspaceAbsPath: string;
  activeTaskId: string | null;
  workspaceRemoteSessionId?: string | null;
  workspaceIdentity?: string;
  selectedProvider: CfProvider;
  intl: {
    formatMessage(descriptor: { id: string }): string;
  };
}

function areTaskMetaJsonFieldsEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function areResolvedTaskMetasEqual(left: CfTaskMeta | null, right: CfTaskMeta | null) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.taskId === right.taskId &&
    left.traceId === right.traceId &&
    left.title === right.title &&
    left.titleOverridden === right.titleOverridden &&
    left.workspacePath === right.workspacePath &&
    left.workspaceIdentity === right.workspaceIdentity &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.mode === right.mode &&
    left.model === right.model &&
    left.thoughtLevel === right.thoughtLevel &&
    left.runtimeEpoch === right.runtimeEpoch &&
    left.provider === right.provider &&
    left.migrationSource === right.migrationSource &&
    left.forkedFromTaskId === right.forkedFromTaskId &&
    left.unreadAt === right.unreadAt &&
    left.status === right.status &&
    areTaskMetaJsonFieldsEqual(left.lastError, right.lastError) &&
    areTaskMetaJsonFieldsEqual(left.repairState, right.repairState) &&
    areTaskMetaJsonFieldsEqual(left.changeSummary, right.changeSummary) &&
    areTaskMetaJsonFieldsEqual(left.target, right.target)
  );
}

export function useStableResolvedActiveTaskMeta(taskMeta: CfTaskMeta | null) {
  const stableTaskMetaRef = useRef<CfTaskMeta | null>(null);
  const stableTaskMeta = stableTaskMetaRef.current;
  if (!areResolvedTaskMetasEqual(stableTaskMeta, taskMeta)) {
    stableTaskMetaRef.current = taskMeta;
  }
  return stableTaskMetaRef.current;
}

export function useWorkspaceActiveTaskState({
  workspaceAbsPath,
  activeTaskId,
  workspaceRemoteSessionId,
  workspaceIdentity,
  selectedProvider,
  intl,
}: UseWorkspaceActiveTaskStateParams) {
  const service = useCfTaskService(
    workspaceAbsPath,
    workspaceRemoteSessionId,
    workspaceIdentity,
  );
  const { broadcastService } = useBaseWorkspaceServices();
  const version = useCfSessionStore(
    (state) =>
      selectWorkspaceCfState(state, workspaceAbsPath, workspaceIdentity).taskListVersion,
  );
  const optimisticMeta = useCfSessionStore((state) => {
    const workspace = selectWorkspaceCfState(state, workspaceAbsPath, workspaceIdentity);
    return activeTaskId ? (workspace.optimisticTaskListByTaskId[activeTaskId] ?? null) : null;
  });
  const targetKey = JSON.stringify([
    workspaceIdentity?.trim() || workspaceAbsPath,
    activeTaskId,
    workspaceRemoteSessionId ?? null,
  ]);
  const [indexed, setIndexed] = useState<{
    service: typeof service;
    targetKey: string;
    meta: CfTaskMeta | null;
  } | null>(null);
  useEffect(() => {
    if (!activeTaskId) return;
    let disposed = false;
    let serial = 0;
    const target = { workspacePath: workspaceAbsPath, workspaceIdentity, taskId: activeTaskId };
    const refresh = async () => {
      const request = ++serial;
      try {
        const meta = await service.getTaskMeta(target);
        if (!disposed && request === serial) setIndexed({ service, targetKey, meta });
      } catch (error) {
        if (!disposed && request === serial)
          logger.warn("[active-task-meta] 读取 Host 任务元数据失败", { ...target, error });
      }
    };
    const events = service.onDynamicWorkspaceEvent(target)((event) => {
      if (event.type === "workspace_task_list_changed") void refresh();
    });
    const projects = broadcastService.onMessage((event) => {
      if (event.channel === "state:projects") void refresh();
    });
    void refresh();
    return () => {
      disposed = true;
      events.dispose();
      projects.dispose();
    };
  }, [
    service,
    broadcastService,
    workspaceAbsPath,
    workspaceIdentity,
    activeTaskId,
    targetKey,
    version,
  ]);
  const indexedMeta =
    indexed?.service === service && indexed.targetKey === targetKey ? indexed.meta : null;
  const activeTaskMeta = indexedMeta ?? optimisticMeta;
  const resolvedActiveTaskMeta = useStableResolvedActiveTaskMeta(activeTaskMeta);
  const activeTaskChangeSummary = null;
  const activeTraceId = resolvedActiveTaskMeta?.traceId ?? null;
  const activeSessionId = resolvedActiveTaskMeta?.taskId ?? null;
  const activeTaskProvider = resolvedActiveTaskMeta?.provider ?? null;
  const workspaceHeaderProvider = resolveWorkspaceHeaderProvider(
    activeTaskProvider,
    selectedProvider,
  );
  const activeTaskBaseTitle = resolvedActiveTaskMeta?.title?.trim()
    ? resolvedActiveTaskMeta.title
    : intl.formatMessage({
        id: resolvedActiveTaskMeta?.forkedFromTaskId
          ? "taskList.forkedUntitled"
          : "taskList.newThread",
      });
  const activeTaskTitle = activeTaskBaseTitle;
  const taskNativeSessionLogFile = useTaskNativeSessionLogFile(
    workspaceAbsPath,
    activeTaskId,
    activeTaskProvider,
    workspaceIdentity,
  );
  const taskSessionFile = useTaskSessionFilePath(workspaceAbsPath, activeTaskId, workspaceIdentity);

  return {
    activeTaskMeta,
    resolvedActiveTaskMeta,
    activeTraceId,
    activeSessionId,
    activeTaskProvider,
    workspaceHeaderProvider,
    activeTaskChangeSummary,
    activeTaskTitle,
    taskNativeSessionLogFile,
    taskSessionFile,
  };
}
