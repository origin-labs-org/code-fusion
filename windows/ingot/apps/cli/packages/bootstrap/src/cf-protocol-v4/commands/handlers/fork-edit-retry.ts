import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { isHighspeedProviderId } from "@origin-ai/cf-shared";
import {
  RewindStrategy,
  traceContextToLogContext,
  type MessageId,
  type TurnId,
} from "@origin-ai/cf-contracts";
import { mapAttachmentRefsToTurnAttachments } from "../attachment-refs.js";
import { V4PromptRejectedError } from "../prompt-turn.js";
import { commandAdmissionOf } from "../executor.js";
import { hasPromptInput, V4InputAdmissionRejectedError } from "../input-admission.js";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost, V4SessionRecordView } from "../types.js";
import {
  preflightCanonicalIntent,
  stableAttachmentRefs,
  startCanonicalIntent,
} from "./canonical-intent-replay.js";
import { preemptActiveTurnAndWait } from "./session-flow.js";

const CONVERSATION_COMMAND_LOG_MODULE = "bootstrap.cf_protocol_v4.commands";
const EDIT_USER_QUERY_COMPLETED_EVENT = "conversation.command.edit_user_query.completed";
const FORK_ASSISTANT_COMPLETED_EVENT = "conversation.command.fork_assistant.completed";

export class V4RowTranslationError extends Error {
  readonly reasonCode = "fault.command.executionFailed";

  constructor(command: string, targetRowId: number) {
    super(`${command} targetRowId ${targetRowId} 无法解析到 transcript messageId`);
    this.name = "V4RowTranslationError";
  }
}

export class V4ForkTargetNotLatestSegmentError extends Error {
  readonly reasonCode = "fault.command.executionFailed";

  constructor(targetRowId: number) {
    super(
      `forkAssistant targetRowId ${targetRowId} 不Yes所属轮的最后One段 assistant（fork 只挂轮尾段）`,
    );
    this.name = "V4ForkTargetNotLatestSegmentError";
  }
}

export class V4ForkTargetGuardError extends Error {
  constructor(
    readonly reasonCode: string,
    targetRowId: number,
  ) {
    super(`forkAssistant targetRowId ${targetRowId} 被稳定Target解析器Deny: ${reasonCode}`);
    this.name = "V4ForkTargetGuardError";
  }
}

export class V4EditTargetNotLatestError extends Error {
  readonly reasonCode = "guard.latestQueryEditOnly";

  constructor(targetRowId: number) {
    super(`editUserQuery targetRowId ${targetRowId} 不Yes最后One轮 real user query`);
    this.name = "V4EditTargetNotLatestError";
  }
}

export class V4RetryTargetNotLatestError extends Error {
  readonly reasonCode = "guard.latestAssistantRetryOnly";

  constructor(targetRowId: number) {
    super(`retryTurn targetRowId ${targetRowId} 不Yes最后One轮 assistant Reply`);
    this.name = "V4RetryTargetNotLatestError";
  }
}

async function submitConversationRewind(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  anchorMessageId: string,
): Promise<void> {
  const result = await record.app.runtime.rewindConversationToMessage({
    events: [],
    targetMessageId: anchorMessageId as MessageId,
    traceContext: record.traceContext,
  });
  if (result.strategy !== RewindStrategy.ActiveChain) {
    throw new Error(`conversation rewind unavailable for ${anchorMessageId}: ${result.strategy}`);
  }
  await host.afterLegacyStateMutation?.(record, "session_rewound");
}

async function editUserQuery(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["editUserQuery"];
  const record = requireRecord(host, envelope.sessionId);
  const resolution = host.resolveRowActionTarget?.(
    record.app.sessionId,
    payload.target,
    "editUserQuery",
  );
  if (!resolution?.ok || !resolution.editTarget) {
    throw new V4EditTargetNotLatestError(payload.target.rowId);
  }
  const editTarget = resolution.editTarget;
  const attachmentRefs = payload.attachments ?? stableAttachmentRefs(editTarget);
  if (
    !hasPromptInput(payload.newText, attachmentRefs) &&
    !(payload.conversationQuotes ?? editTarget.intent.conversationQuotes)?.length
  ) {
    throw new V4InputAdmissionRejectedError("proto.invalidPayload", "input must not be empty");
  }
  const attachments = await mapAttachmentRefsToTurnAttachments(record.app, attachmentRefs);
  const highspeedEdit =
    editTarget.intent.kind === "sendText" &&
    payload.highspeedMeta !== undefined &&
    payload.highspeedMeta.taskId === record.app.sessionId &&
    payload.highspeedMeta.expiresAt > Date.now() &&
    payload.modelSelection !== undefined &&
    payload.modelExecution !== undefined &&
    isHighspeedProviderId(payload.modelSelection.providerId)
      ? {
          card: payload.highspeedMeta,
          modelSelection: payload.modelSelection,
          execution: payload.modelExecution,
        }
      : undefined;
  await preflightCanonicalIntent(
    host,
    record,
    envelope,
    editTarget,
    payload.newText,
    attachmentRefs,
    attachments,
    highspeedEdit,
  );
  const runtimeHasActiveTurn =
    record.app.runtime?.getActiveTurnInfo?.() !== undefined ||
    record.app.runtime?.getActiveForegroundExecutionId?.() !== undefined;
  if (record.activeAbortController || runtimeHasActiveTurn) {
    await preemptActiveTurnAndWait(host, record, {
      abortMessage: "v4 editUserQuery preempts active turn",
      goalPausedMutationReason: "edit_user_query_goal_paused",
    });
  }
  let conversationRewindCommitted = false;
  if ((payload.workspaceMode ?? "preserve") === "rewind") {
    const turnMessageIds = resolution.messageIds ??
      host.getMessageIdsForTurnRow?.(record.app.sessionId, resolution.row.rowId) ?? [
        editTarget.transcriptMessageId,
      ];
    const fileOptions = {
      targetMessageIds: turnMessageIds as MessageId[],
      targetTurnId: resolution.row.turnId as TurnId,
      traceContext: record.traceContext,
    };
    const preview = await record.app.runtime.previewWorkspaceFileRewind(fileOptions);
    if (!preview.canApply || preview.ignoredFiles.length > 0 || preview.safeFiles.length === 0) {
      const reasonCode =
        preview.unsafeFiles.length > 0
          ? "guard.workspaceRewindUnsafeFiles"
          : preview.ignoredFiles.length > 0
            ? "guard.workspaceRewindIgnoredFiles"
            : preview.safeFiles.length === 0
              ? "guard.workspaceRewindUnavailable"
              : "guard.workspaceRewindApplyConflict";
      await host.cancelInputCommand?.(
        record.app.sessionId,
        commandAdmissionOf(envelope).queueItemId,
        reasonCode,
      );
      return {
        type: "editUserQuery",
        disposition: "blocked",
        sessionId: record.app.sessionId,
        reasonCode,
        preview,
      };
    }
    const applied = await record.app.runtime.applyWorkspaceFileRewind({
      ...fileOptions,
      commitAfterApply: async () => {
        await submitConversationRewind(host, record, editTarget.transcriptMessageId);
        conversationRewindCommitted = true;
      },
    });
    if (!applied.applied) {
      await host.cancelInputCommand?.(
        record.app.sessionId,
        commandAdmissionOf(envelope).queueItemId,
        "guard.workspaceRewindApplyConflict",
      );
      return {
        type: "editUserQuery",
        disposition: "blocked",
        sessionId: record.app.sessionId,
        reasonCode: "guard.workspaceRewindApplyConflict",
        preview: applied.preview,
      };
    }
  }
  if (!conversationRewindCommitted) {
    await submitConversationRewind(host, record, editTarget.transcriptMessageId);
  }
  try {
    await startCanonicalIntent(
      host,
      record,
      envelope,
      editTarget,
      payload.newText,
      attachmentRefs,
      attachments,
      highspeedEdit,
    );
  } catch (error) {
    if (
      editTarget.intent.kind === "sendText" &&
      error instanceof V4PromptRejectedError &&
      error.reasonCode === "activePrompt"
    ) {
      host.logger?.warn?.("v4 editUserQuery admission recovered by queue", {
        reason: error.message,
        sessionId: record.app.sessionId,
        targetRowId: payload.target.rowId,
      });
      await startCanonicalIntent(
        host,
        record,
        envelope,
        editTarget,
        payload.newText,
        attachmentRefs,
        attachments,
        highspeedEdit,
        { requireQueue: true },
      );
    } else {
      throw error;
    }
  }
  host.logger?.info?.("v4 editUserQuery completed", {
    ...traceContextToLogContext(record.traceContext),
    attachmentCount: attachmentRefs?.length ?? 0,
    clientId: envelope.clientId,
    commandId: envelope.commandId,
    event: EDIT_USER_QUERY_COMPLETED_EVENT,
    intentKind: editTarget.intent.kind,
    module: CONVERSATION_COMMAND_LOG_MODULE,
    sessionId: record.app.sessionId,
    status: "completed",
    targetEntityId: payload.target.entityId,
    targetRowId: payload.target.rowId,
    workspaceMode: payload.workspaceMode ?? "preserve",
  });
  return {
    type: "editUserQuery",
    disposition: "rewind",
    sessionId: record.app.sessionId,
  };
}

async function retryTurn(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["retryTurn"];
  const record = requireRecord(host, envelope.sessionId);
  const resolution = host.resolveRowActionTarget?.(
    record.app.sessionId,
    payload.target,
    "retryTurn",
  );
  if (!resolution?.ok || !resolution.messageId || !resolution.editTarget) {
    throw new V4RetryTargetNotLatestError(payload.target.rowId);
  }
  const attachmentRefs = stableAttachmentRefs(resolution.editTarget);
  const attachments = await mapAttachmentRefsToTurnAttachments(record.app, attachmentRefs);
  await preflightCanonicalIntent(
    host,
    record,
    envelope,
    resolution.editTarget,
    resolution.editTarget.intent.text,
    attachmentRefs,
    attachments,
  );
  await submitConversationRewind(host, record, resolution.editTarget.transcriptMessageId);
  await startCanonicalIntent(
    host,
    record,
    envelope,
    resolution.editTarget,
    resolution.editTarget.intent.text,
    attachmentRefs,
    attachments,
  );
  return undefined;
}

async function forkAssistant(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["forkAssistant"];
  const record = requireRecord(host, envelope.sessionId);
  const targetResolution = host.resolveRowActionTarget?.(
    record.app.sessionId,
    payload.target,
    "forkAssistant",
  );
  if (!targetResolution?.ok) {
    throw new V4ForkTargetGuardError("guard.forkTargetNotStable", payload.target.rowId);
  }
  if (!host.resolveStableForkTarget) {
    throw new Error("v4 forkAssistant requires host.resolveStableForkTarget capability");
  }
  const resolution = await host.resolveStableForkTarget(record.app.sessionId, payload.target.rowId);
  if (!resolution.ok) {
    throw new V4ForkTargetGuardError(resolution.reasonCode, payload.target.rowId);
  }
  if (!host.forkStableConversation) {
    throw new Error("v4 forkAssistant requires host.forkStableConversation capability");
  }
  const { forkedSessionId } = await host.forkStableConversation(record.app.sessionId, {
    target: resolution.target,
    goalBoundary: resolution.goalBoundary,
    sourceCommandId: envelope.commandId,
    revisionAtDecision: envelope.baseRevision ?? 0,
  });
  host.logger?.info?.("v4 forkAssistant completed", {
    ...traceContextToLogContext(record.traceContext),
    childSessionId: forkedSessionId,
    clientId: envelope.clientId,
    commandId: envelope.commandId,
    event: FORK_ASSISTANT_COMPLETED_EVENT,
    module: CONVERSATION_COMMAND_LOG_MODULE,
    parentSessionId: record.app.sessionId,
    revisionAtDecision: envelope.baseRevision ?? 0,
    sessionId: record.app.sessionId,
    status: "completed",
    targetBoundaryMessageId: resolution.target.boundaryMessageId,
    targetEntityId: payload.target.entityId,
    targetRowId: payload.target.rowId,
  });
  const result = { type: "forkAssistant" as const, sessionId: forkedSessionId };
  return result;
}

export const forkEditRetryHandlers = {
  forkAssistant,
  editUserQuery,
  retryTurn,
};
