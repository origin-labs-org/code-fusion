import type { CfPluginUiSurface } from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import type { McpToolUiCsp, PluginSandboxHandle } from "@origin-ai/cf-shared/mcp-apps";
import { createServiceDescriptor } from "../descriptors.js";

export interface PluginUiWorkspaceTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface PluginUiPluginScope extends PluginUiWorkspaceTarget {
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  
  serverName: string;
}

export interface PluginUiPrepareSandboxParams extends Omit<PluginUiPluginScope, "instance"> {
  
  scopeId: string;
  resourceUri: string;
  
  ownerWebContentsId: number;
  
  csp?: McpToolUiCsp;
  prefersBorder?: boolean;
}

export interface PluginUiCallToolParams extends PluginUiPluginScope {
  toolName: string;
  arguments?: Record<string, unknown>;
  
  callId: string;
}
export interface PluginUiCancelToolCallParams extends PluginUiPluginScope {
  callId: string;
}

export interface PluginUiCallToolResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface PluginUiReadResourceParams extends PluginUiPluginScope {
  uri: string;
}
export interface PluginUiResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  /** base64。 */
  blob?: string;
}
export interface PluginUiReadResourceResult {
  contents: PluginUiResourceContent[];
}

export interface PluginUiListResourcesParams extends PluginUiPluginScope {
  cursor?: string;
}
export interface PluginUiResourceDescriptor {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}
export interface PluginUiListResourcesResult {
  resources: PluginUiResourceDescriptor[];
  nextCursor?: string;
}
export interface PluginUiListResourceTemplatesResult {
  resourceTemplates: Array<Omit<PluginUiResourceDescriptor, "uri"> & { uriTemplate: string }>;
  nextCursor?: string;
}

export interface PluginUiResourceSubscriptionParams extends PluginUiPluginScope {
  scopeId: string;
  generation: number;
  uri: string;
}

export type PluginUiSurfaceEntry = CfPluginUiSurface;

export interface IPluginUiBridgeService {
  validateInstance(params: PluginUiPluginScope): Promise<void>;
  recycleInstance(params: PluginUiPluginScope): Promise<boolean>;
  closeInstance(params: PluginUiPluginScope): Promise<void>;
  prepareSandbox(params: PluginUiPrepareSandboxParams): Promise<PluginSandboxHandle>;
  callTool(
    params: PluginUiCallToolParams,
    options?: { signal?: AbortSignal },
  ): Promise<PluginUiCallToolResult>;
  
  cancelToolCall(params: PluginUiCancelToolCallParams): Promise<{ cancelled: boolean }>;
  readResource(params: PluginUiReadResourceParams): Promise<PluginUiReadResourceResult>;
  
  listResources(params: PluginUiListResourcesParams): Promise<PluginUiListResourcesResult>;
  listResourceTemplates(
    params: PluginUiListResourcesParams,
  ): Promise<PluginUiListResourceTemplatesResult>;
  subscribeResource(params: PluginUiResourceSubscriptionParams): Promise<void>;
  unsubscribeResource(params: PluginUiResourceSubscriptionParams): Promise<void>;
  
  listSurfaces(params: PluginUiWorkspaceTarget): Promise<PluginUiSurfaceEntry[]>;
}

export const IPluginUiBridgeService = createServiceDescriptor<IPluginUiBridgeService>(
  ServiceChannels.PluginUiBridge,
);
