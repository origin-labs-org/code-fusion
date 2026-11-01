import type {
  WorkflowLaunchMeta,
  WorkflowSettingsAmendMeta,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import type { WorkflowRunCardSummary } from "@/ToolCallBlocks/fileSummaryTypes.js";
import { readWorkflowName } from "@/ToolCallBlocks/renderers/createWorkflowInput.js";
import type { AssistantWorkRow } from "@/v4/conversationTurnFlowItems.js";
import type { WorkflowFillGraph } from "@/v4/workflowRunCardJoin.js";

export interface WorkflowTurnDigest {
  key: string;
  
  toolCallId: string;
  runId: string;
  
  name: string | undefined;
  graph: WorkflowCausalityGraphData | undefined;
  
  holeLabels?: WorkflowFillGraph["holeLabels"];
  
  summary: WorkflowRunCardSummary | undefined;
  
  settings?: { amend: WorkflowSettingsAmendMeta; at?: number };
  
  rowOnly?: true;
}

interface WorkflowTurnDigestSource {
  workflowLaunch?: WorkflowLaunchMeta;
  assistantWorkRows: readonly AssistantWorkRow[];
  
  startedAt?: number;
}

interface WorkflowTurnDigestJoin {
  byToolCallId?: ReadonlyMap<string, WorkflowRunCardSummary>;
  byRunId?: ReadonlyMap<string, WorkflowRunCardSummary>;
  graphByToolCallId?: ReadonlyMap<string, WorkflowCausalityGraphData>;
  
  fillGraphByRunId?: ReadonlyMap<string, WorkflowFillGraph>;
}

export function resolveWorkflowTurnDigests(
  unit: WorkflowTurnDigestSource,
  join: WorkflowTurnDigestJoin,
): WorkflowTurnDigest[] {
  const digests: WorkflowTurnDigest[] = [];
  const seen = new Set<string>();
  const graphOf = (originToolCallId: string | undefined, runId: string) =>
    join.fillGraphByRunId?.get(runId)?.graph ??
    (originToolCallId === undefined ? undefined : join.graphByToolCallId?.get(originToolCallId));

  const launch = unit.workflowLaunch;
  if (launch !== undefined) {
    const rowOnly = launch.amend !== undefined && launch.amend.predecessorRunId === undefined;
    if (!rowOnly) seen.add(launch.runId);
    digests.push({
      graph: graphOf(launch.toolCallId, launch.runId),
      ...(join.fillGraphByRunId?.get(launch.runId) === undefined
        ? {}
        : { holeLabels: join.fillGraphByRunId.get(launch.runId)!.holeLabels }),
      key: `launch:${launch.toolCallId}`,
      name: launch.name,
      runId: launch.runId,
      summary: join.byRunId?.get(launch.runId),
      toolCallId: launch.toolCallId,
      ...(rowOnly ? { rowOnly: true as const } : {}),
      ...(launch.amend === undefined
        ? {}
        : {
            settings: {
              amend: launch.amend,
              ...(unit.startedAt === undefined ? {} : { at: unit.startedAt }),
            },
          }),
    });
  }

  for (const row of unit.assistantWorkRows) {
    if (row.kind !== "toolCall") continue;
    const created = join.byToolCallId?.get(row.toolCallId);
    if (created !== undefined) {
      if (seen.has(created.runId)) continue;
      seen.add(created.runId);
      digests.push({
        graph: graphOf(row.toolCallId, created.runId),
        ...(join.fillGraphByRunId?.get(created.runId) === undefined
          ? {}
          : { holeLabels: join.fillGraphByRunId.get(created.runId)!.holeLabels }),
        key: `${row.rowId}:${row.toolCallId}`,
        name: readWorkflowName(row.input),
        runId: created.runId,
        summary: created,
        toolCallId: row.toolCallId,
      });
      continue;
    }
    if (row.display?.kind !== "resume_workflow_run") continue;
    const runId = row.display.runId;
    if (seen.has(runId)) continue;
    seen.add(runId);
    const resumed = join.byRunId?.get(runId);
    digests.push({
      graph: graphOf(resumed?.toolCallId, runId),
      ...(join.fillGraphByRunId?.get(runId) === undefined
        ? {}
        : { holeLabels: join.fillGraphByRunId.get(runId)!.holeLabels }),
      key: `${row.rowId}:${row.toolCallId}`,
      name: undefined,
      runId,
      summary: resumed,
      toolCallId: row.toolCallId,
    });
  }
  return digests;
}
