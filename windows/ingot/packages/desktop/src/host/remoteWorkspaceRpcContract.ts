import type { IServiceAccessor } from "@origin-ai/cf-services";

export const REMOTE_WORKSPACE_RPC_CONTRACT_VERSION = 1 as const;

export const REMOTE_WORKSPACE_RPC_CHANNELS = [
  "fileService",
  "genUiService",
  "gitService",
  "gitCheckpointService",
  "systemService",
  "terminalService",
  "settingService",
  "onboardingRecordService",
  "credentialService",
  "broadcastService",
  "cfTaskService",
  "cfAgentService",
  "cfSessionService",
  "conversationShareService",
  "botsService",
  "fileWatcherService",
  "oauthService",
  "providerSettingsService",
  "modelSelectionService",
  "mediaPreviewService",
  "sourceServerWorkspaceService",
  "usageStatsService",
  "codingPlanSubscriptionService",
  "clientScenesService",
  "skillsService",
  "skillSyncService",
  "mcpSyncService",
  "pluginSyncService",
  "pluginsService",
  "pluginManagementService",
  "subagentsService",
  "commandsService",
  "hooksService",
  "memoryService",
  "outputStyleService",
  "settingsSyncService",
  "promptAttachmentTransferService",
] as const satisfies readonly (keyof IServiceAccessor)[];

export type RemoteWorkspaceRpcContract = {
  readonly [K in (typeof REMOTE_WORKSPACE_RPC_CHANNELS)[number]]: NonNullable<IServiceAccessor[K]>;
};

export function assertRemoteWorkspaceRpcContract(
  value: Partial<IServiceAccessor>,
): asserts value is Partial<IServiceAccessor> & RemoteWorkspaceRpcContract {
  const missing = REMOTE_WORKSPACE_RPC_CHANNELS.filter((channel) => {
    const service = value[channel];
    return (typeof service !== "object" || service === null) && typeof service !== "function";
  });
  if (missing.length > 0) {
    throw new Error(
      `Remote workspace RPC v${REMOTE_WORKSPACE_RPC_CONTRACT_VERSION} channel 不Complete: ${missing.join(", ")}`,
    );
  }
}
