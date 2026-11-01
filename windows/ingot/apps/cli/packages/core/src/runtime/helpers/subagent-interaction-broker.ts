import type {
  PermissionBrokerPort,
  PermissionBrokerRequest,
  PermissionBrokerRequestOptions,
} from "../deps.js";
import {
  buildSubagentInteractionOrigin,
  type SubagentInteractionOriginContext,
} from "../../subagent/interaction-origin.js";

export interface SubagentInteractionBrokerContext extends SubagentInteractionOriginContext {
  parentToolCallId?: PermissionBrokerRequest["toolCallId"] | string;
}

type BrokerResponse = ReturnType<PermissionBrokerPort["requestPermission"]>;

export function createSubagentInteractionBroker(
  parentBroker: PermissionBrokerPort,
  context: SubagentInteractionBrokerContext,
): PermissionBrokerPort {
  return {
    requestPermission(
      request: PermissionBrokerRequest,
      options?: PermissionBrokerRequestOptions,
    ): BrokerResponse {
      //
      return parentBroker.requestPermission(
        {
          ...request,
          sessionId: context.parentSessionId,
          origin: request.origin ?? buildSubagentInteractionOrigin(context, request.turnId),
        },
        options,
      );
    },
  };
}
