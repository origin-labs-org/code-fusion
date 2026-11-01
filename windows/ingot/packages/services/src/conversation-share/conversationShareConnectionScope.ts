import { Event as RpcEvent } from "@origin-ai/cf-rpc";
import type { IConversationShareService } from "#src/conversation-share/conversationShare.js";
import type { ICfAgentService } from "#src/cf-agent/cfAgent.js";
import {
  readTrustedCfAgentV4Connection,
  withTrustedCfAgentV4Connection,
  type CfAgentV4ConnectionContext,
} from "#src/cf-agent/cfAgentConnectionScope.js";
import { conversationShareConnectionScopeFactory } from "#src/conversation-share/conversationShareService.js";

type ConversationShareAgentService = Pick<
  ICfAgentService,
  | "conversationRowsRangeV4"
  | "conversationFileChangesV4"
  | "conversationAttachmentReadV4"
  | "conversationAttachmentStatV4"
>;

type ConnectionScopableConversationShareService = IConversationShareService & {
  [conversationShareConnectionScopeFactory](
    agentService: ConversationShareAgentService,
  ): IConversationShareService;
};

function isConnectionScopableConversationShareService(
  service: IConversationShareService,
): service is ConnectionScopableConversationShareService {
  return (
    conversationShareConnectionScopeFactory in service &&
    typeof service[conversationShareConnectionScopeFactory] === "function"
  );
}

export function scopeConversationShareServiceForAttachment(
  service: IConversationShareService,
  clientMode: "desktop-continuous" | "web-remote-replayable",
  agentService?: ConversationShareAgentService,
  connection?: CfAgentV4ConnectionContext,
): IConversationShareService {
  if (clientMode === "desktop-continuous") {
    if (connection?.role === "trusted-host-relay") {
      const forInput = (input: unknown) => {
        const downstream = readTrustedCfAgentV4Connection(input);
        if (
          !downstream ||
          downstream.clientMode !== "desktop-continuous" ||
          !agentService ||
          !isConnectionScopableConversationShareService(service)
        ) {
          throw Object.assign(new Error("Conversation sharing connection is not trusted"), {
            kind: "connection_unavailable" as const,
          });
        }
        const scopedAgent: ConversationShareAgentService = {
          conversationRowsRangeV4: (params) =>
            agentService.conversationRowsRangeV4(
              withTrustedCfAgentV4Connection(params, downstream),
            ),
          conversationFileChangesV4: (params) =>
            agentService.conversationFileChangesV4(
              withTrustedCfAgentV4Connection(params, downstream),
            ),
          conversationAttachmentReadV4: (params) =>
            agentService.conversationAttachmentReadV4(
              withTrustedCfAgentV4Connection(params, downstream),
            ),
          conversationAttachmentStatV4: (params) =>
            agentService.conversationAttachmentStatV4(
              withTrustedCfAgentV4Connection(params, downstream),
            ),
        };
        return service[conversationShareConnectionScopeFactory](scopedAgent);
      };
      return {
        getCapabilities: () => service.getCapabilities(),
        preflight: async (input) => forInput(input).preflight(input),
        publish: async (input, operationId) => forInput(input).publish(input, operationId),
        onDynamicPublishProgress: (id) => service.onDynamicPublishProgress(id),
        importShare: async (input, id) => forInput(input).importShare(input, id),
        onDynamicImportProgress: (id) => service.onDynamicImportProgress(id),
        getImportedConversation: (input) => service.getImportedConversation(input),
        getPreview: (code) => service.getPreview(code),
        getContinuation: async (input) => forInput(input).getContinuation(input),
      };
    }
    if (!isConnectionScopableConversationShareService(service)) {
      if (!connection) return service;
      return {
        getCapabilities: () => service.getCapabilities(),
        preflight: (input) =>
          service.preflight(withTrustedCfAgentV4Connection(input, connection)),
        publish: (input, id) =>
          service.publish(withTrustedCfAgentV4Connection(input, connection), id),
        onDynamicPublishProgress: (id) => service.onDynamicPublishProgress(id),
        importShare: (input, id) =>
          service.importShare(withTrustedCfAgentV4Connection(input, connection), id),
        onDynamicImportProgress: (id) => service.onDynamicImportProgress(id),
        getImportedConversation: (input) => service.getImportedConversation(input),
        getPreview: (code) => service.getPreview(code),
        getContinuation: (input) =>
          service.getContinuation(withTrustedCfAgentV4Connection(input, connection)),
      };
    }
    if (agentService) return service[conversationShareConnectionScopeFactory](agentService);
    const rejectUnavailable = async (): Promise<never> => {
      throw Object.assign(new Error("Conversation sharing connection is not ready"), {
        kind: "connection_unavailable" as const,
      });
    };
    return {
      getCapabilities: () => service.getCapabilities(),
      preflight: (input) => service.preflight(input),
      publish: rejectUnavailable,
      onDynamicPublishProgress: (operationId) => service.onDynamicPublishProgress(operationId),
      importShare: (input, operationId) => service.importShare(input, operationId),
      onDynamicImportProgress: (operationId) => service.onDynamicImportProgress(operationId),
      getImportedConversation: (input) => service.getImportedConversation(input),
      getPreview: (shareCode) => service.getPreview(shareCode),
      getContinuation: (input) => service.getContinuation(input),
    };
  }
  const rejectMobileShare = async (): Promise<never> => {
    throw Object.assign(new Error("Conversation sharing is only available from Desktop"), {
      kind: "feature_disabled" as const,
    });
  };
  return {
    getCapabilities: () => service.getCapabilities(),
    preflight: rejectMobileShare,
    publish: rejectMobileShare,
    onDynamicPublishProgress: () => RpcEvent.None,
    importShare: rejectMobileShare,
    onDynamicImportProgress: () => RpcEvent.None,
    getImportedConversation: async () => null,
    getPreview: (shareCode: string) => service.getPreview(shareCode),
    getContinuation: rejectMobileShare,
  };
}
