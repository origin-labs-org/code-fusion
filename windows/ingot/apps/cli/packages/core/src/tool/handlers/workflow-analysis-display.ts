// ============================================================
// ============================================================
//

import {
  CREATE_WORKFLOW_TOOL_NAME,
  type CreateWorkflowCausalityGraph,
  type CreateWorkflowOutput,
  type ToolResultDisplayPayload,
} from "@origin-ai/cf-contracts";
import type { AnalyzeResult } from "@origin-ai/cf-dynamic-workflow";
import { createCreateWorkflowDisplay } from "../executor/result-display.js";
import { boundCausalityGraph } from "./create-workflow-graph-bounds.js";

export function boundGraphOfAnalysis(
  analysis: AnalyzeResult,
): CreateWorkflowCausalityGraph | undefined {
  return analysis.causality === undefined
    ? undefined
    : boundCausalityGraph(analysis.causality, analysis.flow, analysis.handoff);
}

export function displayOfAnalysis(
  analysis: AnalyzeResult,
  toolName: string = CREATE_WORKFLOW_TOOL_NAME,
): ToolResultDisplayPayload | undefined {
  const causalityGraph = boundGraphOfAnalysis(analysis);
  return createCreateWorkflowDisplay(toolName, {
    diagnostics: analysis.diagnostics,
    ok: analysis.ok,
    response: "",
    ...(causalityGraph === undefined ? {} : { causalityGraph }),
  } satisfies CreateWorkflowOutput);
}
