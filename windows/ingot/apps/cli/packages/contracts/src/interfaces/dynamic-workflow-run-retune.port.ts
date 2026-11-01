// ============================================================
// ============================================================

export interface DynamicWorkflowRunRetuneRequest {
  runId: string;
  
  maxConcurrency: number | null;
}

export type DynamicWorkflowRunRetuneRefusalReason = "not_live" | "unchanged";

export type DynamicWorkflowRunRetuneResult =
  | { ok: true; maxConcurrency: number; previous: number; defaultConcurrency: number }
  | {
      ok: false;
      reason: DynamicWorkflowRunRetuneRefusalReason;
      
      current?: number;
    };
