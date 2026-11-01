// ============================================================
// ============================================================
// spec：docs/dynamic-workflow/launch.md「The `FillWorkflowHole` tool」；
// apps/cli/packages/dynamic-workflow/docs/execution-engine.md「Holes」。

import type { SessionId, ToolCallId } from "./shared.js";
import type { TraceContext } from "../tracing/tracer.js";

export interface DynamicWorkflowRunHole {
  
  siteId: string;
  
  ordinal: number;
  
  name: string;
  
  type: string;
  state: "waiting" | "filled";
  
  since?: number;
  
  filledAt?: number;
  
  filledBy?: string;
  
  line?: number;
  
  before?: string;
  
  after?: string;
}

export interface DynamicWorkflowRunFillHoleRequest {
  runId: string;
  
  holeId: string;
  body: string;
  
  parentSessionId?: SessionId | string;
  
  toolCallId?: ToolCallId | string;
  trace: TraceContext;
}

export type DynamicWorkflowRunFillHoleRefusalReason =
  
  | "run_not_found"
  
  | "hole_not_waiting"
  
  | "compile_failed"
  
  | "fill_ids_unstable";

export interface DynamicWorkflowRunFillHoleDiagnostic {
  line: number;
  column: number;
  message: string;
  code: number;
  inFill: boolean;
}

export type FillWorkflowHoleResult =
  | { ok: true; phasesAdded: string[]; scriptPath?: string; scriptText: string }
  | {
      ok: false;
      reason: DynamicWorkflowRunFillHoleRefusalReason;
      message: string;
      diagnostics?: DynamicWorkflowRunFillHoleDiagnostic[];
    };
