import {
  toolCallCreateWorkflowDisplaySchema,
  type ToolCallCreateWorkflowDisplay,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { isPlainRecord } from "@/ToolCallBlocks/renderers/createWorkflowInput.js";

export function readWorkflowDisplay(raw: unknown): ToolCallCreateWorkflowDisplay | null {
  if (!isPlainRecord(raw)) {
    return null;
  }

  const parsed = toolCallCreateWorkflowDisplaySchema.safeParse(raw.display);
  return parsed.success ? parsed.data : null;
}

export function readFallbackOutputText(output: unknown): string | null {
  if (typeof output === "string") {
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (isPlainRecord(output)) {
    for (const key of ["response", "output", "text", "content"] as const) {
      const candidate = output[key];
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return null;
}

interface WorkflowDiagnosticPosition {
  line: number;
  column: number;
  message: string;
}

export function formatWorkflowFeedbackTooltip(
  lede: string,
  diagnostics: readonly WorkflowDiagnosticPosition[],
): string {
  return [
    lede,
    ...diagnostics.map(
      (diagnostic) => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`,
    ),
  ].join("\n");
}

export function workflowDiagnosticLines(
  diagnostics: readonly WorkflowDiagnosticPosition[],
): number[] {
  const lines = diagnostics.map((diagnostic) => diagnostic.line).filter((line) => line > 0);
  return [...new Set(lines)];
}
