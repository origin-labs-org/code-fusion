// ============================================================
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionConfigState, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  useWorkflowRunSettingsPopoverState,
  type WorkflowRunSettingsAccepted,
  type WorkflowRunSettingsHost,
} from "@/components/workflow-timeline/WorkflowRunSettingsPopover.js";
import {
  isWorkflowRunConfigurable,
  workflowSessionModelOf,
} from "@/components/workflow-timeline/workflowRunSettings.js";
import type {
  OpenScopedWorkflowRunSideTabRequest,
  WorkflowRunSidePaneTab,
} from "@/lib/workspaceSidePane.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import type { useV4Conversation } from "@/v4/V4ConversationContext.js";

export function workflowRunTabScope(
  tab: Pick<WorkflowRunSidePaneTab, "workspacePath" | "workspaceIdentity" | "remoteSessionId">,
): Pick<
  OpenScopedWorkflowRunSideTabRequest,
  "workspacePath" | "workspaceIdentity" | "remoteSessionId"
> {
  return {
    workspacePath: tab.workspacePath,
    ...(tab.workspaceIdentity ? { workspaceIdentity: tab.workspaceIdentity } : {}),
    ...(tab.remoteSessionId ? { remoteSessionId: tab.remoteSessionId } : {}),
  };
}

export function useWorkflowRunPaneSettings({
  enabled,
  onOpenWorkflowRun,
  run,
  runs,
  sendCommand,
  sessionConfig,
  tab,
}: {
  
  enabled: boolean;
  onOpenWorkflowRun?: (request: OpenScopedWorkflowRunSideTabRequest) => void;
  run: WorkflowRunState | undefined;
  runs: readonly WorkflowRunState[] | undefined;
  sendCommand: ReturnType<typeof useV4Conversation>["sendCommand"];
  sessionConfig: SessionConfigState | undefined;
  tab: WorkflowRunSidePaneTab;
}) {
  const configurable = enabled && isWorkflowRunConfigurable(run);
  const popover = useWorkflowRunSettingsPopoverState();
  const { setOpen } = popover;
  useEffect(() => {
    if (!configurable) setOpen(false);
  }, [configurable, setOpen]);
  const sessionModel = useMemo(() => workflowSessionModelOf(sessionConfig), [sessionConfig]);
  const host = useMemo<WorkflowRunSettingsHost>(
    () => ({
      ...workflowRunTabScope(tab),
      ...(sessionModel === undefined ? {} : { sessionModel }),
      apply: (change) =>
        sendCommand(
          createCommandEnvelope({
            type: "amendWorkflowRunSettings",
            payload: { workId: tab.runId, ...change },
            sessionId: tab.parentSessionId,
          }),
        ),
    }),
    [
      sendCommand,
      sessionModel,
      tab.parentSessionId,
      tab.remoteSessionId,
      tab.runId,
      tab.workspaceIdentity,
      tab.workspacePath,
    ],
  );

  const [follow, setFollow] = useState<WorkflowRunSettingsAccepted | undefined>(undefined);
  const onAccepted = useCallback(
    (accepted: WorkflowRunSettingsAccepted) => {
      if (accepted.runId !== tab.runId) setFollow(accepted);
    },
    [tab.runId],
  );
  const successorArrived =
    follow !== undefined && (runs ?? []).some((candidate) => candidate.runId === follow.runId);
  useEffect(() => {
    if (follow === undefined || !successorArrived) return;
    setFollow(undefined);
    onOpenWorkflowRun?.({
      ...workflowRunTabScope(tab),
      parentSessionId: tab.parentSessionId,
      toolCallId: follow.toolCallId,
      runId: follow.runId,
      ...(tab.workflowName ? { workflowName: tab.workflowName } : {}),
      replaceRunId: tab.runId,
    });
  }, [
    follow,
    onOpenWorkflowRun,
    successorArrived,
    tab.parentSessionId,
    tab.remoteSessionId,
    tab.runId,
    tab.workflowName,
    tab.workspaceIdentity,
    tab.workspacePath,
  ]);

  return {
    configurable,
    host,
    onAccepted,
    popover,
  };
}
