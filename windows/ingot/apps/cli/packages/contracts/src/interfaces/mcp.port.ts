// MCP Port - Model Context Protocol adapter boundary

import type { McpServerFailureKind, OfficialMcpAuthPortFailureReason } from "@origin-ai/cf-shared";
import type { McpAppsToolVisibility, McpToolUiDescriptor } from "@origin-ai/cf-shared/mcp-apps";
import type { JsonSchema } from "../model/index.js";
import type { TraceContext } from "../tracing/tracer.js";

export type McpServerTransportType = "stdio" | "http" | "sse";
export type McpProtocolVersion = "legacy" | "auto" | "2026-07-28";
export type McpServerIsolation = "session" | "workspace";

export interface McpServerRuntimeSource {
  kind: "builtin" | "plugin";
}

export interface McpServerConfigBase {
  alwaysLoad?: boolean;
  enabled?: boolean;
  isolation?: McpServerIsolation;
  protocolVersion?: McpProtocolVersion;
  
  source?: McpServerRuntimeSource;
  timeoutMs?: number;
}

export interface McpClientCredentialsOAuthConfig {
  type: "client_credentials";
  clientId: string;
  clientSecret: string;
  clientName?: string;
  scope?: string;
}

export interface McpAuthorizationCodeOAuthConfig {
  type: "authorization_code";
  clientId?: string;
  clientSecret?: string;
  clientName?: string;
  redirectPath?: string;
  scope?: string;
}

export type McpOAuthConfig = McpAuthorizationCodeOAuthConfig | McpClientCredentialsOAuthConfig;

export interface CfOfficialMcpAuthConfig {
  type: "cf_official";
  provider: "jwt_token";
}

export interface McpOfficialProvenance {
  pluginId: string;
  
  mcpKey: string;
  source: "plugin";
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  type: "stdio";
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  auth?: CfOfficialMcpAuthConfig;
  
  official?: McpOfficialProvenance;
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
  auth?: CfOfficialMcpAuthConfig;
  
  official?: McpOfficialProvenance;
}

export interface McpSseServerConfig extends McpServerConfigBase {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig | McpSseServerConfig;

export type McpServerStatusKind =
  | "connecting"
  | "connected"
  | "disabled"
  | "disconnected"
  | "failed"
  | "untrusted";

export interface McpServerStatus {
  status: McpServerStatusKind;
  transport: McpServerTransportType;
  toolCount: number;
  updatedAt: string;
  error?: string;
  failureKind?: McpServerFailureKind;
  serverRequestId?: string;
  protocolEra?: "legacy" | "modern";
  authorization?: {
    type: "oauth_authorization_code";
    authorizationUrl: string;
    startedAt: string;
  };
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export const CF_MCP_ERROR_PRESENTATION_META_KEY = "cf/errorPresentation";
export const CF_MCP_ERROR_PRESENTATION_MESSAGE_ONLY = "message-only";

export const CF_MCP_BROWSER_SCREENSHOT_CONTENT_INDICES_META_KEY =
  "cf/browserScreenshotContentIndices";

export const CF_MCP_NODE_REPL_CUA_APP_META_KEY = "cf/nodeReplCuaApp";

export const CF_MCP_SERVER_REQUEST_ID_META_KEY = "cf/officialMcpServerRequestId";

export interface McpToolDescriptor {
  alwaysLoad?: boolean;
  searchHint?: string;
  serverName: string;
  toolName: string;
  name?: string;
  description?: string;
  timeoutMs?: number;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations?: McpToolAnnotations;
  
  official?: boolean;
  
  visibility?: McpAppsToolVisibility[];
  
  ui?: McpToolUiDescriptor;
}

export function resolveMcpToolVisibility(
  descriptor: Pick<McpToolDescriptor, "visibility" | "ui">,
): McpAppsToolVisibility[] {
  return descriptor.visibility ?? descriptor.ui?.visibility ?? ["model", "app"];
}

export type McpContentBlock = Record<string, unknown>;

export interface McpToolCallResult {
  content: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface McpReadResourceRequest {
  serverName: string;
  uri: string;
  trace?: TraceContext;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  _meta?: Record<string, unknown>;
}

export interface McpReadResourceResult {
  contents: McpResourceContent[];
}

export interface McpListResourcesRequest {
  serverName: string;
  cursor?: string;
  trace?: TraceContext;
}
export interface McpResourceDescriptor {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}
export interface McpListResourcesResult {
  resources: McpResourceDescriptor[];
  nextCursor?: string;
}
export interface McpResourceTemplateDescriptor {
  uriTemplate: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, unknown>;
}
export interface McpListResourceTemplatesResult {
  resourceTemplates: McpResourceTemplateDescriptor[];
  nextCursor?: string;
}

export interface McpResourceSubscriptionRequest {
  serverName: string;
  uri: string;
  subscriberKey: string;
  trace?: TraceContext;
}

export class McpResourceSubscribeUnsupportedError extends Error {
  readonly code = "not_supported" as const;
  constructor(readonly serverName: string) {
    super(`MCP server ${serverName} does not support resource subscriptions`);
    this.name = "McpResourceSubscribeUnsupportedError";
  }
}

export type McpServerNotification =
  | { kind: "resourceUpdated"; serverName: string; uri: string; subscribers: string[] }
  | { kind: "resourceListChanged"; serverName: string; subscribers: string[] }
  | { kind: "toolListChanged"; serverName: string }
  | { kind: "loggingMessage"; serverName: string; level: string; logger?: string; data: unknown };
export interface McpNotificationPort {
  onNotification(notification: McpServerNotification): void;
}

export interface McpConnectionSnapshot {
  statuses: Record<string, McpServerStatus>;
  tools: McpToolDescriptor[];
}

export interface McpConnectOptions {
  
  oauthAuthorizationTimeoutMs?: number;
  
  revalidate?: boolean;
  signal?: AbortSignal;
  trace?: TraceContext;
  workingDirectory?: string;
  
  workspaceIdentity?: string;
}

export interface McpCallToolRequest {
  serverName: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  trace?: TraceContext;
  
  runtimeScope?: "main" | "subagent";
  
  workspacePath?: string;
  workspaceIdentity?: string;
  workspaceKey?: string;
  remoteSessionId?: string;
  clientMode?: string;
  deliveryKind?: string;
  turnId?: string;
}

export interface McpToolCallProgress {
  progress: number;
  total?: number;
  message?: string;
}

export interface McpCallToolOptions {
  
  appConnection?: { identity: string; generation: number };
  signal?: AbortSignal;
  timeoutMs?: number;
  
  onProgress?: (progress: McpToolCallProgress) => void;
}

export const MCP_TOOL_META_TIMEOUT_MIN_MS = 1_000;
export const MCP_TOOL_META_TIMEOUT_MAX_MS = 30 * 60 * 1_000;

export type OfficialMcpAuthFailureReason = OfficialMcpAuthPortFailureReason;

export type OfficialMcpAuthHeadersResult =
  | { ok: true; headers: Record<string, string> }
  | { ok: false; reason: OfficialMcpAuthFailureReason };

export interface OfficialMcpAuthHeadersPort {
  resolveHeaders(input: {
    pluginId: string;
    mcpKey: string;
    targetOrigin: string;
    workspaceIdentity?: string;
    workspacePath?: string;
    signal?: AbortSignal;
  }): Promise<OfficialMcpAuthHeadersResult>;
}

export interface OfficialMcpTrustedOriginRegistry {
  isTrusted(input: { pluginId: string; mcpKey: string; origin: string }): Promise<{
    detail?: string;
    trusted: boolean;
  }>;
}

export interface McpElicitationTrace {
  sessionId?: string;
  turnId?: string;
  toolCallId?: string;
  traceId?: string;
}
export interface McpElicitationRequest {
  serverName: string;
  message: string;
  requestedSchema: unknown;
  
  trace?: McpElicitationTrace;
}
export interface McpElicitationResult {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
}
export interface McpElicitationPort {
  requestElicitation(
    request: McpElicitationRequest,
    options?: { signal?: AbortSignal },
  ): Promise<McpElicitationResult>;
}

export interface McpPort {
  
  onAppConnectionInvalidated?(serverName: string, listener: () => void): () => void;
  appConnectionSnapshot?(serverName: string): { identity: string; generation: number } | null;
  
  waitForAppConnection?(
    serverName: string,
  ): Promise<{ identity: string; generation: number } | null>;

  connectConfiguredServers(
    servers: Record<string, McpServerConfig>,
    options?: McpConnectOptions,
  ): Promise<McpConnectionSnapshot>;
  connectServer(
    name: string,
    config: McpServerConfig,
    options?: McpConnectOptions,
  ): Promise<McpServerStatus>;
  disconnectServer(name: string): Promise<McpServerStatus | undefined>;
  
  pingServer?(name: string, options?: { timeoutMs?: number }): Promise<boolean>;
  status(): Promise<Record<string, McpServerStatus>>;
  listTools(): Promise<McpToolDescriptor[]>;
  
  toolListRevision?(): number;
  callTool(request: McpCallToolRequest, options?: McpCallToolOptions): Promise<McpToolCallResult>;
  
  readResource?(
    request: McpReadResourceRequest,
    options?: McpCallToolOptions,
  ): Promise<McpReadResourceResult>;
  
  listResources?(
    request: McpListResourcesRequest,
    options?: McpCallToolOptions,
  ): Promise<McpListResourcesResult>;
  listResourceTemplates?(
    request: McpListResourcesRequest,
    options?: McpCallToolOptions,
  ): Promise<McpListResourceTemplatesResult>;
  subscribeResource?(
    request: McpResourceSubscriptionRequest,
    options?: McpCallToolOptions,
  ): Promise<void>;
  unsubscribeResource?(
    request: McpResourceSubscriptionRequest,
    options?: McpCallToolOptions,
  ): Promise<void>;
  
  unsubscribeResourcesBySubscriber?(subscriberKeyPrefix: string): Promise<number>;
  close(): Promise<void>;
}
