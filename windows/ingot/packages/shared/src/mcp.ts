/**
 * MCP (Model Context Protocol) types for CodeFusion
 * Based on the original Tauri implementation
 */

import type { SettingsDirectoryLocation } from "./settings-source.js";
import type { McpServerFailureKind } from "./cf-protocol/index.js";

export const CF_CUA_OFFICIAL_PLUGIN_ID = "computer-use@cf-plugins-official";
export const CF_CUA_OFFICIAL_MCP_NAMESPACE_NAME = "plugin:computer-use:computer-use";
export const CF_PLUGIN_ID_ENV_KEY = "CF_PLUGIN_ID";

export type McpSource =
  | "mcp"
  | "cfagentmcp"
  | "claudeclimcp"
  | "geminiclimcp"
  | "codexclimcp"
  | "opencodemcp";
export type CliMcpSource = Exclude<McpSource, "mcp">;
export type McpScope = "common" | "user" | "workspace";
export type McpFileFormat = "json" | "toml";

// Single MCP server configuration
export interface McpServerConfig {
  type?: string; // Supports stdio, http, sse, streamableHttp, etc.
  url?: string; // HTTP/SSE server URL
  command?: string; // stdio server command
  args?: string[]; // stdio server arguments
  env?: Record<string, string>; // stdio server environment variables
  headers?: Record<string, string>; // HTTP/SSE server request headers
  http_headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
  // Linear specific fields
  apiKey?: string;
  projectId?: string;
  issueType?: string;
  // Figma specific fields
  personalAccessToken?: string;
  fileId?: string;
  nodeId?: string;
  // Sentry specific fields
  organizationName?: string;
  projectName?: string;
  dsn?: string;
  // Context7 specific fields
  apiEndpoint?: string;
  [key: string]: any;
}

export type McpServerStatus = "connected" | "disconnected" | "error" | "connecting" | "unknown";

export interface CliMcpConfig {
  mcpServers: Record<string, McpServerConfig>;
  projects: Record<string, Record<string, McpServerConfig>>;
}

export interface SaveCliMcpToUserDirectoryRequest {
  action: "upsert" | "delete" | "set-enabled";
  source: CliMcpSource;
  name: string;
  config?: McpServerConfig;
  enabled?: boolean;
  projectPath?: string;
  location?: SettingsDirectoryLocation;
}

export interface NativeMcpFileReference {
  format: McpFileFormat;
  filePath: string;
}

export interface NativeMcpServerRecord {
  source: McpSource;
  scope: McpScope;
  name: string;
  config: McpServerConfig;
  enabled?: boolean;
  projectPath?: string;
  location?: SettingsDirectoryLocation;
  file?: NativeMcpFileReference;
}

export interface LoadCliMcpFromUserDirectoryRequest {
  workspacePath?: string;
}

export interface LoadCliMcpFromUserDirectoryResult {
  servers: NativeMcpServerRecord[];
}

export interface MigrateLegacyCommonMcpRequest {
  legacyStorageDir?: string;
}

export interface MigrateLegacyCommonMcpResult {
  servers: Record<string, McpServerConfig>;
  sourcePath?: string;
  
  totalCount: number;
  
  importedCount: number;
  
  skippedCount: number;
}

export interface McpConfig {
  mcp: {
    mcpServers: Record<string, McpServerConfig>;
  };
  cfagentmcp: CliMcpConfig;
  claudeclimcp: CliMcpConfig;
  geminiclimcp: CliMcpConfig;
  codexclimcp: CliMcpConfig;
  opencodemcp: CliMcpConfig;
}

export interface CfMcpServer {
  id: string;
  name: string;
  config: McpServerConfig;
  enabled: boolean;
  changed?: boolean;
  status?: McpServerStatus;
  lastConnected?: Date;
  error?: string;
  failureKind?: McpServerFailureKind;
  serverRequestId?: string;
  toolCount?: number;
  authorization?: {
    type: "oauth_authorization_code";
    authorizationUrl: string;
    startedAt: string;
  };
  source: McpSource;
  projectPath?: string;
  scope: McpScope;
  location?: SettingsDirectoryLocation;
  file?: NativeMcpFileReference;
}

export interface McpServerListItem {
  id: string;
  name: string;
  enabled: boolean;
  status: McpServerStatus;
  hasConfig: boolean;
  error?: string;
  toolCount?: number;
  source: McpSource;
  projectPath?: string;
  scope: McpScope;
  file?: NativeMcpFileReference;
}

export interface McpTestResult {
  success: boolean;
  error?: string;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema?: any;
  }>;
  serverInfo?: {
    name: string;
    version: string;
  };
  response_time?: number;
}

export type CfAgentMcpServer =
  | {
      name: string;
      command: string;
      args: string[];
      env: Array<{ name: string; value: string }>;
      alwaysLoad?: boolean;
      isolation?: "session" | "workspace";
      protocolVersion?: "legacy" | "auto" | "2026-07-28";
      timeoutMs?: number;
    }
  | {
      name: string;
      type: "http" | "sse";
      url: string;
      alwaysLoad?: boolean;
      isolation?: "session" | "workspace";
      protocolVersion?: "legacy" | "auto" | "2026-07-28";
      headers: Array<{ name: string; value: string }>;
      oauth?: McpOAuthConfig;
      timeoutMs?: number;
    };

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

export function getMcpServerRequestHeaders(
  config: McpServerConfig,
): Record<string, string> | undefined {
  return config.headers ?? config.http_headers;
}

function cfCuaArgLeaf(value: string): string {
  return (
    value
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? value
  );
}

function matchesCfCuaSpec(candidate: string): boolean {
  const c = candidate.replace(/_/g, "-");
  return (
    c === "cf-cua" ||
    c.startsWith("cf-cua[") ||
    c.startsWith("cf-cua@") ||
    c.startsWith("cf-cua==") ||
    c.startsWith("cf-cua.")
  );
}

export function isCfCuaMcpCommand(command: string): boolean {
  return matchesCfCuaSpec(command) || matchesCfCuaSpec(cfCuaArgLeaf(command));
}

export function isCfCuaMcpPackageArg(value: string): boolean {
  return matchesCfCuaSpec(value) || matchesCfCuaSpec(cfCuaArgLeaf(value));
}

export function convertToCfAgentMcpServer(
  name: string,
  config: McpServerConfig,
): CfAgentMcpServer | null {
  let inferredType = config.type;
  if (!inferredType) {
    if (config.command) inferredType = "stdio";
    else if (config.url) inferredType = "http";
  }

  const isStdio = inferredType === "stdio";
  if (isStdio && config.command) {
    let command = config.command;
    let args = config.args || [];
    const isWin32 =
      (typeof process !== "undefined" && process.platform === "win32") ||
      (typeof navigator !== "undefined" && /win/i.test(navigator.platform));
    if (isWin32) {
      const lowerCmd = command.toLowerCase();
      const unwrappedCommand = args[1];
      if ((lowerCmd === "cmd" || lowerCmd === "cmd.exe") && args[0] === "/c" && unwrappedCommand) {
        command = unwrappedCommand;
        args = args.slice(2);
      }
    }
    return {
      name,
      command,
      args,
      env: config.env
        ? Object.entries(config.env).map(([key, value]) => ({
            name: key,
            value,
          }))
        : [],
      ...(typeof config.alwaysLoad === "boolean" ? { alwaysLoad: config.alwaysLoad } : {}),
      ...(isValidMcpTimeoutMs(config.timeoutMs) ? { timeoutMs: config.timeoutMs } : {}),
      ...(isMcpIsolation(config.isolation) ? { isolation: config.isolation } : {}),
      ...(isMcpProtocolVersion(config.protocolVersion)
        ? { protocolVersion: config.protocolVersion }
        : {}),
    };
  } else if (config.url && inferredType) {
    const normalizedType: "http" | "sse" = inferredType === "sse" ? "sse" : "http";
    const headers = getMcpServerRequestHeaders(config);
    return {
      name,
      type: normalizedType,
      url: config.url,
      headers: headers
        ? Object.entries(headers).map(([key, value]) => ({
            name: key,
            value,
          }))
        : [],
      ...(isValidMcpOAuthConfig(config.oauth) ? { oauth: config.oauth } : {}),
      ...(typeof config.alwaysLoad === "boolean" ? { alwaysLoad: config.alwaysLoad } : {}),
      ...(isValidMcpTimeoutMs(config.timeoutMs) ? { timeoutMs: config.timeoutMs } : {}),
      ...(isMcpIsolation(config.isolation) ? { isolation: config.isolation } : {}),
      ...(isMcpProtocolVersion(config.protocolVersion)
        ? { protocolVersion: config.protocolVersion }
        : {}),
    };
  }
  return null;
}

function isValidMcpTimeoutMs(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isMcpIsolation(value: unknown): value is "session" | "workspace" {
  return value === "session" || value === "workspace";
}

function isMcpProtocolVersion(value: unknown): value is "legacy" | "auto" | "2026-07-28" {
  return value === "legacy" || value === "auto" || value === "2026-07-28";
}

function isValidMcpOAuthConfig(value: unknown): value is McpOAuthConfig {
  if (!isRecord(value)) return false;
  if (
    value.type === "client_credentials" &&
    typeof value.clientId === "string" &&
    value.clientId.trim().length > 0 &&
    typeof value.clientSecret === "string" &&
    value.clientSecret.trim().length > 0
  ) {
    return (
      (value.clientName === undefined || typeof value.clientName === "string") &&
      (value.scope === undefined || typeof value.scope === "string")
    );
  }
  if (value.type === "authorization_code") {
    return (
      (value.clientId === undefined || typeof value.clientId === "string") &&
      (value.clientSecret === undefined || typeof value.clientSecret === "string") &&
      (value.clientName === undefined || typeof value.clientName === "string") &&
      (value.redirectPath === undefined || typeof value.redirectPath === "string") &&
      (value.scope === undefined || typeof value.scope === "string")
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
