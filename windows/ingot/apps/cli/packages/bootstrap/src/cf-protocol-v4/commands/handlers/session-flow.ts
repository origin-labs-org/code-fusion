import type {
  CommandEnvelope,
  CommandPayloadMap,
  CommandResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { isHighspeedProviderId } from "@origin-ai/cf-shared";
import { createModelExecutionContext } from "../../../session-execution/index.js";
import { mapAttachmentRefsToTurnAttachments } from "../attachment-refs.js";
import {
  applyHeldQueueDisposition,
  hasPromptInput,
  resolveOrdinaryQueueModelSelection,
  resolveSubmittedExecutionState,
  V4InputAdmissionRejectedError,
} from "../input-admission.js";
import { inputIntentMetadata } from "../input-intent.js";
import {
  resolveTurnAutomationId,
  startPromptTurn,
  turnBackgroundAttributionOf,
  V4PromptRejectedError,
} from "../prompt-turn.js";
import { requireRecord } from "../record-access.js";
import type { V4CommandCoreHost, V4SessionRecordView, V4TurnExecution } from "../types.js";
import { V4CommandNoopError } from "../../v4-gateway.js";

const IDLE_POLL_INTERVAL_MS = 25;
const IDLE_POLL_TIMEOUT_MS = 5_000;
const HIGHSPEED_QUEUE_FALLBACK_REASON = "highspeed.requiresQueue";

export class V4SessionIdleTimeoutError extends Error {
  constructor(sessionId: string) {
    super(`v4 timed out waiting for session idle: ${sessionId}`);
    this.name = "V4SessionIdleTimeoutError";
  }
}

async function sendText(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const rawPayload = envelope.payload as CommandPayloadMap["sendText"];
  const record = requireRecord(host, envelope.sessionId);
  if (
    !hasPromptInput(rawPayload.text, rawPayload.attachments) &&
    !rawPayload.conversationQuotes?.length
  ) {
    throw new V4InputAdmissionRejectedError("proto.invalidPayload", "input must not be empty");
  }
  const activeAutomationId = resolveTurnAutomationId({
    automationId: rawPayload.automationId,
    inputId: envelope.commandId,
  });
  const dropsHighspeed =
    activeAutomationId !== undefined &&
    (rawPayload.highspeedMeta !== undefined ||
      isHighspeedProviderId(rawPayload.modelSelection?.providerId));
  const payload: CommandPayloadMap["sendText"] = dropsHighspeed
    ? {
        ...rawPayload,
        highspeedMeta: undefined,
        modelSelection: undefined,
        modelExecution: undefined,
      }
    : rawPayload;
  const intentEnvelope = dropsHighspeed ? ({ ...envelope, payload } as CommandEnvelope) : envelope;
  const attachments = await mapAttachmentRefsToTurnAttachments(record.app, payload.attachments);
  const submittedExecutionState = resolveSubmittedExecutionState(record, payload);
  const submissionIntent = (options: Parameters<typeof inputIntentMetadata>[1]) =>
    inputIntentMetadata(intentEnvelope, { ...options, ...submittedExecutionState });
  const routingMode = host.getInputRoutingMode?.(envelope.sessionId ?? "") ?? null;
  const forceStartNow = payload.requestedDelivery === "startNow";
  const highspeedExecution: V4TurnExecution | undefined = isHighspeedProviderId(
    payload.modelSelection?.providerId,
  )
    ? payload.modelExecution
    : undefined;
  const highspeedActiveTurn = highspeedExecution
    ? record.app.runtime?.getActiveTurnInfo?.()
    : undefined;
  const highspeedRequiresQueue =
    !forceStartNow &&
    highspeedExecution !== undefined &&
    (record.activeAbortController !== undefined ||
      highspeedActiveTurn !== undefined ||
      routingMode === "enqueue" ||
      routingMode === "guide");

  const queueHighspeedTurn = async (): Promise<CommandResult | undefined> => {
    const highspeedSelection = payload.modelSelection;
    if (!highspeedExecution || !highspeedSelection) {
      throw new V4InputAdmissionRejectedError(
        "fault.command.inputRejected",
        "Highspeed queue requires turn execution material",
      );
    }
    const ordinarySelection = resolveOrdinaryQueueModelSelection(
      record,
      highspeedExecution.selectionFallback?.target,
    );
    const retainQueuedTurnExecution = host.retainQueuedTurnExecution;
    if (retainQueuedTurnExecution) {
      retainQueuedTurnExecution(record.app.sessionId, envelope.commandId, {
        modelSelection: highspeedSelection,
        modelExecution: highspeedExecution,
      });
    }
    try {
      const requestedDelivery = routingMode === "guide" ? "guide" : "queue";
      const intent = submissionIntent({
        text: payload.text,
        requestedDelivery,
        admittedDelivery: "queue",
        ...(routingMode === "guide" ? { fallbackReasonCode: HIGHSPEED_QUEUE_FALLBACK_REASON } : {}),
        attachmentRefs: payload.attachments,
      });
      intent.modelSelection = ordinarySelection;
      if (!retainQueuedTurnExecution) delete intent.highspeed;
      const queued = await startPromptTurn(host, record, {
        content: payload.text,
        ...(payload.browserAmbientContext
          ? { browserAmbientContext: payload.browserAmbientContext }
          : {}),
        inputId: envelope.commandId,
        intent,
        requireQueue: true,
        ...(attachments ? { attachments } : {}),
        toolDisallowlist: payload.toolDisallowlist,
      });
      if (queued.admission.kind !== "queued") {
        throw new V4InputAdmissionRejectedError(
          "fault.command.inputRejected",
          "Highspeed input was not admitted to the queue",
        );
      }
      return {
        type: "inputAccepted",
        delivery: "queue",
        inputId: envelope.commandId,
      };
    } catch (error) {
      if (retainQueuedTurnExecution) {
        host.deleteQueuedTurnExecution?.(record.app.sessionId, envelope.commandId);
      }
      throw error;
    }
  };

  if (highspeedRequiresQueue) {
    return await queueHighspeedTurn();
  }
  const foregroundPromotionLeaseId = forceStartNow ? `send-now:${envelope.commandId}` : undefined;
  let foregroundPromotionLeaseAcquired = false;
  let preempted = false;
  const releaseForegroundPromotionLease = () => {
    if (!foregroundPromotionLeaseAcquired || !foregroundPromotionLeaseId) return;
    record.app.runtime.releaseForegroundPromotionLease(foregroundPromotionLeaseId);
    foregroundPromotionLeaseAcquired = false;
  };
  if (forceStartNow) {
    const leaseResult = record.app.runtime.acquireForegroundPromotionLease({
      leaseId: foregroundPromotionLeaseId!,
      mode: "after-current",
      promotedInputId: envelope.commandId,
    });
    if (leaseResult.kind !== "acquired") {
      throw new V4InputAdmissionRejectedError(
        "fault.command.inputRejected",
        "send now foreground promotion is busy",
      );
    }
    foregroundPromotionLeaseAcquired = true;
    try {
      await applyHeldQueueDisposition(
        host,
        record,
        payload.heldQueueDisposition,
        payload.expectedHeldQueueItemIds,
      );
      preempted = await preemptActiveTurnAndWait(host, record, {
        abortMessage: "v4 sendText startNow preempts active turn",
        goalPausedMutationReason: "send_now_goal_paused",
        preserveQueueAutoDrainOnCancel: true,
      });
    } catch (error) {
      releaseForegroundPromotionLease();
      throw error;
    }
  }
  if (!forceStartNow) {
    await applyHeldQueueDisposition(
      host,
      record,
      payload.heldQueueDisposition,
      payload.expectedHeldQueueItemIds,
    );
  }
  let started;
  try {
    const intent = submissionIntent({
      text: payload.text,
      inputOrigin: payload.inputOrigin,
      botGroupSource: payload.botGroupSource,
      conversationQuotes: payload.conversationQuotes,
      requestedDelivery:
        payload.requestedDelivery ??
        (routingMode === "guide" ? "guide" : routingMode === "enqueue" ? "queue" : "startNow"),
      ...(payload.requestedDelivery !== "guide" && routingMode === "guide" && attachments?.length
        ? { fallbackReasonCode: "guide.attachmentsUnsupported" }
        : {}),
      attachmentRefs: payload.attachments,
      sharedContextRefs: payload.context_refs,
      ...(payload.source ? { source: payload.source } : {}),
    });
    started = await startPromptTurn(host, record, {
      content: payload.text,
      ...(payload.browserAmbientContext
        ? { browserAmbientContext: payload.browserAmbientContext }
        : {}),
      inputId: envelope.commandId,
      ...(preempted && !attachments?.length ? { inputPresentation: "user_steer" as const } : {}),
      intent,
      ...(payload.context_refs ? { sharedContextRefs: payload.context_refs } : {}),
      ...turnBackgroundAttributionOf(payload),
      ...(payload.botDeliveryTarget ? { botDeliveryTarget: payload.botDeliveryTarget } : {}),
      toolDisallowlist: payload.toolDisallowlist,
      ...(payload.modelExecution
        ? { modelExecution: createModelExecutionContext(payload.modelExecution) }
        : {}),
      ...(attachments ? { attachments } : {}),
      ...(forceStartNow ? { requireIdle: true } : {}),
    });
  } catch (error) {
    if (
      highspeedExecution &&
      error instanceof V4PromptRejectedError &&
      error.reasonCode === "activePrompt"
    ) {
      return await queueHighspeedTurn();
    }
    throw error;
  } finally {
    releaseForegroundPromotionLease();
  }
  if (started.admission.kind === "queued") {
    return {
      type: "inputAccepted",
      delivery: "queue",
      inputId: envelope.commandId,
    };
  }
  return {
    type: "inputAccepted",
    delivery: "startNow",
    inputId: envelope.commandId,
  };
}

async function stop(
  host: V4CommandCoreHost,
  envelope: CommandEnvelope,
): Promise<CommandResult | undefined> {
  const record = requireRecord(host, envelope.sessionId);
  const payload = envelope.payload as CommandPayloadMap["stop"];
  const runtimeStop = record.app.runtime?.stopActiveForegroundExecution?.({
    expectedForegroundExecutionId: payload.expectedForegroundExecutionId,
    reason: "v4 session stopped",
  });
  host.logger?.info?.("v4 stop foreground execution inspected", {
    activeForegroundExecutionId:
      runtimeStop?.kind === "mismatch"
        ? runtimeStop.activeForegroundExecutionId
        : runtimeStop?.kind === "stopped"
          ? runtimeStop.foregroundExecutionId
          : undefined,
    event: "v4.stop.foreground_execution_inspected",
    expectedForegroundExecutionId: payload.expectedForegroundExecutionId,
    module: "bootstrap.cf_protocol_v4.commands",
    runtimeStopKind: runtimeStop?.kind ?? "unsupported",
    sessionId: record.app.sessionId,
  });
  if (
    payload.expectedForegroundExecutionId !== undefined &&
    (runtimeStop?.kind === "idle" || runtimeStop?.kind === "mismatch")
  ) {
    throw new V4CommandNoopError("guard.stopTargetChanged");
  }
  if (runtimeStop?.kind === "stopped") {
    record.activeAbortController?.abort(new Error("v4 session stopped"));
    if ((host.getQueueLength?.(record.app.sessionId) ?? 0) > 0) {
      try {
        await record.app.setQueueAutoDrain(false);
      } catch (error) {
        host.logger?.warn?.("v4 stop failed to hold following queue", {
          error: error instanceof Error ? error.message : String(error),
          sessionId: record.app.sessionId,
        });
      }
    }
    const pausedGoal = await pauseActiveGoal(host, record);
    if (pausedGoal) {
      await host.afterLegacyStateMutation?.(record, "session_stop_goal_paused");
    }
    return undefined;
  }

  const hadActivePrompt = Boolean(record.activeAbortController);
  let pausedGoal = false;
  if (hadActivePrompt) {
    pausedGoal = await pauseActiveGoal(host, record);
  }
  record.activeAbortController?.abort(new Error("v4 session stopped"));
  if (pausedGoal) {
    await host.afterLegacyStateMutation?.(record, "session_stop_goal_paused");
  }
  return undefined;
}

export async function pauseActiveGoal(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
): Promise<boolean> {
  const target = await record.app.readTarget();
  if (!target || target.status !== "active") {
    return false;
  }
  try {
    const paused = await record.app.updateTargetStatus("paused");
    return Boolean(paused);
  } catch (error) {
    host.logger?.warn?.("v4 stop failed to pause active goal", {
      error: error instanceof Error ? error.message : String(error),
      sessionId: record.app.sessionId,
    });
    return false;
  }
}

export async function waitForSessionIdle(record: V4SessionRecordView): Promise<void> {
  const deadline = Date.now() + IDLE_POLL_TIMEOUT_MS;
  while (true) {
    const coreTurnActive = record.app.runtime?.getActiveTurnInfo?.() !== undefined;
    if (
      record.activeAbortController === undefined &&
      record.app.runtime?.getActiveForegroundExecutionId?.() === undefined &&
      !coreTurnActive
    ) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new V4SessionIdleTimeoutError(record.app.sessionId);
    }
    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_INTERVAL_MS));
  }
}

export async function preemptActiveTurnAndWait(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  options: {
    abortMessage: string;
    goalPausedMutationReason: string;
    preserveQueueAutoDrainOnCancel?: boolean;
  },
): Promise<boolean> {
  const bootstrapAbortController = record.activeAbortController;
  const runtimeStop = record.app.runtime?.stopActiveForegroundExecution?.({
    preserveQueueAutoDrainOnCancel: options.preserveQueueAutoDrainOnCancel === true,
    reason: options.abortMessage,
  });
  if (bootstrapAbortController || runtimeStop?.kind === "stopped") {
    const pausedGoal = await pauseActiveGoal(host, record);
    if (runtimeStop?.kind !== "stopped") {
      bootstrapAbortController?.abort(new Error(options.abortMessage));
    }
    if (pausedGoal) {
      await host.afterLegacyStateMutation?.(record, options.goalPausedMutationReason);
    }
  }
  await waitForSessionIdle(record);
  return runtimeStop?.kind === "stopped";
}

export const sessionFlowHandlers = { sendText, stop };
