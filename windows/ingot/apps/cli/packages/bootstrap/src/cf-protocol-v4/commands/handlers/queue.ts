import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { isHighspeedProviderId } from "@origin-ai/cf-shared";
import { createModelExecutionContext } from "../../../session-execution/index.js";
import { mapAttachmentRefsToTurnAttachments } from "../attachment-refs.js";
import { inputIntentMetadataFromQueueItem } from "../input-intent.js";
import { startPromptTurn } from "../prompt-turn.js";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost } from "../types.js";
import {
  applyGoalCommand,
  parseGoalObjectiveFromCommandText,
  startManualCompact,
  V4GoalCompactRejectedError,
} from "./goal-compact.js";
import { resolveSessionFallbackModelSelection } from "../input-admission.js";
import { preemptActiveTurnAndWait } from "./session-flow.js";
import { V4CommandNoopError } from "../../v4-gateway.js";
import { commandExecutionContextOf } from "../executor.js";
export { V4SessionIdleTimeoutError } from "./session-flow.js";

export class V4QueueItemTextUnavailableError extends Error {
  constructor(queueItemId: string) {
    super(`v4 sendQueuedNow queue item text unavailable: ${queueItemId}`);
    this.name = "V4QueueItemTextUnavailableError";
  }
}

export class V4QueueItemReservedError extends Error {
  readonly reasonCode = "guard.queueItemReserved";
  constructor(queueItemId: string) {
    super(`v4 sendQueuedNow queue item already reserved: ${queueItemId}`);
    this.name = "V4QueueItemReservedError";
  }
}

export class V4QueuePromotionCommitError extends Error {
  readonly reasonCode = "fault.command.queuePromotionCommitFailed";
  constructor(queueItemId: string) {
    super(`v4 sendQueuedNow started but failed to remove queue item: ${queueItemId}`);
    this.name = "V4QueuePromotionCommitError";
  }
}

export class V4QueueItemNotEditableError extends Error {
  readonly reasonCode = "guard.queueItemNotEditable";
  constructor(queueItemId: string) {
    super(`v4 queue item is not editable: ${queueItemId}`);
    this.name = "V4QueueItemNotEditableError";
  }
}

export class V4QueuePromotionLeaseUnavailableError extends Error {
  readonly reasonCode = "guard.queuePromotionBusy";
  constructor(activeLeaseId?: string) {
    super(
      activeLeaseId
        ? `v4 queue promotion is owned by another lease: ${activeLeaseId}`
        : "v4 queue promotion requires an idle Core runtime",
    );
    this.name = "V4QueuePromotionLeaseUnavailableError";
  }
}

async function deleteQueueItem(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["deleteQueueItem"];
  const record = requireRecord(host, envelope.sessionId);
  const queueItem = host.getQueueItem?.(record.app.sessionId, payload.queueItemId) ?? null;
  const removed = await record.app.removeQueueItem(payload.queueItemId);
  if (!removed) {
    host.logger?.warn?.("v4 deleteQueueItem missed", {
      queueItemId: payload.queueItemId,
      sessionId: record.app.sessionId,
    });
    throw new V4CommandNoopError("queue.itemMissing");
  }
  if (queueItem) {
    host.deleteQueuedTurnExecution?.(record.app.sessionId, queueItem.sourceCommandId);
  }
  return undefined;
}

async function editQueueItem(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["editQueueItem"];
  const record = requireRecord(host, envelope.sessionId);
  const queueItem = host.getQueueItem?.(record.app.sessionId, payload.queueItemId) ?? null;
  if (queueItem?.kind === "compact") {
    throw new V4QueueItemNotEditableError(payload.queueItemId);
  }
  const edited = await record.app.editQueueItem(payload.queueItemId, payload.newText);
  if (!edited) {
    host.logger?.warn?.("v4 editQueueItem missed", {
      queueItemId: payload.queueItemId,
      sessionId: record.app.sessionId,
    });
  }
  return undefined;
}

async function reorderQueueItem(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["reorderQueueItem"];
  const record = requireRecord(host, envelope.sessionId);
  const moved = await record.app.reorderQueueItem(payload.queueItemId, payload.beforeQueueItemId);
  if (!moved) {
    host.logger?.warn?.("v4 reorderQueueItem missed", {
      queueItemId: payload.queueItemId,
      sessionId: record.app.sessionId,
    });
  }
  return undefined;
}

async function setAutoDrain(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["setAutoDrain"];
  const record = requireRecord(host, envelope.sessionId);
  await record.app.setQueueAutoDrain(payload.autoDrain);
  if (payload.autoDrain) {
    await host.afterLegacyStateMutation?.(record, "queue_auto_drain_resumed");
  }
  return undefined;
}

async function setFollowupMode(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["setFollowupMode"];
  const record = requireRecord(host, envelope.sessionId);
  await record.app.setFollowupMode(payload.mode);
  return undefined;
}

async function sendQueuedNow(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const payload = envelope.payload as CommandPayloadMap["sendQueuedNow"];
  const record = requireRecord(host, envelope.sessionId);
  const reservationId = envelope.commandId;
  const autoDrainPromotion = commandExecutionContextOf(envelope)?.autoDrainPromotion === true;
  const foregroundPromotionLeaseId = `queue-promotion:${reservationId}`;
  const traceOptions = { traceContext: record.traceContext };
  let queueItemReserved = false;
  let startAdmitted = false;
  let leaseReleaseOwnedByBackground = false;
  let foregroundPromotionLeaseAcquired = false;
  try {
    const queueItem = host.getQueueItem?.(record.app.sessionId, payload.queueItemId) ?? null;
    if (queueItem === null) {
      throw new V4QueueItemTextUnavailableError(payload.queueItemId);
    }
    const acquirePromotionLease = (mode: "after-current" | "idle-only"): void => {
      const leaseResult = record.app.runtime.acquireForegroundPromotionLease({
        leaseId: foregroundPromotionLeaseId,
        mode,
        promotedInputId: queueItem.sourceCommandId,
      });
      if (leaseResult.kind !== "acquired") {
        throw new V4QueuePromotionLeaseUnavailableError(
          leaseResult.kind === "conflict" ? leaseResult.leaseId : undefined,
        );
      }
      foregroundPromotionLeaseAcquired = true;
    };
    if (autoDrainPromotion) acquirePromotionLease("idle-only");
    if (!(await record.app.reserveQueueItem(payload.queueItemId, reservationId, traceOptions))) {
      throw new V4QueueItemReservedError(payload.queueItemId);
    }
    queueItemReserved = true;
    const objective =
      queueItem.kind === "sendGoalCommand"
        ? parseGoalObjectiveFromCommandText(queueItem.text)
        : undefined;
    if (queueItem.kind === "sendGoalCommand" && !objective) {
      throw new V4GoalCompactRejectedError("emptyObjective", "Usage: /goal <objective>");
    }
    const attachments =
      queueItem.kind === "compact"
        ? undefined
        : await mapAttachmentRefsToTurnAttachments(record.app, queueItem.attachments);
    if (!autoDrainPromotion) acquirePromotionLease("after-current");
    let preempted = false;
    if (!autoDrainPromotion) {
      preempted = await preemptActiveTurnAndWait(host, record, {
        abortMessage: "v4 sendQueuedNow preempts active turn",
        goalPausedMutationReason: "send_queued_now_goal_paused",
        preserveQueueAutoDrainOnCancel: true,
      });
    }
    if (
      !(await record.app.markQueueItemPromoting(payload.queueItemId, reservationId, traceOptions))
    ) {
      throw new V4QueueItemReservedError(payload.queueItemId);
    }
    if (queueItem.kind === "compact") {
      await startManualCompact(host, record, queueItem.sourceCommandId, foregroundPromotionLeaseId);
      leaseReleaseOwnedByBackground = true;
    } else if (queueItem.kind === "sendGoalCommand") {
      const intent = inputIntentMetadataFromQueueItem(queueItem, objective ?? queueItem.text);
      const goalContinuationWillStart = !(
        intent.planEnabled ??
        record.app.runtime?.getPlanEnabled?.() ??
        record.app.getMode?.() === "plan"
      );
      await applyGoalCommand(host, record, {
        displayText: queueItem.text,
        foregroundPromotionLeaseId,
        inputId: queueItem.sourceCommandId,
        intent,
        objective: objective!,
      });
      leaseReleaseOwnedByBackground = goalContinuationWillStart;
    } else {
      const intent = inputIntentMetadataFromQueueItem(queueItem, queueItem.text);
      const refreshedHighspeedMatchesQueue =
        payload.highspeedMeta !== undefined &&
        queueItem.highspeed !== undefined &&
        payload.highspeedMeta.cardId === queueItem.highspeed.cardId &&
        payload.highspeedMeta.taskId === queueItem.highspeed.taskId;
      const ordinarySelection = isHighspeedProviderId(intent.modelSelection?.providerId)
        ? resolveSessionFallbackModelSelection(record)
        : intent.modelSelection;
      intent.modelSelection = ordinarySelection;
      if (refreshedHighspeedMatchesQueue && payload.highspeedMeta) {
        intent.highspeed = payload.highspeedMeta;
      }
      const refreshedExecution =
        refreshedHighspeedMatchesQueue && payload.modelSelection && payload.modelExecution
          ? { modelSelection: payload.modelSelection, modelExecution: payload.modelExecution }
          : undefined;
      const stagedExecution =
        refreshedExecution ??
        host.readQueuedTurnExecution?.(record.app.sessionId, queueItem.sourceCommandId);
      const highspeedStillValid =
        intent.highspeed !== undefined &&
        intent.highspeed.expiresAt > Date.now() &&
        stagedExecution !== undefined &&
        isHighspeedProviderId(stagedExecution.modelSelection.providerId);
      if (highspeedStillValid && stagedExecution) {
        intent.modelSelection = stagedExecution.modelSelection;
      } else if (intent.highspeed) {
        if (intent.highspeed.expiresAt > Date.now()) {
          host.logger?.warn?.("v4 queued Highspeed execution unavailable; using queued model", {
            cardId: intent.highspeed.cardId,
            queueItemId: queueItem.queueItemId,
            reason: "execution_missing",
            sessionId: record.app.sessionId,
          });
        }
        delete intent.highspeed;
        host.deleteQueuedTurnExecution?.(record.app.sessionId, queueItem.sourceCommandId);
      }
      const turnExecution =
        highspeedStillValid && stagedExecution
          ? {
              ...stagedExecution.modelExecution,
              ...(stagedExecution.modelExecution.selectionFallback
                ? {
                    selectionFallback: {
                      ...stagedExecution.modelExecution.selectionFallback,
                      target: ordinarySelection,
                    },
                  }
                : {}),
            }
          : undefined;
      const started = await startPromptTurn(host, record, {
        content: queueItem.text,
        inputId: queueItem.sourceCommandId,
        ...(preempted && !attachments?.length ? { inputPresentation: "user_steer" as const } : {}),
        intent,
        requireIdle: true,
        toolDisallowlist: queueItem.toolDisallowlist,
        ...(turnExecution ? { modelExecution: createModelExecutionContext(turnExecution) } : {}),
        ...(attachments ? { attachments } : {}),
      });
      if (started.admission.kind === "queued" || started.admission.kind === "rejected") {
        throw new V4QueuePromotionLeaseUnavailableError();
      }
      host.deleteQueuedTurnExecution?.(record.app.sessionId, queueItem.sourceCommandId);
    }
    startAdmitted = true;
    const removed = await record.app.removeQueueItem(payload.queueItemId, {
      reason: "promoted",
      reservationId,
      ...traceOptions,
    });
    if (!removed) throw new V4QueuePromotionCommitError(payload.queueItemId);
    if (queueItem.kind === "compact") {
      await host.afterLegacyStateMutation?.(record, "queue_compact_promoted");
    }
    return undefined;
  } finally {
    if (foregroundPromotionLeaseAcquired && !leaseReleaseOwnedByBackground) {
      record.app.runtime.releaseForegroundPromotionLease(foregroundPromotionLeaseId);
    }
    if (queueItemReserved && !startAdmitted) {
      await record.app.releaseQueueItemReservation(
        payload.queueItemId,
        reservationId,
        traceOptions,
      );
    }
  }
}

export const queueHandlers = {
  deleteQueueItem,
  editQueueItem,
  reorderQueueItem,
  setAutoDrain,
  setFollowupMode,
  sendQueuedNow,
};
