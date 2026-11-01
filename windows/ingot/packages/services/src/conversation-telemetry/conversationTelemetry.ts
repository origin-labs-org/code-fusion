import type { Event } from "@origin-ai/cf-rpc";
import type { ConversationTelemetryFact } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ICfAgentService } from "#src/cf-agent/cfAgent.js";

export interface ConversationTelemetryWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface IConversationTelemetryService {
  onFact(target: ConversationTelemetryWorkspaceTarget): Event<ConversationTelemetryFact>;
}

export function createConversationTelemetryService(
  cfAgentService: Pick<ICfAgentService, "onDynamicConversationTelemetryFact">,
): IConversationTelemetryService {
  return {
    onFact: (target) =>
      cfAgentService.onDynamicConversationTelemetryFact(target),
  };
}
