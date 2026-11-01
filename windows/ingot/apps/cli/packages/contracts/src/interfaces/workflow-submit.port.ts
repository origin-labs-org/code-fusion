// ============================================================
// Workflow Submit Port - actor terminal-result verdict boundary
// ============================================================

import type { TraceContext } from "../tracing/tracer.js";
import type { ToolCallId } from "./shared.js";

export interface SubmitViolation {
  
  path: string;
  
  expected: string;
  
  got: string;
}

export interface SubmitResultRequest {
  
  toolCallId: ToolCallId | string;
  
  result: unknown;
  trace: TraceContext;
}

export interface SubmitAccepted {
  accept: true;
}

export interface SubmitRejected {
  accept: false;
  violations: readonly SubmitViolation[];
}

export type SubmitVerdict = SubmitAccepted | SubmitRejected;

export interface WorkflowSubmitPort {
  
  respond(request: SubmitResultRequest): Promise<SubmitVerdict>;
}
