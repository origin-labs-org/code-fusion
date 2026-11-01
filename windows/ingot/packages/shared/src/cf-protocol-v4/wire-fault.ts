//
//
//
// （conversationProjectionStore / sessionsIndexStore）。

export const WIRE_FAULT_INVALID_PAYLOAD = "proto.frameAssemblyInvalidPayload";

export function isDeterministicContentFault(reasonCode: string | undefined): boolean {
  return reasonCode === WIRE_FAULT_INVALID_PAYLOAD;
}

export const SUBSCRIPTION_CONTENT_REJECTED = "fault.subscription.contentRejected";
