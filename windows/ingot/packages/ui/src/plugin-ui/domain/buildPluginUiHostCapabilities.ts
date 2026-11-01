import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  MCP_APPS_RESOURCE_SUBSCRIBE_EXPERIMENTAL_KEY,
  MCP_APPS_SURFACE_EXPERIMENTAL_KEY,
  MCP_APPS_WIDGET_STATE_EXPERIMENTAL_KEY,
  buildMcpAppsCspExperimentalCapability,
} from "@origin-ai/cf-shared/mcp-apps";

export interface PluginUiHostCapabilityInput {
  canSample?: boolean;
  canSendFollowUpMessage: boolean;
  canUpdateModelContext: boolean;
  canSetWidgetState: boolean;
  
  canSubscribeResources: boolean;
  
  canDownloadFile: boolean;
  
  surfaceId?: string;
  
  surfaceStateKey?: string;
}

export function buildPluginUiHostCapabilities(
  input: PluginUiHostCapabilityInput,
): McpUiHostCapabilities {
  return {
    openLinks: {},
    serverTools: {},
    serverResources: input.canSubscribeResources ? { listChanged: true } : {},
    logging: {},
    ...(input.canSample ? { sampling: {} } : {}),
    ...(input.canDownloadFile ? { downloadFile: {} } : {}),
    ...(input.canSendFollowUpMessage ? { message: { text: {}, image: {} } } : {}),
    ...(input.canUpdateModelContext
      ? { updateModelContext: { text: {}, structuredContent: {}, image: {} } }
      : {}),
    experimental: {
      ...buildMcpAppsCspExperimentalCapability(),
      ...(input.canSetWidgetState ? { [MCP_APPS_WIDGET_STATE_EXPERIMENTAL_KEY]: {} } : {}),
      ...(input.canSubscribeResources
        ? { [MCP_APPS_RESOURCE_SUBSCRIBE_EXPERIMENTAL_KEY]: {} }
        : {}),
      ...(input.surfaceId
        ? {
            [MCP_APPS_SURFACE_EXPERIMENTAL_KEY]: {
              id: input.surfaceId,
              stateKey: input.surfaceStateKey,
            },
          }
        : {}),
    },
  };
}
