import type { TurnHeaderRow, WorkflowNotificationMeta } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowRunCardSummary } from "@/ToolCallBlocks/fileSummaryTypes.js";

export type WorkflowTerminalNotification = Extract<WorkflowNotificationMeta, { kind: "terminal" }>;

export interface WorkflowTurnCompletion {
  runId: string;
  
  name: string;
  
  durationMs?: number;
  artifacts: NonNullable<WorkflowTerminalNotification["artifacts"]>;
  
  artifactsTruncated: boolean;
  
  summary: WorkflowRunCardSummary | undefined;
}

export function resolveWorkflowTurnCompletion(
  header: TurnHeaderRow | undefined,
  join: { byRunId?: ReadonlyMap<string, WorkflowRunCardSummary> },
): WorkflowTurnCompletion | undefined {
  if (header?.origin !== "backgroundResult") return undefined;
  const originMeta = header.originMeta;
  if (originMeta?.backgroundSource !== "workflow") return undefined;
  const notification = originMeta.workflowNotification;
  if (notification?.kind !== "terminal" || notification.status !== "completed") return undefined;
  const name = originMeta.title.trim();
  if (name.length === 0) return undefined;
  return {
    runId: originMeta.workId,
    name,
    ...(notification.durationMs === undefined ? {} : { durationMs: notification.durationMs }),
    artifacts: notification.artifacts ?? [],
    artifactsTruncated: notification.artifactsTruncated === true,
    summary: join.byRunId?.get(originMeta.workId),
  };
}
