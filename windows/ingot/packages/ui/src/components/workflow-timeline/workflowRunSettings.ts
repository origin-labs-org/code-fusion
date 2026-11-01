// ============================================================
// ============================================================

import {
  WORKFLOW_RUN_SETTINGS_REJECTED_FAULT_PREFIX,
  workflowRunSettingsRejectionReasonSchema,
  type AmendWorkflowRunSettingsPayload,
  type CommandAck,
  type WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { formatModelPickerValue, parseModelPickerValue } from "@/lib/cfSessionProjection.js";

export function workflowSessionModelOf(
  config:
    | { modelSelection?: { providerId: string; modelId: string }; provider: string; model: string }
    | null
    | undefined,
): { providerId: string; modelId: string } | undefined {
  if (config === null || config === undefined) return undefined;
  const selection = config.modelSelection;
  if (selection !== undefined)
    return { providerId: selection.providerId, modelId: selection.modelId };
  const providerId = config.provider.trim();
  const modelId = config.model.trim();
  return providerId && modelId ? { providerId, modelId } : undefined;
}

export type WorkflowRunSettingsModel =
  | { kind: "session" }
  | { kind: "model"; providerId: string; modelId: string; level?: string };

export interface WorkflowRunSettingsDraft {
  model: WorkflowRunSettingsModel;
  bound: number | null;
}

export type WorkflowRunSettingsChange = Omit<AmendWorkflowRunSettingsPayload, "workId">;

export function isWorkflowRunConfigurable(run: WorkflowRunState | undefined): boolean {
  if (run === undefined) return false;
  switch (run.status) {
    case "pending":
    case "running":
    case "errored":
      return true;
    case "stopped":
      return run.supersededBy === undefined && run.stopReason !== "superseded";
    case "completed":
      return false;
  }
}

export function workflowRunDefaultConcurrency(run: WorkflowRunState): number | undefined {
  return run.concurrencyCeiling;
}

export function workflowRunSettingsModelOf(
  canonical: string | undefined,
): WorkflowRunSettingsModel {
  const text = canonical?.trim();
  if (!text) return { kind: "session" };
  try {
    const parsed = parseModelPickerValue(text);
    const level = parsed.options?.reasoningLevel;
    return {
      kind: "model",
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      ...(level === undefined ? {} : { level }),
    };
  } catch {
    return { kind: "model", providerId: "", modelId: text };
  }
}

export function workflowRunSettingsModelCanonical(
  model: WorkflowRunSettingsModel,
): string | undefined {
  if (model.kind === "session") return undefined;
  if (model.providerId === "") return model.modelId;
  return formatModelPickerValue({
    providerId: model.providerId,
    modelId: model.modelId,
    ...(model.level === undefined ? {} : { options: { reasoningLevel: model.level } }),
  });
}

export function initialWorkflowRunSettingsDraft(run: WorkflowRunState): WorkflowRunSettingsDraft {
  const limit = run.concurrency?.limit;
  return {
    model: workflowRunSettingsModelOf(run.subagentModel),
    bound: limit ?? workflowRunDefaultConcurrency(run) ?? null,
  };
}

function normalizedBound(
  bound: number | null,
  defaultConcurrency: number | undefined,
): number | null {
  if (bound === null) return null;
  return bound === defaultConcurrency ? null : bound;
}

export function workflowRunSettingsChange(
  initial: WorkflowRunSettingsDraft,
  draft: WorkflowRunSettingsDraft,
  defaultConcurrency: number | undefined,
): WorkflowRunSettingsChange | undefined {
  const change: WorkflowRunSettingsChange = {};
  const fromModel = workflowRunSettingsModelCanonical(initial.model);
  const toModel = workflowRunSettingsModelCanonical(draft.model);
  if (fromModel !== toModel) change.subagentModel = toModel ?? null;
  const fromBound = normalizedBound(initial.bound, defaultConcurrency);
  const toBound = normalizedBound(draft.bound, defaultConcurrency);
  if (fromBound !== toBound) change.maxConcurrency = toBound;
  return Object.keys(change).length === 0 ? undefined : change;
}

export function clampWorkflowRunSettingsBound(value: number): number {
  return Math.max(1, Math.floor(value));
}

function isConcurrencyOnlyChange(change: WorkflowRunSettingsChange | undefined): boolean {
  if (change === undefined) return false;
  return Object.keys(change).length === 1 && change.maxConcurrency !== undefined;
}

export function workflowRunSettingsConsequenceId(
  status: WorkflowRunState["status"],
  change: WorkflowRunSettingsChange | undefined,
): string | undefined {
  if (change === undefined) return undefined;
  if (status === "running" && isConcurrencyOnlyChange(change))
    return "chat.toolCall.workflow.run.settings.consequence.concurrencyLive";
  switch (status) {
    case "pending":
      return "chat.toolCall.workflow.run.settings.consequence.pending";
    case "stopped":
      return "chat.toolCall.workflow.run.settings.consequence.stopped";
    case "errored":
      return "chat.toolCall.workflow.run.settings.consequence.errored";
    default:
      return "chat.toolCall.workflow.run.settings.consequence.running";
  }
}

const CAPABILITY_UNSUPPORTED_FAULT = "fault.command.capabilityUnsupported";
const KNOWN_REASONS: ReadonlySet<string> = new Set(
  workflowRunSettingsRejectionReasonSchema.options,
);

export interface WorkflowRunSettingsRejection {
  
  reason: string;
  
  code: string;
  
  message?: string;
}

export function describeWorkflowRunSettingsRejection(
  ack: Pick<CommandAck, "status" | "reasonCode" | "message">,
): WorkflowRunSettingsRejection | undefined {
  if (ack.status === "accepted" || ack.status === "noop") return undefined;
  const code = ack.reasonCode ?? ack.status;
  let reason = "generic";
  if (ack.reasonCode === CAPABILITY_UNSUPPORTED_FAULT) reason = "unsupported";
  else if (ack.reasonCode?.startsWith(WORKFLOW_RUN_SETTINGS_REJECTED_FAULT_PREFIX)) {
    const suffix = ack.reasonCode.slice(WORKFLOW_RUN_SETTINGS_REJECTED_FAULT_PREFIX.length);
    if (KNOWN_REASONS.has(suffix)) reason = suffix;
  }
  return { reason, code, ...(ack.message ? { message: ack.message } : {}) };
}

export function workflowRunSettingsRejectionMessageId(
  rejection: WorkflowRunSettingsRejection,
): string {
  return `chat.toolCall.workflow.run.settings.rejection.${rejection.reason}`;
}

export function workflowRunSettingsRejectionDetail(
  rejection: WorkflowRunSettingsRejection,
): string | undefined {
  return rejection.reason === "start_failed" ? undefined : rejection.message;
}
