import type {
  ModelSelection,
  CfAgentMcpServer,
  CfAutomationScheduleRule,
  CfMcpListMode,
} from "@origin-ai/cf-shared";
import type { McpAppsAppToolCallResult, McpAppsAppToolDescriptor } from "@origin-ai/cf-shared/mcp-apps";

export interface CfAgentWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  
  remoteSessionId?: string;
}

export interface CfAgentPluginMutationTarget extends CfAgentWorkspaceTarget {
  
  telemetry?: {
    entry?:
      | "store_list"
      | "store_detail"
      | "side_pane_market"
      | "recommended_prompt"
      | "recommended_ui"
      | "component_settings";
    client_kind?: "desktop" | "mobile";
    trigger?: "user" | "automatic" | "dependency" | "restore" | "sync";
  };
}

export interface CfAgentPluginViewParams extends CfAgentWorkspaceTarget {
  configScope?: "user" | "workspace";
}

export interface CfAgentListMcpServerStatusesParams extends CfAgentWorkspaceTarget {
  mcpServers?: CfAgentMcpServer[];
  mode?: CfMcpListMode;
}

export interface CfAgentAddPluginMarketplaceParams extends CfAgentPluginMutationTarget {
  dryRun?: boolean;
  operationId?: string;
  source: string;
}

export interface CfAgentRemovePluginMarketplaceParams extends CfAgentPluginMutationTarget {
  marketplace: string;
}

export interface CfAgentUpdatePluginMarketplaceParams extends CfAgentPluginMutationTarget {
  marketplace?: string;
  operationId?: string;
}

export interface CfAgentInstallPluginParams extends CfAgentPluginMutationTarget {
  dryRun?: boolean;
  marketplace: string;
  operationId?: string;
  pluginName: string;
  scope?: "user" | "workspace";
}

export interface CfAgentCancelPluginOperationParams {
  operationId: string;
}

export interface CfAgentUninstallPluginParams extends CfAgentPluginMutationTarget {
  marketplace?: string;
  pluginId?: string;
  pluginName?: string;
  removeCache?: boolean;
}

export interface CfAgentUpdatePluginParams extends CfAgentPluginMutationTarget {
  pluginId?: string;
  marketplace?: string;
}

export interface CfAgentRestoreBuiltinPluginParams extends CfAgentPluginMutationTarget {
  pluginId: string;
}

export interface CfAgentConfigurePluginParams extends CfAgentPluginMutationTarget {
  clearOptionKeys?: string[];
  dryRun?: boolean;
  options: Record<string, unknown>;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface CfAgentResetPluginConfigParams extends CfAgentPluginMutationTarget {
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface CfAgentValidatePluginParams extends CfAgentWorkspaceTarget {
  marketplace?: string;
  pluginName?: string;
  source?: string;
}

export interface CfAgentDescribePluginParams extends CfAgentWorkspaceTarget {
  marketplace: string;
  pluginName: string;
}

export interface CfAgentSetPluginEnabledParams extends CfAgentPluginMutationTarget {
  enabled: boolean;
  operationId?: string;
  pluginId: string;
  scope?: "user" | "workspace";
}

export interface CfAgentPluginReferenceCatalogParams extends CfAgentWorkspaceTarget {
  sessionId?: string;
}

export interface CfAgentSkillReferenceCatalogParams extends CfAgentWorkspaceTarget {
  sessionId?: string;
}

export interface CfAgentReadMcpResourceParams extends CfAgentWorkspaceTarget {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  uri: string;
}

export type CfAgentReadMcpResourceForUiParams = CfAgentReadMcpResourceParams;

export interface CfAgentCallMcpToolForUiParams extends CfAgentWorkspaceTarget {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  
  callId: string;
}

export interface CfAgentListMcpResourcesForUiParams extends CfAgentWorkspaceTarget {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  cursor?: string;
}

export interface CfAgentAppToolInstanceForUiParams extends CfAgentWorkspaceTarget {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  scopeId: string;
  generation: number;
}
export interface CfAgentRegisterAppToolsForUiParams extends CfAgentAppToolInstanceForUiParams {
  tools: McpAppsAppToolDescriptor[];
}
export interface CfAgentAppToolCallForUiParams extends CfAgentAppToolInstanceForUiParams {
  callId: string;
}
export interface CfAgentResolveAppToolCallForUiParams extends CfAgentAppToolCallForUiParams {
  result?: McpAppsAppToolCallResult;
  error?: { message: string };
}
export interface CfAgentMcpResourceSubscriptionForUiParams extends CfAgentWorkspaceTarget {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  scopeId: string;
  generation: number;
  uri: string;
}
export interface CfAgentCancelMcpToolCallForUiParams extends CfAgentWorkspaceTarget {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
  callId: string;
}
export interface CfAgentResolveSuggestedPluginReferenceParams extends CfAgentWorkspaceTarget {
  stableId: string;
  operationId: string;
  clientMode: "desktop-continuous" | "web-remote-replayable";
  deliveryKind: "desktop-continuous" | "web-remote-replayable";
}

export interface CfAgentCreateAutomationParams extends CfAgentWorkspaceTarget {
  projectId?: string | null;
  title: string;
  cronExpr: string;
  relativeDelayMinutes?: number;
  prompt: string;
  modelSelection?: ModelSelection;
  mode?: string;
  recurring?: boolean;
  maxRuns?: number;
  endAt?: number;
  scheduleRule?: CfAutomationScheduleRule;
}

export interface CfAgentUpdateAutomationParams extends CfAgentWorkspaceTarget {
  automationId: string;
  title?: string;
  cronExpr?: string;
  prompt?: string;
  modelSelection?: ModelSelection | null;
  mode?: string | null;
  recurring?: boolean;
  maxRuns?: number | null;
  endAt?: number | null;
  scheduleRule?: CfAutomationScheduleRule | null;
  scheduleEditedByUser?: boolean;
}

export interface CfAgentAutomationIdParams extends CfAgentWorkspaceTarget {
  automationId: string;
}

export interface CfAgentSetAutomationEnabledParams extends CfAgentWorkspaceTarget {
  automationId: string;
  enabled: boolean;
}

export interface CfAgentDeleteAutomationRunParams extends CfAgentWorkspaceTarget {
  runId: string;
}
