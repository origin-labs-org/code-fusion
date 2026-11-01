

export interface WorkspaceHookReviewIdentity {
  reviewFlowId: string;
  generation: number;
  interactionId: string;
}

export type WorkspaceHookReviewMonotonicityVerdict =
  | "no_current"
  | "same_flow_advance"
  | "same_flow_replay"
  | "same_flow_conflict"
  | "same_flow_stale"
  | "cross_flow";

export function verdictWorkspaceHookReviewRequest(
  current: WorkspaceHookReviewIdentity | undefined,
  candidate: WorkspaceHookReviewIdentity,
): WorkspaceHookReviewMonotonicityVerdict {
  if (!current) return "no_current";
  if (candidate.reviewFlowId !== current.reviewFlowId) return "cross_flow";
  if (candidate.generation > current.generation) return "same_flow_advance";
  if (candidate.generation < current.generation) return "same_flow_stale";
  return candidate.interactionId === current.interactionId
    ? "same_flow_replay"
    : "same_flow_conflict";
}
