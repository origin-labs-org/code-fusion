import type { Transport } from "@modelcontextprotocol/client";
import type {
  McpUiAppCapabilities,
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  IPluginUiAppToolsService,
  IPluginUiBridgeService,
  IPluginUiSamplingService,
} from "@origin-ai/cf-services";
import type {
  McpAppsToolInputPayload,
  McpAppsToolResultPayload,
  PluginSandboxHandle,
  PluginSandboxPlatformPort,
  PluginSandboxTransportPort,
  PluginUiScopeRef,
} from "@origin-ai/cf-shared/mcp-apps";
import type { PluginUiPresentation, PluginUiResourceNotificationTarget } from "../contract.js";
import type { PluginUiHostBridge } from "./pluginUiHostBridge.js";
import { type PluginUiInteractionCallbacks } from "./pluginUiInteractionPorts.js";

export type PluginUiHostPhase = "idle" | "preparing" | "mounted" | "running" | "error" | "disposed";

export interface PluginUiHostScope {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sessionId: string;
  
  scope: PluginUiScopeRef;
}

export interface PluginUiToolFeed {
  toolInput?: McpAppsToolInputPayload;
  toolResult?: McpAppsToolResultPayload;
  toolCancelled?: boolean;
}

export interface PluginUiHostControllerDeps extends PluginUiInteractionCallbacks {
  onBusyChange?(): void;
  onInstanceClosed?(): void;
  createTransport(port: PluginSandboxTransportPort): Transport;
  bridge: Pick<
    IPluginUiBridgeService,
    | "closeInstance"
    | "recycleInstance"
    | "validateInstance"
    | "prepareSandbox"
    | "callTool"
    | "cancelToolCall"
    | "readResource"
    | "listResources"
    | "listResourceTemplates"
    | "subscribeResource"
    | "unsubscribeResource"
  >;
  
  sampling?: IPluginUiSamplingService;
  appTools?: IPluginUiAppToolsService;
  platform: PluginSandboxPlatformPort;
  
  resourceNotifications?: {
    register(
      generation: number,
      target: PluginUiResourceNotificationTarget,
      instance: PluginSandboxHandle["instance"],
    ): () => void;
  };
  
  createCallId?: () => string;
  
  setTimer?: (callback: () => void, ms: number) => () => void;
  scope: PluginUiHostScope;
  presentation: PluginUiPresentation;
  
  getToolFeed(): PluginUiToolFeed;
  
  getWidgetState(): unknown;
  
  getHostCapabilities(): McpUiHostCapabilities;
  initialHostContext: McpUiHostContext;
  hostVersion: string;
  onPhase(
    phase: PluginUiHostPhase,
    detail?: { handle?: PluginSandboxHandle; error?: string },
  ): void;
  onHeight(height: number): void;
  
  onDisplayModeRequest(mode: McpUiDisplayMode): McpUiDisplayMode;
  onOpenExternal(url: string): void;
  
  onAppCapabilities?: (capabilities: McpUiAppCapabilities | undefined) => void;
  log?: (message: string, detail?: Record<string, unknown>) => void;
  
  createAppBridge?: (
    hostInfo: { name: string; version: string },
    hostCapabilities: McpUiHostCapabilities,
    hostContext: McpUiHostContext,
  ) => PluginUiHostBridge;
  handshakeTimeoutMs?: number;
  teardownTimeoutMs?: number;
}

export interface PluginUiHostController {
  isBusy(): boolean;
  tryRecycle(): Promise<boolean>;
  start(): void;
  updateHostContext(patch: Partial<McpUiHostContext>): void;
  
  notifyToolInput(input: McpAppsToolInputPayload): void;
  notifyToolResult(result: McpAppsToolResultPayload): void;
  
  notifyToolCancelled(): void;
  dispose(): Promise<void>;
  readonly phase: PluginUiHostPhase;
}
