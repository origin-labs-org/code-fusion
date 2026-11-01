import type {
  McpAppCspRelaxations,
  McpAppsResourcePermission,
  PluginSandboxHandle,
  PluginSandboxPlatformPort,
  PluginSandboxRegisterInput,
} from "@origin-ai/cf-shared/mcp-apps";
import { createHash } from "node:crypto";

export const PLUGIN_SANDBOX_SCHEME = "cf-sandbox";
export const PLUGIN_SANDBOX_SHELL_HOST_PREFIX = "shell-";
export const PLUGIN_SANDBOX_PLUGIN_HOST_PREFIX = "plugin-";

export const PLUGIN_SANDBOX_PARTITION_PREFIX = "persist:plugin-sandbox-v2-";

export function buildPluginSandboxShellUrl(sandboxId: string, appIdentity: string): string {
  return `${PLUGIN_SANDBOX_SCHEME}://${PLUGIN_SANDBOX_SHELL_HOST_PREFIX}${appIdentity}/instance/${sandboxId}/`;
}
export function buildPluginSandboxPluginOrigin(sandboxId: string): string {
  return `${PLUGIN_SANDBOX_SCHEME}://${PLUGIN_SANDBOX_PLUGIN_HOST_PREFIX}${sandboxId}`;
}

export function buildPluginSandboxPartition(input: { appIdentity: string }): string {
  const hash = createHash("sha256").update(input.appIdentity).digest("hex");
  return `${PLUGIN_SANDBOX_PARTITION_PREFIX}${hash}`;
}

export type { PluginSandboxRegisterInput } from "@origin-ai/cf-shared/mcp-apps";

export interface PluginSandboxRecord extends PluginSandboxHandle {
  workspacePath?: string;
  workspaceIdentity?: string;
  ownerWebContentsId: number;
  sessionId: string;
  contentKind?: "gen-ui";
  pluginId?: string;
  serverName?: string;
  scopeId: string;
  html: string;
  
  cspHeader: string;
  cspRelaxations?: McpAppCspRelaxations;
  
  permissions?: McpAppsResourcePermission[];
  prefersBorder: boolean;
}

export interface PluginSandboxRegistryPort {
  
  register(input: PluginSandboxRegisterInput): PluginSandboxHandle;
  get(sandboxId: string): PluginSandboxRecord | null;
  
  dispose(sandboxId: string, initId?: number): void;
  
  disposeOwner(ownerWebContentsId: number): void;
  
  pin(sandboxId: string): void;
  unpin(sandboxId: string): void;
  
  markUserGesture(sandboxId: string): void;
  consumeUserGesture(sandboxId: string): boolean;
}

export type IPluginSandboxPlatform = PluginSandboxPlatformPort;

export class PluginSandboxQuotaError extends Error {
  readonly code = "sandbox_quota" as const;
  constructor(maxEntries: number) {
    super(`PluginsBoundary面Quantity已达上限（${maxEntries}），请先CloseOtherPlugins卡片or面板。`);
    this.name = "PluginSandboxQuotaError";
  }
}
