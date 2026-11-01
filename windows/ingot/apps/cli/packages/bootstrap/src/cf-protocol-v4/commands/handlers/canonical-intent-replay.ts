import type { CommandEnvelope, CommandPayloadMap } from "@origin-ai/cf-shared/cf-protocol-v4";
import { isHighspeedProviderId } from "@origin-ai/cf-shared";
import type { mapAttachmentRefsToTurnAttachments } from "../attachment-refs.js";
import {
  resolveOrdinaryQueueModelSelection,
  resolveSessionFallbackModelSelection,
} from "../input-admission.js";
import { inputIntentMetadataFromCanonical } from "../input-intent.js";
import { preflightPromptTurn, startPreflightedPromptTurn } from "../prompt-turn.js";
import { createModelExecutionContext } from "../../../session-execution/index.js";
import type { V4CommandCoreHost, V4SessionRecordView, V4TurnExecution } from "../types.js";
import { applyGoalCommand } from "./goal-compact.js";
import type { ConversationEditTarget } from "../../product-projection.js";

const EDIT_QUEUE_FALLBACK_REASON = "edit.admissionRace";

type CanonicalHighspeed = {
  card: NonNullable<CommandPayloadMap["editUserQuery"]["highspeedMeta"]>;
  modelSelection: NonNullable<CommandPayloadMap["editUserQuery"]["modelSelection"]>;
  execution: V4TurnExecution;
};

export function stableAttachmentRefs(editTarget: ConversationEditTarget) {
  return editTarget.intent.attachments?.flatMap((attachment) =>
    attachment.ref ? [{ ...attachment, ref: attachment.ref }] : [],
  );
}

function buildCanonicalIntent(
  record: V4SessionRecordView,
  envelope: CommandEnvelope,
  editTarget: ConversationEditTarget,
  text: string,
  attachmentRefs: ReturnType<typeof stableAttachmentRefs>,
  highspeed: CanonicalHighspeed | undefined,
  requireQueue: boolean,
  canRetainQueuedHighspeed: boolean,
) {
  const intent = inputIntentMetadataFromCanonical(
    envelope,
    {
      kind: editTarget.intent.kind,
      conversationQuotes:
        envelope.type === "editUserQuery"
          ? ((envelope.payload as CommandPayloadMap["editUserQuery"]).conversationQuotes ??
            editTarget.intent.conversationQuotes)
          : editTarget.intent.conversationQuotes,
      text: editTarget.intent.text,
      sourceCommandId: editTarget.intent.sourceCommandId,
      clientId: editTarget.intent.clientId,
      queueItemId: editTarget.intent.queueItemId,
      requestedDelivery: editTarget.intent.requestedDelivery,
      admittedDelivery: editTarget.intent.admittedDelivery,
      fallbackReasonCode: editTarget.intent.fallbackReasonCode,
      modelSelection: editTarget.intent.modelSelection,
      mode: editTarget.intent.mode,
      planEnabled: editTarget.intent.planEnabled,
      attachmentRefs,
      provenance: editTarget.intent.provenance,
    },
    text,
  );
  const appliesHighspeed = highspeed !== undefined && (!requireQueue || canRetainQueuedHighspeed);
  if (appliesHighspeed && highspeed) {
    intent.highspeed = highspeed.card;
    if (requireQueue) {
      intent.modelSelection = highspeed.execution.selectionFallback?.target;
    } else {
      intent.modelSelection = highspeed.modelSelection;
    }
  } else if (isHighspeedProviderId(intent.modelSelection?.providerId)) {
    intent.modelSelection = resolveSessionFallbackModelSelection(record);
  }
  if (requireQueue) {
    intent.modelSelection = resolveOrdinaryQueueModelSelection(record, intent.modelSelection);
    intent.requestedDelivery = "queue";
    intent.admittedDelivery = "queue";
    intent.fallbackReasonCode = EDIT_QUEUE_FALLBACK_REASON;
  }
  return intent;
}

export async function preflightCanonicalIntent(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  envelope: CommandEnvelope,
  editTarget: ConversationEditTarget,
  text: string,
  attachmentRefs: ReturnType<typeof stableAttachmentRefs>,
  attachments: Awaited<ReturnType<typeof mapAttachmentRefsToTurnAttachments>>,
  highspeed?: CanonicalHighspeed,
): Promise<void> {
  if (editTarget.intent.kind === "sendGoalCommand") return;
  const intent = buildCanonicalIntent(
    record,
    envelope,
    editTarget,
    text,
    attachmentRefs,
    highspeed,
    false,
    false,
  );
  await preflightPromptTurn(host, record, {
    content: text,
    inputId: envelope.commandId,
    intent,
    ...(highspeed ? { modelExecution: createModelExecutionContext(highspeed.execution) } : {}),
    ...(attachments ? { attachments } : {}),
  });
}

export async function startCanonicalIntent(
  host: V4CommandCoreHost,
  record: V4SessionRecordView,
  envelope: CommandEnvelope,
  editTarget: ConversationEditTarget,
  text: string,
  attachmentRefs: ReturnType<typeof stableAttachmentRefs>,
  attachments: Awaited<ReturnType<typeof mapAttachmentRefsToTurnAttachments>>,
  highspeed?: CanonicalHighspeed,
  options?: { requireQueue?: boolean },
): Promise<void> {
  const requireQueue = options?.requireQueue === true;
  const retainQueuedTurnExecution = host.retainQueuedTurnExecution;
  const canRetainQueuedHighspeed =
    requireQueue && highspeed !== undefined && retainQueuedTurnExecution !== undefined;
  const intent = buildCanonicalIntent(
    record,
    envelope,
    editTarget,
    text,
    attachmentRefs,
    highspeed,
    requireQueue,
    canRetainQueuedHighspeed,
  );
  if (requireQueue) {
    if (canRetainQueuedHighspeed && highspeed && retainQueuedTurnExecution) {
      retainQueuedTurnExecution(record.app.sessionId, envelope.commandId, {
        modelSelection: highspeed.modelSelection,
        modelExecution: highspeed.execution,
      });
    }
  }
  if (editTarget.intent.kind === "sendGoalCommand") {
    await applyGoalCommand(host, record, {
      inputId: envelope.commandId,
      objective: text,
      intent,
    });
    return;
  }
  try {
    const started = await startPreflightedPromptTurn(host, record, {
      content: text,
      inputId: envelope.commandId,
      intent,
      ...(requireQueue
        ? { requireQueue: true }
        : highspeed
          ? { modelExecution: createModelExecutionContext(highspeed.execution) }
          : {}),
      ...(attachments ? { attachments } : {}),
    });
    if (requireQueue && started.admission.kind !== "queued") {
      throw new Error("edited input was not admitted to the queue");
    }
  } catch (error) {
    if (canRetainQueuedHighspeed) {
      host.deleteQueuedTurnExecution?.(record.app.sessionId, envelope.commandId);
    }
    throw error;
  }
}
