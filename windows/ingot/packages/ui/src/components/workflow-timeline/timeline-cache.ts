import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowCausalityGraphData } from "@/components/workflow-graph/types.js";

const BY_RUN = new WeakMap<object, WeakMap<object, unknown>>();

const NO_RUN: object = {};

export function sharedTimelineModel<Model>(
  graph: WorkflowCausalityGraphData,
  run: WorkflowRunState | undefined,
  build: () => Model,
): Model {
  const runKey: object = run ?? NO_RUN;
  let byGraph = BY_RUN.get(runKey);
  if (byGraph === undefined) {
    byGraph = new WeakMap<object, unknown>();
    BY_RUN.set(runKey, byGraph);
  }
  if (byGraph.has(graph)) return byGraph.get(graph) as Model;
  const model = build();
  byGraph.set(graph, model);
  return model;
}
