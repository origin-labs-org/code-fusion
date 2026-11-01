// ============================================================
// ============================================================

import type { TraceContext } from "../tracing/tracer.js";

export interface DynamicWorkflowSnippetDiagnostic {
  code: number;
  column: number;
  line: number;
  message: string;
}

export interface DynamicWorkflowSnippetEvalRequest {
  
  code: string;
  
  cwd: string;
  
  timeoutMs: number;
  trace: TraceContext;
}

export interface DynamicWorkflowSnippetEvalOptions {
  signal?: AbortSignal;
}

export type DynamicWorkflowSnippetEvalResult =
  | { kind: "diagnostics"; diagnostics: DynamicWorkflowSnippetDiagnostic[] }
  | { kind: "completed"; artifact?: unknown; logs: string[]; logsTruncated: boolean }
  | {
      kind: "failed";
      error: { code: string; message: string };
      logs: string[];
      logsTruncated: boolean;
    };

export interface DynamicWorkflowSnippetPort {
  
  evalSnippet(
    request: DynamicWorkflowSnippetEvalRequest,
    options?: DynamicWorkflowSnippetEvalOptions,
  ): Promise<DynamicWorkflowSnippetEvalResult>;
}
