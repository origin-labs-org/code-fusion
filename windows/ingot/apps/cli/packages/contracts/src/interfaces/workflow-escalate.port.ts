// ============================================================
// ============================================================

import type { TraceContext } from "../tracing/tracer.js";
import type { ToolCallId } from "./shared.js";

export interface EscalateQuestionRequest {
  
  toolCallId: ToolCallId | string;
  
  question: string;
  
  context?: string;
  trace: TraceContext;
}

export type WorkflowEscalateOutcome =
  | {
      kind: "answered";
      
      answer: string;
      
      qid: string;
    }
  | {
      kind: "refused";
      
      reason: "budget_exhausted" | "no_active_ask";
      
      message: string;
    };

export interface WorkflowEscalatePort {
  
  escalate(request: EscalateQuestionRequest): Promise<WorkflowEscalateOutcome>;
}
