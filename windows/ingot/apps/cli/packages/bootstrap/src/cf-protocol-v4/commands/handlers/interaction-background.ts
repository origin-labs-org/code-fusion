import { PERMISSION_FULL_ACCESS_OPTION_ID } from "@origin-ai/cf-shared/cf-protocol-v4";
import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
  SavedWorkflowStartRejectionReason,
  WorkflowRunSettingsRejectionReason,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX,
  SAVED_WORKFLOW_START_REJECTED_FAULT_PREFIX,
  WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX,
  WORKFLOW_RUN_SETTINGS_REJECTED_FAULT_PREFIX,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";

export class V4CapabilityUnsupportedError extends Error {
  readonly reasonCode = "fault.command.capabilityUnsupported";

  constructor(capability: string, sessionId: string) {
    super(`capability not supported by this session runtime: ${capability} (session ${sessionId})`);
    this.name = "V4CapabilityUnsupportedError";
  }
}

async function resolveInteraction(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["resolveInteraction"];
  const delivered =
    payload.answer.optionId === PERMISSION_FULL_ACCESS_OPTION_ID
      ? ((await host.interactions?.resolveFullAccess(payload.interactionId, envelope.sessionId!)) ??
        false)
      : (host.interactions?.resolve(payload.interactionId, payload.answer) ?? false);
  if (!delivered) {
    host.logger?.info?.("v4 resolveInteraction no pending interaction (idempotent)", {
      event: "cf_protocol.v4.interaction_already_resolved",
      interactionId: payload.interactionId,
      sessionId: envelope.sessionId,
    });
  }
  return undefined;
}

async function snoozeInteractionAutoResolution(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["snoozeInteractionAutoResolution"];
  const snoozed = (await host.interactions?.snoozeAutoResolution(payload.interactionId)) ?? false;
  if (!snoozed) {
    host.logger?.info?.("v4 snoozeInteractionAutoResolution no active countdown (idempotent)", {
      event: "cf_protocol.v4.interaction_auto_resolution_already_snoozed",
      interactionId: payload.interactionId,
      sessionId: envelope.sessionId,
    });
  }
  return undefined;
}

export class V4WorkspaceHookReviewRejectedError extends Error {
  constructor(readonly reasonCode: string) {
    super(`Workspace Hook review command rejected: ${reasonCode}`);
    this.name = "V4WorkspaceHookReviewRejectedError";
  }
}

async function respondWorkspaceHookReview(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["respondWorkspaceHookReview"];
  const record = requireWorkspaceHookReviewRecord(host, envelope, payload.sessionId);
  const result = await record.app.respondWorkspaceHookReview(payload);
  if (!result.accepted) throw new V4WorkspaceHookReviewRejectedError(result.reasonCode);
  return undefined;
}

async function toggleWorkspaceHookReviewItem(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["toggleWorkspaceHookReviewItem"];
  const record = requireWorkspaceHookReviewRecord(host, envelope, payload.sessionId);
  const result = await record.app.toggleWorkspaceHookReviewItem(payload);
  if (!result.accepted) throw new V4WorkspaceHookReviewRejectedError(result.reasonCode);
  return undefined;
}

async function revokeWorkspaceHookTrust(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["revokeWorkspaceHookTrust"];
  const record = requireWorkspaceHookReviewRecord(host, envelope, payload.sessionId);
  const result = await record.app.revokeWorkspaceHookTrust(payload);
  if (!result.accepted) throw new V4WorkspaceHookReviewRejectedError(result.reasonCode);
  return undefined;
}

async function requestWorkspaceHookReview(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["requestWorkspaceHookReview"];
  const record = requireWorkspaceHookReviewRecord(host, envelope, payload.sessionId);
  const result = await record.app.requestWorkspaceHookReview({
    workspaceIdentity: payload.workspaceIdentity,
    bundleDigest: payload.bundleDigest,
  });
  if (!result.accepted) throw new V4WorkspaceHookReviewRejectedError(result.reasonCode);
  return undefined;
}

function requireWorkspaceHookReviewRecord(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
  payloadSessionId: string,
) {
  if (envelope.sessionId !== payloadSessionId) {
    throw new V4WorkspaceHookReviewRejectedError("workspace_hooks_snapshot_mismatch");
  }
  return requireRecord(host, envelope.sessionId);
}

class V4BackgroundWorkCancelRejectedError extends Error {
  readonly reasonCode: string;
  constructor(reason: string, workId: string) {
    super(`background work ${workId} was not cancelled: ${reason}`);
    this.name = "V4BackgroundWorkCancelRejectedError";
    this.reasonCode = `${BACKGROUND_WORK_CANCEL_REJECTED_FAULT_PREFIX}${reason.replace(/^background_task_/, "")}`;
  }
}

async function cancelBackgroundWork(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["cancelBackgroundWork"];
  const record = requireRecord(host, envelope.sessionId);
  if (!record.app.cancelBackgroundTask) {
    throw new V4CapabilityUnsupportedError("cancelBackgroundTask", record.app.sessionId);
  }
  const result = await record.app.cancelBackgroundTask(payload.workId);
  if (result?.reason !== undefined) {
    throw new V4BackgroundWorkCancelRejectedError(result.reason, payload.workId);
  }
  return undefined;
}

class V4WorkflowRunResumeRejectedError extends Error {
  readonly reasonCode: string;
  constructor(reason: string, message?: string) {
    super(message ?? `workflow run resume rejected: ${reason}`);
    this.name = "V4WorkflowRunResumeRejectedError";
    this.reasonCode = `${WORKFLOW_RUN_RESUME_REJECTED_FAULT_PREFIX}${reason}`;
  }
}

async function resumeWorkflowRun(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["resumeWorkflowRun"];
  const record = requireRecord(host, envelope.sessionId);
  if (!record.app.resumeWorkflowRun) {
    throw new V4CapabilityUnsupportedError("resumeWorkflowRun", record.app.sessionId);
  }
  const result = await record.app.resumeWorkflowRun({
    workId: payload.workId,
    ...(payload.name === undefined ? {} : { name: payload.name }),
  });
  if (!result.ok) throw new V4WorkflowRunResumeRejectedError(result.reason, result.message);
  return undefined;
}

class V4SavedWorkflowStartRejectedError extends Error {
  readonly reasonCode: string;
  constructor(reason: SavedWorkflowStartRejectionReason, message?: string) {
    super(message ?? `saved workflow start rejected: ${reason}`);
    this.name = "V4SavedWorkflowStartRejectedError";
    this.reasonCode = `${SAVED_WORKFLOW_START_REJECTED_FAULT_PREFIX}${reason}`;
  }
}

async function startSavedWorkflow(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["startSavedWorkflow"];
  const record = requireRecord(host, envelope.sessionId);
  if (!record.app.startSavedWorkflow) {
    throw new V4CapabilityUnsupportedError("startSavedWorkflow", record.app.sessionId);
  }
  const result = await record.app.startSavedWorkflow({
    name: payload.name,
    ...(payload.scope === undefined ? {} : { scope: payload.scope }),
    ...(payload.args === undefined ? {} : { args: payload.args }),
  });
  if (!result.ok) throw new V4SavedWorkflowStartRejectedError(result.reason, result.message);
  return { type: "startSavedWorkflow", runId: result.runId, toolCallId: result.toolCallId };
}

class V4WorkflowRunSettingsRejectedError extends Error {
  readonly reasonCode: string;
  constructor(reason: WorkflowRunSettingsRejectionReason, message?: string) {
    super(message ?? `workflow run settings rejected: ${reason}`);
    this.name = "V4WorkflowRunSettingsRejectedError";
    this.reasonCode = `${WORKFLOW_RUN_SETTINGS_REJECTED_FAULT_PREFIX}${reason}`;
  }
}

async function amendWorkflowRunSettings(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["amendWorkflowRunSettings"];
  const record = requireRecord(host, envelope.sessionId);
  if (!record.app.amendWorkflowRunSettings) {
    throw new V4CapabilityUnsupportedError("amendWorkflowRunSettings", record.app.sessionId);
  }
  const result = await record.app.amendWorkflowRunSettings({
    runId: payload.workId,
    ...(payload.subagentModel === undefined ? {} : { subagentModel: payload.subagentModel }),
    ...(payload.maxConcurrency === undefined ? {} : { maxConcurrency: payload.maxConcurrency }),
  });
  if (!result.ok) throw new V4WorkflowRunSettingsRejectedError(result.reason, result.message);
  return {
    type: "amendWorkflowRunSettings",
    runId: result.runId,
    toolCallId: result.toolCallId,
    ...(result.supersededRunId === undefined ? {} : { supersededRunId: result.supersededRunId }),
  };
}

export const interactionBackgroundHandlers = {
  resolveInteraction,
  respondWorkspaceHookReview,
  toggleWorkspaceHookReviewItem,
  revokeWorkspaceHookTrust,
  requestWorkspaceHookReview,
  snoozeInteractionAutoResolution,
  cancelBackgroundWork,
  resumeWorkflowRun,
  startSavedWorkflow,
  amendWorkflowRunSettings,
};
