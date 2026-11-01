

export interface McpUiPluginScope {
  workspace?: { workspacePath: string; workspaceIdentity?: string };
  instance: import("@origin-ai/cf-shared/mcp-apps").McpAppInstance;
  sessionId: string;
  pluginId: string;
  serverName: string;
}

export interface McpUiListResourcesParams extends McpUiPluginScope {
  cursor?: string;
}
export interface McpUiResourceDescriptor {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  
  _meta?: Record<string, unknown>;
}
export interface McpUiListResourcesResult {
  resources: McpUiResourceDescriptor[];
  nextCursor?: string;
}
export interface McpUiListResourceTemplatesResult {
  resourceTemplates: Array<Omit<McpUiResourceDescriptor, "uri"> & { uriTemplate: string }>;
  nextCursor?: string;
}
export interface McpUiResourceSubscriptionParams extends McpUiPluginScope {
  scopeId: string;
  generation: number;
  uri: string;
}

export function buildMcpUiSubscriberKey(
  sessionId: string,
  scopeId: string,
  generation: number,
): string {
  return `${sessionId}|${scopeId}|${generation}`;
}
export function parseMcpUiSubscriberKey(
  key: string,
): { sessionId: string; scopeId: string; generation: number } | null {
  const first = key.indexOf("|");
  const last = key.lastIndexOf("|");
  if (first <= 0 || last <= first) return null;
  const generation = Number(key.slice(last + 1));
  if (!Number.isInteger(generation) || generation < 0) return null;
  return { sessionId: key.slice(0, first), scopeId: key.slice(first + 1, last), generation };
}

export class McpUiNotSupportedError extends Error {
  readonly code = -32001;
  readonly reason = "not_supported" as const;
  constructor(
    readonly serverName: string,
    readonly operation: string,
  ) {
    super(`MCP server "${serverName}" does not support ${operation}`);
    this.name = "McpUiNotSupportedError";
  }
}

export interface McpUiResourceSessionAccess {
  listResourcesForUi(
    serverName: string,
    cursor?: string,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiListResourcesResult>;
  listResourceTemplatesForUi(
    serverName: string,
    cursor?: string,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiListResourceTemplatesResult>;
  subscribeResourceForUi(
    serverName: string,
    uri: string,
    subscriberKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  unsubscribeResourceForUi(
    serverName: string,
    uri: string,
    subscriberKey: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface McpUiResourceHandlers<Access extends McpUiResourceSessionAccess> {
  listResources(
    access: Access,
    params: McpUiListResourcesParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiListResourcesResult>;
  listResourceTemplates(
    access: Access,
    params: McpUiListResourcesParams,
    options?: { signal?: AbortSignal },
  ): Promise<McpUiListResourceTemplatesResult>;
  subscribeResource(
    access: Access,
    params: McpUiResourceSubscriptionParams,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  unsubscribeResource(
    access: Access,
    params: McpUiResourceSubscriptionParams,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}
