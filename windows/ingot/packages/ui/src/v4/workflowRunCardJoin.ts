import { workflowRunStepCounts, type WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  CF_WORKFLOWS_FOR_RUN_MAX_CANDIDATES,
  type CfWorkflowsForRunCandidate,
} from "@origin-ai/cf-shared";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import type { WorkflowRunCardSummary } from "@/ToolCallBlocks/shared.js";
import { readWorkflowHoleTarget } from "@/ToolCallBlocks/renderers/createWorkflowHoleInput.js";
import { isFillWorkflowHoleToolCall } from "@/lib/workflowToolNames.js";

export function buildWorkflowRunByToolCallId(
  runs: readonly WorkflowRunState[] | undefined,
): ReadonlyMap<string, WorkflowRunCardSummary> {
  const byToolCallId = new Map<string, WorkflowRunCardSummary>();
  for (const run of runs ?? []) {
    if (!run.toolCallId) continue;
    const { settled, total } = workflowRunStepCounts(run);
    byToolCallId.set(run.toolCallId, {
      runId: run.runId,
      status: run.status,
      ...(run.stopReason === undefined ? {} : { stopReason: run.stopReason }),
      nodesSettled: settled,
      nodesTotal: total,
      agents: run.actors.length,
      run,
      ...(run.resumable === true ? { resumable: true as const } : {}),
    });
  }
  return byToolCallId;
}

export function buildWorkflowRunByRunId(
  runs: readonly WorkflowRunState[] | undefined,
): ReadonlyMap<string, WorkflowRunCardSummary> {
  const byRunId = new Map<string, WorkflowRunCardSummary>();
  for (const run of runs ?? []) {
    const { settled, total } = workflowRunStepCounts(run);
    byRunId.set(run.runId, {
      runId: run.runId,
      status: run.status,
      ...(run.stopReason === undefined ? {} : { stopReason: run.stopReason }),
      nodesSettled: settled,
      nodesTotal: total,
      agents: run.actors.length,
      run,
      ...(run.resumable === true ? { resumable: true as const } : {}),
      ...(run.toolCallId ? { toolCallId: run.toolCallId } : {}),
    });
  }
  return byRunId;
}

export function resolveWorkflowRunOpenToolCallId(
  rowToolCallId: string,
  workflowRun: WorkflowRunCardSummary | undefined,
): string {
  return workflowRun?.toolCallId ?? rowToolCallId;
}

export function buildWorkflowRunPendingQuestionsByRunId(
  runs: readonly WorkflowRunState[] | undefined,
): ReadonlyMap<string, ReadonlySet<string>> {
  const byRunId = new Map<string, ReadonlySet<string>>();
  for (const run of runs ?? []) {
    byRunId.set(run.runId, new Set((run.pendingQuestions ?? []).map((question) => question.qid)));
  }
  return byRunId;
}

function workflowGraphOfRow(
  row: ConversationRow,
): { toolCallId: string; graph: WorkflowCausalityGraphData } | undefined {
  if (row.kind === "toolCall") {
    const display = row.display;
    if (display?.kind !== "create_workflow") return undefined;
    const graph = display.causalityGraph;
    return graph !== undefined && graph.steps.length > 0
      ? { toolCallId: row.toolCallId, graph }
      : undefined;
  }
  if (row.kind === "turnHeader" || row.kind === "userInput") {
    const launch = row.workflowLaunch;
    const display = launch?.display;
    if (launch === undefined || display?.kind !== "create_workflow") return undefined;
    const graph = display.causalityGraph;
    return graph !== undefined && graph.steps.length > 0
      ? { toolCallId: launch.toolCallId, graph }
      : undefined;
  }
  return undefined;
}

export function buildWorkflowGraphByToolCallId(
  rows: readonly ConversationRow[] | undefined,
): ReadonlyMap<string, WorkflowCausalityGraphData> {
  const byToolCallId = new Map<string, WorkflowCausalityGraphData>();
  for (const row of rows ?? []) {
    const found = workflowGraphOfRow(row);
    if (found !== undefined && !byToolCallId.has(found.toolCallId)) {
      byToolCallId.set(found.toolCallId, found.graph);
    }
  }
  return byToolCallId;
}

export interface WorkflowFillGraph {
  graph: WorkflowCausalityGraphData;
  holeLabels: ReadonlyMap<string, { name: string }>;
}

function readFillRow(
  row: ConversationRow,
): { runId: string; holeId: string; name?: string; graph: WorkflowCausalityGraphData } | undefined {
  if (row.kind !== "toolCall" || row.status !== "success") return undefined;
  if (!isFillWorkflowHoleToolCall(row)) return undefined;
  const display = row.display;
  if (display?.kind !== "create_workflow" || display.ok !== true) return undefined;
  const graph = display.causalityGraph;
  if (graph === undefined || graph.steps.length === 0) return undefined;
  const target = readWorkflowHoleTarget(row.input, display.fill);
  if (target?.runId === undefined || target.holeId === undefined) return undefined;
  return {
    runId: target.runId,
    holeId: target.holeId,
    ...(target.name === undefined ? {} : { name: target.name }),
    graph,
  };
}

export function buildWorkflowFillGraphByRunId(
  rows: readonly ConversationRow[] | undefined,
): ReadonlyMap<string, WorkflowFillGraph> {
  const byRunId = new Map<string, WorkflowFillGraph>();
  for (const row of rows ?? []) {
    const fill = readFillRow(row);
    if (fill === undefined) continue;
    const labels = new Map(byRunId.get(fill.runId)?.holeLabels ?? []);
    if (fill.name !== undefined) labels.set(fill.holeId, { name: fill.name });
    byRunId.set(fill.runId, { graph: fill.graph, holeLabels: labels });
  }
  return byRunId;
}

export function resolveWorkflowRunGraphForRun(
  graphs: ReadonlyMap<string, WorkflowCausalityGraphData>,
  fills: ReadonlyMap<string, WorkflowFillGraph> | undefined,
  toolCallId: string | undefined,
  runId: string | undefined,
  runs: readonly WorkflowRunState[] | undefined,
): WorkflowCausalityGraphData | undefined {
  const fill = runId === undefined ? undefined : fills?.get(runId);
  if (fill !== undefined) return fill.graph;
  return toolCallId === undefined ? undefined : resolveWorkflowRunGraph(graphs, toolCallId, runs);
}

export const WORKFLOW_SETTINGS_TOOL_CALL_PREFIX = "settings-";

export function resolveWorkflowRunGraph(
  graphs: ReadonlyMap<string, WorkflowCausalityGraphData>,
  toolCallId: string,
  runs: readonly WorkflowRunState[] | undefined,
): WorkflowCausalityGraphData | undefined {
  const visited = new Set<string>();
  let current: string | undefined = toolCallId;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const graph = graphs.get(current);
    if (graph !== undefined) return graph;
    if (!current.startsWith(WORKFLOW_SETTINGS_TOOL_CALL_PREFIX)) return undefined;
    const settingsToolCallId: string = current;
    const run: WorkflowRunState | undefined = runs?.find(
      (candidate) => candidate.toolCallId === settingsToolCallId,
    );
    const predecessorId: string | undefined = run?.resumedFrom;
    current =
      predecessorId === undefined
        ? undefined
        : runs?.find((candidate) => candidate.runId === predecessorId)?.toolCallId;
  }
  return undefined;
}

export type WorkflowSaveCandidate = CfWorkflowsForRunCandidate;

function readWorkflowSaveCandidate(
  row: ConversationRow,
): { runId: string; candidate: WorkflowSaveCandidate } | undefined {
  if (row.kind !== "toolCall" || row.toolName !== "SaveWorkflow" || row.status !== "success") {
    return undefined;
  }
  const input = row.input;
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const runId = typeof record.run_id === "string" ? record.run_id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (runId.length === 0 || name.length === 0) return undefined;
  const scope = record.scope === "global" || record.scope === "project" ? record.scope : undefined;
  return { runId, candidate: { name, ...(scope === undefined ? {} : { scope }) } };
}

export function buildWorkflowSaveCandidatesByRunId(
  rows: readonly ConversationRow[] | undefined,
): ReadonlyMap<string, readonly WorkflowSaveCandidate[]> {
  const byRunId = new Map<string, WorkflowSaveCandidate[]>();
  for (const row of rows ?? []) {
    const found = readWorkflowSaveCandidate(row);
    if (found === undefined) continue;
    const list = byRunId.get(found.runId) ?? [];
    if (list.some((entry) => entry.name === found.candidate.name)) continue;
    if (list.length >= CF_WORKFLOWS_FOR_RUN_MAX_CANDIDATES) continue;
    list.push(found.candidate);
    byRunId.set(found.runId, list);
  }
  return byRunId;
}
