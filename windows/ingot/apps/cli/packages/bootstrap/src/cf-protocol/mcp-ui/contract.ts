

import type {
  McpUiPluginScope,
  McpUiResourceHandlers,
  McpUiResourceSessionAccess,
} from "./resourceContract.js";
export * from "./resourceContract.js";

export interface McpUiReadResourceParams extends McpUiPluginScope {
  uri: string;
}

export interface McpUiResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
}

export interface McpUiReadResourceResult {
  contents: McpUiResourceContent[];
}

export interface McpUiReadResourceForUiResult {
  contents: Array<Pick<McpUiResourceContent, "uri" | "mimeType" | "text" | "blob">>;
}

export interface McpUiCallToolParams extends McpUiPluginScope {
  toolName: string;
  arguments?: Record<string, unknown>;
  
  callId: string;
}

export interface McpUiCancelCallParams extends McpUiPluginScope {
  callId: string;
}
export interface McpUiCancelCallResult {
  
  cancelled: boolean;
}

export interface McpUiCallToolResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface McpUiSessionAccess extends McpUiResourceSessionAccess {
  
  hasMcpServer(serverName: string): Promise<boolean>;
  
  getToolVisibility(
    serverName: string,
    toolName: string,
  ): Promise<readonly ("model" | "app")[] | null>;
  readResource(
    serverName: string,
    uri: string,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceResult>;
  callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> | undefined,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiCallToolResult>;
  
  readResourceForUi(
    serverName: string,
    uri: string,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceResult>;
}

export class McpUiServerScopeError extends Error {
  readonly code = -32602;
  constructor(readonly serverName: string) {
    super(`MCP server "${serverName}" is not available in this session`);
    this.name = "McpUiServerScopeError";
  }
}

export class McpUiToolAccessError extends Error {
  readonly code = -32602;
  constructor(
    readonly reason: "tool_not_found" | "tool_not_app_visible",
    readonly serverName: string,
    readonly toolName: string,
  ) {
    super(
      reason === "tool_not_found"
        ? `MCP tool "${toolName}" is not available on server "${serverName}"`
        : `MCP tool "${toolName}" on server "${serverName}" is not visible to plugin UI`,
    );
    this.name = "McpUiToolAccessError";
  }
}

export class McpUiResourceRejectedError extends Error {
  readonly code = -32001;
  constructor(
    readonly reason: "too_large" | "mime_not_allowed",
    readonly uri: string,
    readonly detail: { bytes?: number; maxBytes?: number; mimeType?: string },
  ) {
    super(
      reason === "too_large"
        ? `MCP resource "${uri}" is ${detail.bytes} bytes, exceeding the ${detail.maxBytes} byte limit for plugin UI reads`
        : `MCP resource "${uri}" has mimeType "${detail.mimeType}" which is not allowed for plugin UI reads`,
    );
    this.name = "McpUiResourceRejectedError";
  }
}

export interface McpUiHandlers extends McpUiResourceHandlers<McpUiSessionAccess> {
  readResource(
    access: McpUiSessionAccess,
    params: McpUiReadResourceParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceResult>;
  callTool(
    access: McpUiSessionAccess,
    params: McpUiCallToolParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiCallToolResult>;
  
  cancelToolCall(
    access: McpUiSessionAccess,
    params: McpUiCancelCallParams,
  ): Promise<McpUiCancelCallResult>;
  readResourceForUi(
    access: McpUiSessionAccess,
    params: McpUiReadResourceParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiReadResourceForUiResult>;
}
