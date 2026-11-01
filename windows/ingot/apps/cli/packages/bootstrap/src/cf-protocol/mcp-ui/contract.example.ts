import type {
  McpUiCallToolResult,
  McpUiReadResourceResult,
  McpUiSessionAccess,
} from "./contract.js";
import { McpUiNotSupportedError } from "./resourceContract.js";

export function createExampleSessionAccess(): McpUiSessionAccess {
  const html: McpUiReadResourceResult = {
    contents: [
      {
        uri: "ui://example-plugin/widget.html",
        mimeType: "text/html;profile=mcp-app",
        text: "<!doctype html><p>widget</p>",
      },
    ],
  };
  const echo: McpUiCallToolResult = { content: [{ type: "text", text: "pong" }] };
  return {
    hasMcpServer: async (serverName) => serverName === "plugin:example-plugin:widget",
    getToolVisibility: async (_serverName, toolName) =>
      toolName === "echo_app_only" ? ["app"] : toolName === "ping" ? ["model", "app"] : null,
    readResource: async () => html,
    callTool: async () => echo,
    readResourceForUi: async () => html,
    listResourcesForUi: async () => ({
      resources: [
        {
          uri: "ui://example-plugin/widget.html",
          name: "widget",
          mimeType: "text/html;profile=mcp-app",
        },
      ],
    }),
    listResourceTemplatesForUi: async () => ({ resourceTemplates: [] }),
    subscribeResourceForUi: async () => {
      throw new McpUiNotSupportedError("plugin:example-plugin:widget", "resources/subscribe");
    },
    unsubscribeResourceForUi: async () => {},
  };
}
