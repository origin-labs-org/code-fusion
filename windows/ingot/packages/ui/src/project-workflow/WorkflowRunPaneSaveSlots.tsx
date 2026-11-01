// 「Saving the run, and running it again」）。
//
import { useCallback, useMemo, type ReactNode } from "react";
import type { ConversationRow, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  WorkflowRunSaveSlotsBoundary,
  type WorkflowRunSaveSlots,
  type WorkflowRunSaveSlotsHost,
} from "@/project-workflow/WorkflowRunSaveControls.js";
import type { WorkflowRunSidePaneTab } from "@/lib/workspaceSidePane.js";
import { logger } from "@/logger.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { buildWorkflowSaveCandidatesByRunId } from "@/v4/workflowRunCardJoin.js";
import { useDynamicWorkflowAvailability } from "@/hooks/useDynamicWorkflowAvailability.js";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

interface WorkflowRunPaneSaveParams {
  
  rows: readonly ConversationRow[] | undefined;
  run: WorkflowRunState | undefined;
  tab: WorkflowRunSidePaneTab;
}

export function WorkflowRunPaneSaveSlots({
  children,
  ...params
}: WorkflowRunPaneSaveParams & {
  children: (slots: WorkflowRunSaveSlots | null) => ReactNode;
}) {
  const host = useWorkflowRunPaneSaveHost(params);
  return <WorkflowRunSaveSlotsBoundary host={host}>{children}</WorkflowRunSaveSlotsBoundary>;
}

function useWorkflowRunPaneSaveHost(params: WorkflowRunPaneSaveParams): WorkflowRunSaveSlotsHost {
  const { rows, run, tab } = params;
  const { enabled } = useDynamicWorkflowAvailability();
  const { sendCommand } = useV4Conversation();
  const candidates = useMemo(
    () => buildWorkflowSaveCandidatesByRunId(rows).get(tab.runId),
    [rows, tab.runId],
  );
  const sendLead = useCallback(
    async (text: string) => {
      const ack = await sendCommand(
        createCommandEnvelope({
          type: "sendText",
          payload: { text },
          sessionId: tab.parentSessionId,
        }),
      );
      if (ack.status !== "accepted") {
        logger.warn("[workflow-run] The message handed to CodeFusion for refinement and saving was rejected", {
          reasonCode: ack.reasonCode ?? null,
          runId: tab.runId,
          status: ack.status,
        });
        throw new Error(ack.reasonCode ?? ack.status);
      }
    },
    [sendCommand, tab.parentSessionId, tab.runId],
  );
  return {
    sessionId: tab.parentSessionId,
    workspacePath: tab.workspacePath,
    ...(tab.workspaceIdentity === undefined ? {} : { workspaceIdentity: tab.workspaceIdentity }),
    ...(tab.remoteSessionId === undefined ? {} : { remoteSessionId: tab.remoteSessionId }),
    runId: tab.runId,
    ...(tab.workflowName?.trim() ? { runName: tab.workflowName.trim() } : {}),
    ...(candidates === undefined ? {} : { candidates }),
    canSave: enabled && run?.status === "completed",
    sendLead,
    verbWord: "never",
  };
}
