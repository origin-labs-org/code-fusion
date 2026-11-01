// ============================================================
// ============================================================
// docs/dynamic-workflow/presentation.md「The confirmation window」。
//

import {
  readWorkflowMaxConcurrency,
  readWorkflowSubagentModel,
} from "@/ToolCallBlocks/renderers/createWorkflowInput.js";
import {
  workflowRunSettingsChange,
  workflowRunSettingsModelOf,
  type WorkflowRunSettingsDraft,
} from "./workflowRunSettings.js";

export interface WorkflowAskSettingsContent {
  subagent_model?: string | null;
  max_concurrency?: number | null;
}

export function initialWorkflowAskSettingsDraft(
  input: unknown,
  defaultConcurrency: number | undefined,
): WorkflowRunSettingsDraft {
  return {
    model: workflowRunSettingsModelOf(readWorkflowSubagentModel(input)),
    bound: readWorkflowMaxConcurrency(input) ?? defaultConcurrency ?? null,
  };
}

export function workflowAskSettingsContent(
  initial: WorkflowRunSettingsDraft,
  draft: WorkflowRunSettingsDraft,
  defaultConcurrency: number | undefined,
): WorkflowAskSettingsContent | undefined {
  const change = workflowRunSettingsChange(initial, draft, defaultConcurrency);
  if (change === undefined) return undefined;
  return {
    ...(change.subagentModel === undefined ? {} : { subagent_model: change.subagentModel }),
    ...(change.maxConcurrency === undefined ? {} : { max_concurrency: change.maxConcurrency }),
  };
}

export function workflowAskSettingsChangedLines(
  initial: WorkflowRunSettingsDraft,
  draft: WorkflowRunSettingsDraft,
  defaultConcurrency: number | undefined,
): { model: boolean; bound: boolean } {
  const content = workflowAskSettingsContent(initial, draft, defaultConcurrency);
  return {
    model: content?.subagent_model !== undefined,
    bound: content?.max_concurrency !== undefined,
  };
}
