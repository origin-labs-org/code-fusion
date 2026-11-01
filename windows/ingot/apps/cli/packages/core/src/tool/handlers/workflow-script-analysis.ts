// ============================================================
// ============================================================
//
//

import { analyzeWorkflowScript, type AnalyzeResult } from "@origin-ai/cf-dynamic-workflow";

let lastAnalysis: { script: string; result: AnalyzeResult } | null = null;

export function analyzeScript(script: string): AnalyzeResult {
  if (lastAnalysis?.script === script) return lastAnalysis.result;
  const result = analyzeWorkflowScript(script);
  lastAnalysis = { script, result };
  return result;
}
