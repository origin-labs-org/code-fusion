import { ICfAgentService, type IBotsService, type ServiceCollection } from "@origin-ai/cf-services";
import { createTopicResourceRelayChannel } from "@origin-ai/cf-services/node";
import type { WindowHostAttachmentScope, CfTopicResourceRelayRequest } from "@origin-ai/cf-shared";

export function createWindowTopicResourceRelay(deps: {
  getPeerAgentService(): ICfAgentService | undefined;
  resolveServices(scope: WindowHostAttachmentScope): ServiceCollection;
  getBots(): IBotsService | undefined;
}) {
  const resolve = (
    request: Pick<
      CfTopicResourceRelayRequest,
      "remoteSessionId" | "workspaceIdentity" | "workspacePath"
    >,
  ) => {
    const peer = deps.getPeerAgentService();
    if (
      !peer ||
      deps
        .resolveServices({
          kind: "remote",
          remoteSessionId: request.remoteSessionId,
          workspaceIdentity: request.workspaceIdentity,
          workspacePath: request.workspacePath,
        })
        .get(ICfAgentService) !== peer
    )
      throw new Error("Topic resource source connection mismatch");
    const bots = deps.getBots();
    if (!bots?.readTopicResource || !bots.validateTopicResource)
      throw new Error("Desktop topic resource service unavailable");
    return bots;
  };
  return createTopicResourceRelayChannel({
    reply: (request) => {
      if (!request.remoteSessionId || !request.workspaceIdentity)
        throw new Error("Remote channel reply scope missing");
      const bots = resolve({
        ...request,
        remoteSessionId: request.remoteSessionId,
        workspaceIdentity: request.workspaceIdentity,
      });
      if (!bots.replyToChannel) throw new Error("Bot channel reply unavailable");
      return bots.replyToChannel(request);
    },
    validate: (request, signal) => resolve(request).validateTopicResource!({ ...request, signal }),
    read: (request, signal) => resolve(request).readTopicResource!({ ...request, signal }),
  });
}
