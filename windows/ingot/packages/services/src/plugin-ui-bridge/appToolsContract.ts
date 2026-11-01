import { ServiceChannels } from "@origin-ai/cf-shared";
import type { McpAppsAppToolCallResult, McpAppsAppToolDescriptor } from "@origin-ai/cf-shared/mcp-apps";
import { createServiceDescriptor } from "../descriptors.js";
import type { PluginUiPluginScope } from "./contract.js";

export interface PluginUiAppToolInstanceParams extends PluginUiPluginScope {
  scopeId: string;
  generation: number;
}
export interface PluginUiRegisterAppToolsParams extends PluginUiAppToolInstanceParams {
  tools: McpAppsAppToolDescriptor[];
}
export interface PluginUiRegisterAppToolsResult {
  tools: Array<{ name: string; modelName: string }>;
}
export interface PluginUiAppToolCallParams extends PluginUiAppToolInstanceParams {
  callId: string;
}
export interface PluginUiResolveAppToolCallParams extends PluginUiAppToolCallParams {
  result?: McpAppsAppToolCallResult;
  error?: { message: string };
}
export interface PluginUiAppToolAcceptedResult {
  accepted: boolean;
}

export interface IPluginUiAppToolsService {
  
  registerAppTools(params: PluginUiRegisterAppToolsParams): Promise<PluginUiRegisterAppToolsResult>;
  
  unregisterAppTools(params: PluginUiAppToolInstanceParams): Promise<{ removed: number }>;
  
  claimAppToolCall(params: PluginUiAppToolCallParams): Promise<PluginUiAppToolAcceptedResult>;
  
  resolveAppToolCall(
    params: PluginUiResolveAppToolCallParams,
  ): Promise<PluginUiAppToolAcceptedResult>;
}

export const IPluginUiAppToolsService = createServiceDescriptor<IPluginUiAppToolsService>(
  ServiceChannels.PluginUiAppTools,
);
