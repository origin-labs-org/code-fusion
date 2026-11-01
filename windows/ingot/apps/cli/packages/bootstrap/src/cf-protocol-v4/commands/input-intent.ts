import type { TurnInputIntentMetadata } from "@origin-ai/cf-contracts";
import type { ModelSelection } from "@origin-ai/cf-shared";
import type {
  AttachmentRef,
  CommandEnvelope,
  CommandPayloadMap,
  QueueItem,
  SubmissionMode,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { commandAdmissionOf } from "./executor.js";

export interface CanonicalCommandIntent {
  inputOrigin?: "desktop" | "mobile";
  conversationQuotes?: import("@origin-ai/cf-contracts").TurnInputIntentMetadata["conversationQuotes"];
  botGroupSource?: TurnInputIntentMetadata["botGroupSource"];
  kind: "sendText" | "sendGoalCommand";
  text: string;
  modelSelection?: ModelSelection;
  mode?: SubmissionMode;
  planEnabled?: boolean;
  sourceCommandId?: string;
  clientId?: string;
  queueItemId?: string;
  requestedDelivery?: TurnInputIntentMetadata["requestedDelivery"];
  admittedDelivery?: TurnInputIntentMetadata["admittedDelivery"];
  fallbackReasonCode?: string;
  attachmentRefs?: readonly AttachmentRef[];
  sharedContextRefs?: TurnInputIntentMetadata["sharedContextRefs"];
  provenance?: TurnInputIntentMetadata["provenance"];
  source?: TurnInputIntentMetadata["source"];
}

export function inputIntentMetadata(
  envelope: CommandEnvelope,
  options: {
    text: string;
    inputOrigin?: "desktop" | "mobile";
    conversationQuotes?: import("@origin-ai/cf-contracts").TurnInputIntentMetadata["conversationQuotes"];
    botGroupSource?: TurnInputIntentMetadata["botGroupSource"];
    requestedDelivery: TurnInputIntentMetadata["requestedDelivery"];
    admittedDelivery?: TurnInputIntentMetadata["admittedDelivery"];
    fallbackReasonCode?: string;
    attachmentRefs?: readonly AttachmentRef[];
    modelSelection?: ModelSelection;
    mode?: SubmissionMode;
    planEnabled?: boolean;
    sharedContextRefs?: TurnInputIntentMetadata["sharedContextRefs"];
    source?: TurnInputIntentMetadata["source"];
  },
): TurnInputIntentMetadata {
  const admission = commandAdmissionOf(envelope);
  const highspeed =
    envelope.type === "sendText"
      ? (envelope.payload as CommandPayloadMap["sendText"]).highspeedMeta
      : undefined;
  return {
    ...(options.inputOrigin ? { inputOrigin: options.inputOrigin } : {}),
    ...(options.conversationQuotes ? { conversationQuotes: options.conversationQuotes } : {}),
    ...(options.botGroupSource ? { botGroupSource: options.botGroupSource } : {}),
    sourceCommandId: envelope.commandId,
    queueItemId: admission.queueItemId,
    clientId: envelope.clientId || "cli",
    kind:
      envelope.type === "compact"
        ? "compact"
        : envelope.type === "sendGoalCommand"
          ? "sendGoalCommand"
          : "sendText",
    text: options.text,
    ...(options.modelSelection ? { modelSelection: options.modelSelection } : {}),
    ...(options.mode ? { mode: options.mode } : {}),
    ...(options.planEnabled !== undefined ? { planEnabled: options.planEnabled } : {}),
    admissionSeq: admission.admissionSeq,
    admittedAt: admission.admittedAt,
    requestedDelivery: options.requestedDelivery,
    admittedDelivery:
      options.admittedDelivery ??
      (options.requestedDelivery === "guide"
        ? "guide"
        : options.requestedDelivery === "queue"
          ? "queue"
          : "startNow"),
    ...(options.fallbackReasonCode ? { fallbackReasonCode: options.fallbackReasonCode } : {}),
    ...(options.attachmentRefs ? { attachmentRefs: [...options.attachmentRefs] } : {}),
    ...(options.sharedContextRefs ? { sharedContextRefs: [...options.sharedContextRefs] } : {}),
    ...(highspeed ? { highspeed } : {}),
    ...(options.source ? { source: options.source } : {}),
  };
}

export function inputIntentMetadataFromCanonical(
  envelope: CommandEnvelope,
  canonical: CanonicalCommandIntent,
  text = canonical.text,
): TurnInputIntentMetadata {
  const admission = commandAdmissionOf(envelope);
  const originalSourceCommandId =
    canonical.provenance?.sourceCommandId ?? canonical.sourceCommandId;
  return {
    ...(canonical.inputOrigin ? { inputOrigin: canonical.inputOrigin } : {}),
    ...(canonical.conversationQuotes ? { conversationQuotes: canonical.conversationQuotes } : {}),
    ...(canonical.botGroupSource ? { botGroupSource: canonical.botGroupSource } : {}),
    sourceCommandId: envelope.commandId,
    queueItemId: admission.queueItemId,
    clientId: envelope.clientId || canonical.clientId || "cli",
    kind: canonical.kind,
    text,
    ...(canonical.modelSelection ? { modelSelection: canonical.modelSelection } : {}),
    ...(canonical.mode ? { mode: canonical.mode } : {}),
    ...(canonical.planEnabled !== undefined ? { planEnabled: canonical.planEnabled } : {}),
    admissionSeq: admission.admissionSeq,
    admittedAt: admission.admittedAt,
    requestedDelivery: canonical.requestedDelivery ?? "startNow",
    admittedDelivery: canonical.admittedDelivery ?? "startNow",
    ...(canonical.fallbackReasonCode ? { fallbackReasonCode: canonical.fallbackReasonCode } : {}),
    ...(canonical.attachmentRefs ? { attachmentRefs: [...canonical.attachmentRefs] } : {}),
    ...(canonical.sharedContextRefs ? { sharedContextRefs: [...canonical.sharedContextRefs] } : {}),
    ...(canonical.source ? { source: canonical.source } : {}),
    ...(originalSourceCommandId
      ? {
          provenance: canonical.provenance ?? {
            sourceCommandId: originalSourceCommandId,
            ...(canonical.queueItemId ? { queueItemId: canonical.queueItemId } : {}),
            ...(canonical.clientId ? { clientId: canonical.clientId } : {}),
          },
        }
      : {}),
  };
}

export function inputIntentMetadataFromQueueItem(
  item: QueueItem,
  canonicalText: string,
): TurnInputIntentMetadata {
  return {
    ...(item.inputOrigin ? { inputOrigin: item.inputOrigin } : {}),
    ...(item.conversationQuotes ? { conversationQuotes: item.conversationQuotes } : {}),
    ...(item.botGroupSource ? { botGroupSource: item.botGroupSource } : {}),
    sourceCommandId: item.sourceCommandId,
    queueItemId: item.queueItemId,
    clientId: item.clientId,
    kind: item.kind,
    text: canonicalText,
    ...(item.modelSelection ? { modelSelection: item.modelSelection } : {}),
    ...(item.mode ? { mode: item.mode } : {}),
    ...(item.planEnabled !== undefined ? { planEnabled: item.planEnabled } : {}),
    admissionSeq: item.order.admissionSeq,
    admittedAt: item.admittedAt,
    requestedDelivery: item.delivery.requested,
    admittedDelivery: item.delivery.admitted,
    ...(item.order.queuePosition !== undefined ? { queuePosition: item.order.queuePosition } : {}),
    ...(item.delivery.fallbackReasonCode
      ? { fallbackReasonCode: item.delivery.fallbackReasonCode }
      : {}),
    attachmentRefs: item.attachments,
    ...(item.sharedContextRefs ? { sharedContextRefs: [...item.sharedContextRefs] } : {}),
    ...(item.highspeed ? { highspeed: item.highspeed } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.provenance ? { provenance: { ...item.provenance } } : {}),
  };
}
