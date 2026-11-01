import type { ToolCallCreateWorkflowCausalityGraph } from "@origin-ai/cf-shared/cf-protocol-v4";

/**
 * The graph the renderer consumes is exactly the bounded display payload from the
 * CreateWorkflow tool — one vocabulary from analyzer to pixels. A future live runtime
 * view reuses the same component by feeding `statuses` (and flipping `animatedEdges`);
 * absence of both renders the static analysis picture.
 *
 * The whole visual vocabulary, deliberately small
 *
 *   a module = a phase · a card = a participant (a subagent, or the workspace, in that
 *   phase) · a collapsed module = a deck of its participants' cards · an arrow = "runs
 *   after" · a terminal dot = the returned artifact
 * Hand-off arrows inside a module are causality facts quotiented by participant; arrows
 * between modules are control flow (the CFG's phase quotient); both are the same arrow.
 * `back` marks a loop's back edge for ranking only — same ink. Steps and lanes stay in the
 * payload as the run-status join key and the inspector's material; neither is drawn.
 */
export type WorkflowCausalityGraphData = ToolCallCreateWorkflowCausalityGraph;
export type WorkflowStepData = WorkflowCausalityGraphData["steps"][number];
export type WorkflowLaneData = WorkflowCausalityGraphData["lanes"][number];
export type WorkflowParticipantData = WorkflowCausalityGraphData["participants"][number];
export type WorkflowHandoffData = WorkflowCausalityGraphData["handoffs"][number];

export type WorkflowPhaseData = NonNullable<WorkflowCausalityGraphData["phases"]>[number];
export type WorkflowPhaseEdgeData = NonNullable<WorkflowCausalityGraphData["phaseEdges"]>[number];

/** Per-step run state for the live-execution view; keyed by step id. */
export type StepRunStatus = "pending" | "running" | "done" | "failed";

export type StepStatusTable = Partial<Record<string, StepRunStatus>>;

export type WorkflowGraphSelectionKind = "participant" | "phase" | "sink";
export interface WorkflowCausalityGraphSelection {
  id: string;
  kind: WorkflowGraphSelectionKind;
  line?: number;
}

/** The single lane every `files.*` read runs in. */
export const WORKSPACE_LANE_ID = "workspace";
/** Lane of an ask whose receiver the analysis could not resolve to an actor site. */
export const UNKNOWN_LANE_ID = "unknown";

export const MAIN_LANE_ID = "main";
/** The terminal marker node: the artifact the workflow returns. */
export const SINK_NODE_ID = "sink";

export const UNPHASED_PHASE_ID = "unphased";

export const IMPLICIT_PHASE_ID = "workflow";

/**
 * What a lane IS, which is the only thing colour encodes in this view. `workspace` is
 * not an actor (no mailbox, hence no `fifo`) and `unresolved` is an ask whose receiver
 * the analysis could not site — both are real distinctions. Per-actor identity is
 * carried by the name on the card, not by a tint.
 *
 * It lives here, next to the ids it is derived from, because both the projection and the
 * naming policy (lane-name.ts) key on it.
 */
export type LaneClass = "agent" | "workspace" | "unresolved";

export function laneClassOf(laneId: string): LaneClass {
  if (laneId === WORKSPACE_LANE_ID) return "workspace";
  if (laneId === UNKNOWN_LANE_ID) return "unresolved";
  return "agent";
}

export function isSyntheticLaneId(id: string): boolean {
  return id === WORKSPACE_LANE_ID || id === UNKNOWN_LANE_ID || id === MAIN_LANE_ID;
}
