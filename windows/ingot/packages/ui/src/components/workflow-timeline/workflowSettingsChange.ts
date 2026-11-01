// ============================================================
// ============================================================

import type { WorkflowSettingsAmendMeta } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  describeWorkflowSubagentModel,
  type WorkflowSubagentModelDeps,
} from "./subagent-model-label.js";

function modelName(canonical: string, deps: WorkflowSubagentModelDeps): string {
  return describeWorkflowSubagentModel(canonical, deps).name;
}

export function workflowSettingsChangeSegments(
  amend: WorkflowSettingsAmendMeta,
  deps: WorkflowSubagentModelDeps,
): string[] {
  const { formatMessage } = deps;
  const segments: string[] = [];
  if (amend.subagentModel !== undefined) {
    const to = amend.subagentModel.to;
    segments.push(
      to === undefined
        ? formatMessage({ id: "chat.toolCall.workflow.settingsChange.modelSession" })
        : formatMessage(
            { id: "chat.toolCall.workflow.settingsChange.model" },
            { model: modelName(to, deps) },
          ),
    );
  }
  if (amend.maxConcurrency !== undefined) {
    const to = amend.maxConcurrency.to;
    const atDefault = to === undefined || to === amend.ceiling;
    segments.push(
      atDefault
        ? formatMessage({ id: "chat.toolCall.workflow.settingsChange.limitDefault" })
        : formatMessage({ id: "chat.toolCall.workflow.settingsChange.limit" }, { n: to }),
    );
  }
  return segments;
}

export interface WorkflowSettingsProvenanceRow {
  key: "model" | "limit";
  label: string;
  /** 「{from} → {to}」。 */
  value: string;
}

export function workflowSettingsProvenanceRows(
  amend: WorkflowSettingsAmendMeta,
  deps: WorkflowSubagentModelDeps,
): WorkflowSettingsProvenanceRow[] {
  const { formatMessage } = deps;
  const rows: WorkflowSettingsProvenanceRow[] = [];
  if (amend.subagentModel !== undefined) {
    const end = (canonical: string | undefined) =>
      canonical === undefined
        ? formatMessage({ id: "chat.workflowLaunch.settings.sessionModel" })
        : modelName(canonical, deps);
    rows.push({
      key: "model",
      label: formatMessage({ id: "chat.workflowLaunch.settings.model" }),
      value: `${end(amend.subagentModel.from)} → ${end(amend.subagentModel.to)}`,
    });
  }
  if (amend.maxConcurrency !== undefined) {
    const defaultConcurrency = amend.ceiling;
    const end = (bound: number | undefined) =>
      bound !== undefined && bound !== defaultConcurrency
        ? String(bound)
        : defaultConcurrency === undefined
          ? formatMessage({ id: "chat.workflowLaunch.settings.defaultLimit" })
          : formatMessage(
              { id: "chat.workflowLaunch.settings.defaultLimitValue" },
              { n: defaultConcurrency },
            );
    rows.push({
      key: "limit",
      label: formatMessage({ id: "chat.workflowLaunch.settings.limit" }),
      value: `${end(amend.maxConcurrency.from)} → ${end(amend.maxConcurrency.to)}`,
    });
  }
  return rows;
}
