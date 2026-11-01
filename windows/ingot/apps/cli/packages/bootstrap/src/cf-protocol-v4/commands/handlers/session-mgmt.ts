import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { mapAttachmentRefsToTurnAttachments } from "../attachment-refs.js";
import { inputIntentMetadata } from "../input-intent.js";
import { commandAdmissionOf } from "../executor.js";
import { startPromptTurn } from "../prompt-turn.js";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";
import { applyRequestedSessionConfig } from "./model-config.js";
import {
  hasPromptInput,
  resolveSubmittedExecutionState,
  V4InputAdmissionRejectedError,
} from "../input-admission.js";

async function createSession(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["createSession"];
  if (!host.createSessionRecord) {
    throw new Error("v4 createSession requires host.createSessionRecord capability");
  }
  if (
    payload.firstInput &&
    !hasPromptInput(payload.firstInput.text, payload.firstInput.attachments)
  ) {
    throw new V4InputAdmissionRejectedError("proto.invalidPayload", "input must not be empty");
  }
  const { sessionId } = await host.createSessionRecord({
    ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    ...(payload.additionalDirectories
      ? { additionalDirectories: payload.additionalDirectories }
      : {}),
    workspaceId: payload.workspaceId,
    ...(payload.permissionScope ? { permissionScope: payload.permissionScope } : {}),
    mcpServers: payload.mcpServers,
    offPeakToolEnabled: payload.offPeakToolEnabled,
    dynamicWorkflowEnabled: payload.dynamicWorkflowEnabled,
    dynamicWorkflowMode: payload.dynamicWorkflowMode,
  });
  if (payload.config) {
    const record = requireRecord(host, sessionId);
    try {
      await applyRequestedSessionConfig(host, record, payload.config);
    } catch (error) {
      if (payload.config.mode === "guarded" || payload.firstInput?.mode === "guarded") {
        try {
          await host.deleteSession?.(sessionId);
        } catch (closeError) {
          host.logger?.warn?.("v4 guarded draft cleanup failed", { sessionId, closeError });
        }
        throw error;
      }
      host.logger?.warn?.("v4 createSession config apply failed; session keeps runtime defaults", {
        error: error instanceof Error ? error.message : String(error),
        sessionId,
      });
    }
  }
  let firstInput:
    | {
        delivery: "startNow" | "queue" | "guide";
        inputId: string;
        messageId?: string;
      }
    | undefined;
  if (payload.firstInput) {
    const record = requireRecord(host, sessionId);
    const admission = commandAdmissionOf(envelope);
    const durableAdmission =
      (await host.admitInputCommand?.(envelope, sessionId, admission)) ?? null;
    try {
      const attachments = await mapAttachmentRefsToTurnAttachments(
        record.app,
        payload.firstInput.attachments,
      );
      const intent = inputIntentMetadata(envelope, {
        text: payload.firstInput.text,
        requestedDelivery: "startNow",
        attachmentRefs: payload.firstInput.attachments,
        ...resolveSubmittedExecutionState(record, payload.firstInput),
      });
      const started = await startPromptTurn(host, record, {
        content: payload.firstInput.text,
        inputId: envelope.commandId,
        intent,
        ...(attachments ? { attachments } : {}),
      });
      firstInput = {
        delivery: started.admission.kind === "queued" ? "queue" : "startNow",
        inputId: envelope.commandId,
        ...(started.messageId ? { messageId: started.messageId } : {}),
      };
    } catch (error) {
      if (durableAdmission) {
        try {
          await host.cancelInputCommand?.(
            sessionId,
            admission.queueItemId,
            "fault.command.inputRejected",
          );
        } catch (cancelError) {
          host.logger?.warn?.("v4 createSession first input cancellation failed", {
            cancelError: cancelError instanceof Error ? cancelError.message : String(cancelError),
            inputError: error instanceof Error ? error.message : String(error),
            queueItemId: admission.queueItemId,
            sessionId,
          });
        }
      }
      throw error;
    }
  }
  return { type: "createSession", sessionId, ...(firstInput ? { input: firstInput } : {}) };
}

async function renameSession(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["renameSession"];
  const record = requireRecord(host, envelope.sessionId);
  await record.app.runtime.setCustomSessionTitle({
    title: payload.title,
    traceContext: record.traceContext,
  });
  return undefined;
}

async function deleteSession(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const record = requireRecord(host, envelope.sessionId);
  if (!host.deleteSession) {
    throw new Error("v4 deleteSession requires host.deleteSession capability");
  }
  await host.deleteSession(record.app.sessionId);
  return undefined;
}

async function discardSharedContext(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["discardSharedContext"];
  const sessionId = envelope.sessionId;
  if (!sessionId || !host.discardSharedContext) {
    throw new Error("v4 discardSharedContext requires a session-scoped storage capability");
  }
  const updated = await host.discardSharedContext(sessionId, payload.contextId);
  if (!updated)
    throw new V4InputAdmissionRejectedError(
      "fault.command.inputRejected",
      "shared context is not pending",
    );
  return undefined;
}

export const sessionMgmtHandlers = {
  createSession,
  renameSession,
  deleteSession,
  discardSharedContext,
};
