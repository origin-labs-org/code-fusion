import { workflowRunStepCounts, type WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";
import { workflowSubagentModelCardLabel } from "./subagent-model-label.js";
import type { WorkflowTimelineModel } from "./timeline-model.js";

type FormatMessage = (
  descriptor: { id: string },
  values?: Record<string, string | number>,
) => string;

export interface TimelineCounts {
  phases: number;
  
  agents: number;
  steps: number;
}

export function timelineCounts(
  model: WorkflowTimelineModel,
  graph: WorkflowCausalityGraphData | undefined,
): TimelineCounts {
  const lanes = new Set<string>();
  for (const station of model.stations) {
    for (const pill of station.pills) if (pill.laneClass === "agent") lanes.add(pill.lane.id);
  }
  const agents = model.draft?.agents ?? lanes.size;
  return { agents, phases: model.stations.length, steps: graph?.steps.length ?? 0 };
}

export function timelineRounds(model: WorkflowTimelineModel): number {
  let rounds = 0;
  for (const station of model.stations) {
    if (station.onLoop && station.rounds > rounds) rounds = station.rounds;
  }
  return rounds;
}

function count(format: FormatMessage, one: string, many: string, value: number): string {
  return format({ id: value === 1 ? one : many }, { count: value.toLocaleString() });
}

export function workflowPhasesDetail(
  format: FormatMessage,
  model: WorkflowTimelineModel,
  graph: WorkflowCausalityGraphData | undefined,
): string {
  const counts = timelineCounts(model, graph);
  const holes = model.stations.filter(
    (station) => station.hole !== undefined && station.hole.state !== "filled",
  ).length;
  const phases = count(
    format,
    "chat.toolCall.workflow.card.phase",
    "chat.toolCall.workflow.card.phases",
    counts.phases - holes,
  );
  return holes === 0
    ? phases
    : `${phases} · ${count(format, "chat.toolCall.workflow.card.hole", "chat.toolCall.workflow.card.holes", holes)}`;
}

function agentsPart(
  format: FormatMessage,
  model: WorkflowTimelineModel,
  run: WorkflowRunState | undefined,
): string {
  if (run !== undefined && (run.status === "pending" || run.status === "running")) {
    const working = run.actors.filter((actor) => actor.status === "running").length;
    return count(
      format,
      "chat.toolCall.workflow.card.agentWorking",
      "chat.toolCall.workflow.card.agentsWorking",
      working,
    );
  }
  const agents = Math.max(run?.actors.length ?? 0, timelineCounts(model, undefined).agents);
  return count(
    format,
    "chat.toolCall.workflow.card.agent",
    "chat.toolCall.workflow.card.agents",
    agents,
  );
}

export function workflowHeaderDetail(
  format: FormatMessage,
  model: WorkflowTimelineModel,
  graph: WorkflowCausalityGraphData | undefined,
  run: WorkflowRunState | undefined,
  
  subagentModelName?: string,
): string {
  const parts = [workflowPhasesDetail(format, model, graph), agentsPart(format, model, run)];
  if (subagentModelName !== undefined) {
    parts.push(subagentModelName);
  }
  return parts.join(" · ");
}

export function workflowCardDetail(
  format: FormatMessage,
  model: WorkflowTimelineModel | undefined,
  graph: WorkflowCausalityGraphData | undefined,
  run: WorkflowRunState | undefined,
  
  providerName?: (providerId: string) => string | undefined,
): { detail: string; title?: string } | undefined {
  if (model === undefined) {
    return undefined;
  }
  const subagentModel = workflowSubagentModelCardLabel(run?.subagentModel, {
    formatMessage: format,
    ...(providerName === undefined ? {} : { providerName }),
  });
  return {
    detail: workflowHeaderDetail(format, model, graph, run, subagentModel?.name),
    ...(subagentModel === undefined ? {} : { title: subagentModel.title }),
  };
}

export function workflowSummaryParts(
  format: FormatMessage,
  model: WorkflowTimelineModel,
  run: WorkflowRunState,
  options: {
    tokens?: boolean;
    
    subagentModelName?: string;
  } = {},
): string[] {
  const parts: string[] = [];
  if (options.subagentModelName !== undefined) {
    parts.push(
      format(
        { id: "chat.toolCall.workflow.run.subagentModel.label" },
        { model: options.subagentModelName },
      ),
    );
  }
  const active = run.status === "pending" || run.status === "running";
  if (active) {
    const working = run.actors.filter((actor) => actor.status === "running").length;
    parts.push(
      count(
        format,
        "chat.toolCall.workflow.card.agentWorking",
        "chat.toolCall.workflow.card.agentsWorking",
        working,
      ),
    );
  } else {
    const agents = Math.max(run.actors.length, timelineCounts(model, undefined).agents);
    parts.push(
      count(
        format,
        "chat.toolCall.workflow.card.agent",
        "chat.toolCall.workflow.card.agents",
        agents,
      ),
    );
  }
  const { settled, total } = workflowRunStepCounts(run);
  parts.push(format({ id: "chat.toolCall.workflow.card.steps" }, { done: settled, total }));
  if (options.tokens !== false) {
    parts.push(
      format(
        { id: "chat.toolCall.workflow.card.tokens" },
        { count: run.usage.spentTokens.toLocaleString() },
      ),
    );
  }
  const rounds = timelineRounds(model);
  if (rounds >= 2) {
    parts.push(
      active
        ? format({ id: "chat.toolCall.workflow.card.round" }, { count: rounds })
        : format({ id: "chat.toolCall.workflow.card.rounds" }, { count: rounds }),
    );
  }
  const artifacts = run.artifacts?.length ?? 0;
  if (artifacts > 0) {
    parts.push(
      count(
        format,
        "chat.toolCall.workflow.card.artifact",
        "chat.toolCall.workflow.card.artifacts",
        artifacts,
      ),
    );
  }
  return parts;
}
