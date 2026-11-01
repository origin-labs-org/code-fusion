import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";
import type {
  CfConfigOption,
  CfProvider,
  BotConfig,
  BotContextState,
  BotInboundMessage,
  BotOutboundMessage,
  BotProvider,
  BotProviderCallbackResult,
  BotServiceStatus,
  BotWorkspaceRef,
  BotsConfigFile,
  CfAutomationBotDeliveryTarget,
} from "@origin-ai/cf-shared";
import type { CfAgentAppRuntimePreferences } from "../cf-agent/cfAgent.js";

export interface BotCreateBindCodeParams {
  botId?: string;
  allowedWorkspaces?: string[];
  ttlMs?: number;
}

export interface BotSaveBotParams {
  bot: BotConfig;
  credentialValue?: string;
  webhookSecretValue?: string;
}

export interface BotTestResult {
  ok: boolean;
  message: string;
  name?: string;
  provider?: BotProvider;
}

export interface BotBindCodeResult {
  code: string;
  expiresAt: number;
}

export interface BotListWorkspaceRefsParams {
  currentWorkspace?: BotWorkspaceRef;
}

export interface BotUserConfigOptionsParams {
  workspacePath: string;
  workspaceIdentity?: string;
  provider: CfProvider;
}

export interface BotAutomationRunWatchParams {
  
  runId?: string;
  target: CfAutomationBotDeliveryTarget;
  taskId: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface BotWeixinRegistrationBeginResult {
  qrCode: string;
  qrUrl: string;
  interval: number;
  expiresAt: number;
}

export interface BotWeixinRegistrationPollParams {
  qrCode: string;
}

export type BotWeixinRegistrationPollResult =
  | {
      status: "pending" | "scanned";
      interval: number;
    }
  | {
      status: "success";
      botToken: string;
      botId?: string;
    }
  | {
      status: "expired" | "error";
      message?: string;
    };

export interface BotFeishuRegistrationBeginParams {
  domain?: "feishu" | "lark";
}

export interface BotFeishuRegistrationBeginResult {
  deviceCode: string;
  qrUrl: string;
  userCode: string;
  interval: number;
  expiresAt: number;
  domain: "feishu" | "lark";
  pollDomain?: "feishu" | "lark";
}

export interface BotFeishuRegistrationPollParams {
  deviceCode: string;
  domain?: "feishu" | "lark";
  pollDomain?: "feishu" | "lark";
}

export type BotFeishuRegistrationPollResult =
  | {
      status: "pending";
      interval: number;
      domain: "feishu" | "lark";
      pollDomain?: "feishu" | "lark";
    }
  | {
      status: "success";
      appId: string;
      appSecret: string;
      domain: "feishu" | "lark";
      appName?: string;
      openId?: string;
    }
  | {
      status: "access_denied" | "expired" | "error";
      message?: string;
      domain: "feishu" | "lark";
    };

export interface IBotsService {
  replyToChannel?(
    params: import("@origin-ai/cf-shared").ChannelReplyHostRequest,
  ): Promise<import("@origin-ai/cf-shared").ChannelReplyResult>;
  validateTopicResource?(
    params: import("#src/bots/topicResource.js").TopicResourceRequest,
  ): Promise<void>;
  readTopicResource?(
    params: import("#src/bots/topicResource.js").TopicResourceRequest,
  ): Promise<import("@origin-ai/cf-shared").CfPromptAttachment>;
  
  syncAppRuntimePreferences(preferences: CfAgentAppRuntimePreferences): Promise<void>;
  getStatus(): Promise<BotServiceStatus>;
  getConfig(): Promise<BotsConfigFile>;
  listWorkspaceRefs(params?: BotListWorkspaceRefsParams): Promise<BotWorkspaceRef[]>;
  getUserConfigOptions(params: BotUserConfigOptionsParams): Promise<CfConfigOption[]>;
  beginFeishuRegistration(
    params?: BotFeishuRegistrationBeginParams,
  ): Promise<BotFeishuRegistrationBeginResult>;
  pollFeishuRegistration(
    params: BotFeishuRegistrationPollParams,
  ): Promise<BotFeishuRegistrationPollResult>;
  beginWeixinRegistration(): Promise<BotWeixinRegistrationBeginResult>;
  pollWeixinRegistration(
    params: BotWeixinRegistrationPollParams,
  ): Promise<BotWeixinRegistrationPollResult>;
  saveConfig(config: BotsConfigFile): Promise<BotsConfigFile>;
  listBots(): Promise<BotConfig[]>;
  saveBot(params: BotSaveBotParams): Promise<BotConfig>;
  removeBotSecret(botId: string): Promise<BotConfig>;
  deleteBot(botId: string): Promise<void>;
  testBot(botId: string): Promise<BotTestResult>;
  createBindCode(params: BotCreateBindCodeParams): Promise<BotBindCodeResult>;
  getGroupMemberNames?(params: { botId: string; chatId: string }): Promise<Record<string, string>>;
  getBotStates(): Promise<BotContextState[]>;
  retryTopicPreparation?(params: {
    botId: string;
    chatId: string;
    threadId: string;
    messageId: string;
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<void>;
  getTopicDetails?(params: {
    botId: string;
    chatId: string;
    threadId?: string;
    taskId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }): Promise<{
    messageCount: number;
    hasGap: boolean;
    historyEnabled: boolean;
    summaries: Array<{ checkpoint: string; text: string }>;
  }>;

  setGroupEnabled?(params: { botId: string; chatId: string; enabled: boolean }): Promise<void>;
  reconcileGroupResult?(params: {
    botId: string;
    chatId: string;
    deliveryId: string;
    threadId?: string;
    received: boolean;
  }): Promise<import("@origin-ai/cf-shared").BotGroupDelivery>;
  resendGroupResult?(params: {
    botId: string;
    chatId: string;
    deliveryId: string;
    threadId?: string;
  }): Promise<import("@origin-ai/cf-shared").BotGroupDelivery>;
  retryPrivateDelivery?(params: { botId: string; deliveryId: string }): Promise<void>;
  resetBotState(contextKey: string): Promise<void>;
  
  watchAutomationRun(params: BotAutomationRunWatchParams): Promise<void>;
  handleInboundMessage(message: BotInboundMessage): Promise<BotOutboundMessage[]>;
  handleProviderCallback(provider: BotProvider, payload: unknown): Promise<BotOutboundMessage[]>;
  handleProviderCallbackResponse(
    provider: BotProvider,
    payload: unknown,
  ): Promise<BotProviderCallbackResult>;
}

export const IBotsService = createServiceDescriptor<IBotsService>(ServiceChannels.Bots);

export interface BotRemoteWorkspaceResolution {
  workspacePath: string;
  workspaceIdentity: string;
  target: import("@origin-ai/cf-shared").RemoteTarget;
  
  runtimeKey?: string;
}
export type BotRemoteWorkspaceResolver = (
  workspace: { workspacePath: string; workspaceIdentity: string },
  purpose: "lookup" | "reconnect",
) => Promise<BotRemoteWorkspaceResolution | null>;
