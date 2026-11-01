// ============================================================
// ============================================================
//

import type { DynamicWorkflowRunSummary } from "@origin-ai/cf-contracts";

export const DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS = 80;

export function resolveDynamicWorkflowRunLabel(input: {
  runId: string;
  name?: string;
  scriptText?: string;
}): Pick<DynamicWorkflowRunSummary, "label" | "labelSource"> {
  const name = input.name?.trim();
  if (name !== undefined && name.length > 0) return { label: name, labelSource: "name" };

  const firstLine = firstNonEmptyLine(input.scriptText);
  if (firstLine !== undefined) {
    return { label: boundLabel(firstLine), labelSource: "script" };
  }

  return { label: input.runId, labelSource: "script" };
}

function firstNonEmptyLine(scriptText: string | undefined): string | undefined {
  if (scriptText === undefined) return undefined;
  for (const line of scriptText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function boundLabel(value: string): string {
  if (value.length <= DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS) return value;
  const cut = value.slice(0, DYNAMIC_WORKFLOW_RUN_LABEL_MAX_CHARS);
  const lastCode = cut.charCodeAt(cut.length - 1);
  const isHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return isHighSurrogate ? cut.slice(0, -1) : cut;
}
