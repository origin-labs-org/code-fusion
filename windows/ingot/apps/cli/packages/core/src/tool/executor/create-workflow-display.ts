

import {
  AMEND_WORKFLOW_TOOL_NAME,
  CREATE_WORKFLOW_DISPLAY_MAX_DIAGNOSTICS,
  CREATE_WORKFLOW_DISPLAY_MAX_MESSAGE_CHARS,
  CREATE_WORKFLOW_TOOL_NAME,
  CreateWorkflowOutputSchema,
  FILL_WORKFLOW_HOLE_TOOL_NAME,
  type ToolResultDisplayPayload,
} from "@origin-ai/cf-contracts";

const CREATE_WORKFLOW_DISPLAY_TOOL_NAMES: ReadonlySet<string> = new Set([
  CREATE_WORKFLOW_TOOL_NAME,
  AMEND_WORKFLOW_TOOL_NAME,
  FILL_WORKFLOW_HOLE_TOOL_NAME,
]);

export function createCreateWorkflowDisplay(
  toolName: string,
  output: unknown,
): ToolResultDisplayPayload | undefined {
  if (!CREATE_WORKFLOW_DISPLAY_TOOL_NAMES.has(toolName)) return undefined;
  const parsed = CreateWorkflowOutputSchema.safeParse(output);
  if (!parsed.success) return undefined;
  if (parsed.data.retuned !== undefined) return undefined;

  const { causalityGraph, diagnostics, fill, ok } = parsed.data;
  const errorCount = diagnostics.length;
  const bounded = diagnostics
    .slice(0, CREATE_WORKFLOW_DISPLAY_MAX_DIAGNOSTICS)
    .map((diagnostic) => ({
      line: diagnostic.line,
      column: diagnostic.column,
      code: diagnostic.code,
      message: diagnostic.message.slice(0, CREATE_WORKFLOW_DISPLAY_MAX_MESSAGE_CHARS),
    }));
  const truncated = errorCount > bounded.length;

  return {
    kind: "create_workflow",
    ok,
    errorCount,
    diagnostics: bounded,
    ...(causalityGraph === undefined ? {} : { causalityGraph }),
    ...(truncated ? { truncated: true } : {}),
    ...(fill === undefined ? {} : { fill }),
  };
}
