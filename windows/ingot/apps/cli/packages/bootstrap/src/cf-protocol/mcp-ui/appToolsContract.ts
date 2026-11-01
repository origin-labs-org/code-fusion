import type { McpAppsAppToolCallResult, McpAppsAppToolDescriptor } from "@origin-ai/cf-shared/mcp-apps";
import type { McpUiPluginScope } from "./resourceContract.js";

export interface McpUiAppToolInstance {
  scopeId: string;
  generation: number;
}
export interface McpUiRegisterAppToolsParams extends McpUiPluginScope, McpUiAppToolInstance {
  tools: McpAppsAppToolDescriptor[];
}
export interface McpUiRegisterAppToolsResult {
  tools: Array<{ name: string; modelName: string }>;
}
export interface McpUiUnregisterAppToolsParams extends McpUiPluginScope, McpUiAppToolInstance {}
export interface McpUiUnregisterAppToolsResult {
  removed: number;
}
export interface McpUiAppToolCallParams extends McpUiPluginScope, McpUiAppToolInstance {
  callId: string;
}
export interface McpUiResolveAppToolCallParams extends McpUiAppToolCallParams {
  result?: McpAppsAppToolCallResult;
  error?: { message: string };
}
export interface McpUiAppToolAcceptedResult {
  accepted: boolean;
}
