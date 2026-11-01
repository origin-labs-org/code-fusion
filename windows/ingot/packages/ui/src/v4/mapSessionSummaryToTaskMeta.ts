import type { TraceId, CfProvider, CfTaskMeta } from "@origin-ai/cf-shared";
import type { SessionSummary } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  attachTaskListRowActivity,
  type TaskListMetaWithActivity,
} from "@/v4/taskListRowActivity.js";

function phaseToStatus(phase: SessionSummary["phase"]): CfTaskMeta["status"] {
  switch (phase) {
    case "running":
    case "prewarming":
      return "running";
    case "completedSuccess":
    case "completedInterrupted":
      return "completed";
    case "error":
      return "error";
    default:
      return undefined; // draft
  }
}

export interface MapSessionSummaryOptions {
  workspacePath: string;
  workspaceIdentity?: string;
  
  previous?: CfTaskMeta;
}

export function mapSessionSummaryToTaskMeta(
  summary: SessionSummary,
  options: MapSessionSummaryOptions,
): TaskListMetaWithActivity {
  const previous = options.previous;
  const status = phaseToStatus(summary.phase);
  const summaryTitleIsCustom = summary.titleSource === "custom";
  const title =
    previous?.titleOverridden === true && !summaryTitleIsCustom
      ? previous.title
      : summary.title || previous?.title || "";
  const titleOverridden =
    summaryTitleIsCustom || previous?.titleOverridden === true
      ? true
      : undefined;
  return attachTaskListRowActivity(
    {
      taskId: summary.sessionId,
      traceId: (previous?.traceId ?? `session-${summary.sessionId}`) as TraceId,
      title,
      ...(titleOverridden ? { titleOverridden } : {}),
      workspacePath: options.workspacePath,
      ...(options.workspaceIdentity
        ? { workspaceIdentity: options.workspaceIdentity }
        : {}),
      createdAt: summary.createdAt || previous?.createdAt || 0,
      updatedAt: summary.lastActivityAt || previous?.updatedAt || 0,
      mode: previous?.mode ?? "default",
      ...(previous?.model ? { model: previous.model } : {}),
      ...(summary.parentSessionId
        ? { forkedFromTaskId: summary.parentSessionId }
        : {}),
      ...(previous?.provider
        ? { provider: previous.provider as CfProvider }
        : {}),
      ...(status ? { status } : {}),
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
      ...(previous?.unreadAt ? { unreadAt: previous.unreadAt } : {}),
    },
    {
      phase: summary.phase,
      lastActivityAt: summary.lastActivityAt,
      hasBackgroundWork: summary.hasBackgroundWork,
      ...(summary.pendingInteractionSummary
        ? { pendingInteractions: summary.pendingInteractionSummary }
        : {}),
      ...(summary.workflowActivity ? { workflowActivity: summary.workflowActivity } : {}),
    },
  );
}
