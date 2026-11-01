import type {
  McpAppsAppToolCallRequest,
  McpAppsDisplayMode,
  McpToolUiCsp,
  PluginSandboxHandle,
  PluginUiScopeRef,
} from "@origin-ai/cf-shared/mcp-apps";
import { buildPluginSandboxScopeId } from "@origin-ai/cf-shared/mcp-apps";
import type { AttachmentRef, ConversationInputSource } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { ReactNode } from "react";
import type { PluginUiImageBlock } from "./domain/pluginUiImageBlocks.js";

export interface PluginUiPresentation {
  
  serverName: string;
  pluginId: string;
  resourceUri: string;
  preferredDisplayMode?: McpAppsDisplayMode;
  prefersBorder?: boolean;
  csp?: McpToolUiCsp;
  structuredContent?: string;
  widgetMeta?: string;
  
  content?: string;
  truncated?: boolean;
  truncatedBytes?: number;
  
  isError?: true;
  
  showInline?: true;
  
  surface?: string;
}

export type PluginUiOpenTarget =
  | { toolCallId: string; surfaceId?: never; serverName?: string }
  | { surfaceId: string; serverName: string; toolCallId?: never };

export type OpenPluginUiSideTabRequest = PluginUiOpenTarget & {
  
  instanceId?: string;
  parentSessionId: string;
  pluginId: string;
  resourceUri: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
};

export interface PluginUiSidePaneTab {
  instanceId?: string;
  id: string;
  type: "plugin-ui";
  ownerTaskId?: string | null;
  workspaceKey?: string | null;
  openedAt?: number;
  parentSessionId: string;
  toolCallId?: string;
  surfaceId?: string;
  serverName?: string;
  pluginId: string;
  resourceUri: string;
  title: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
}

export const PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX = 240;

export interface SandboxPagePlacement {
  node: HTMLElement;
  kind: "flow" | "inline" | "sidebar";
  container?: HTMLElement;
  layer?: number;
}
export const PLUGIN_UI_CARD_MIN_HEIGHT_PX = 80;
export const PLUGIN_UI_CARD_MAX_HEIGHT_PX = 1200;

export const PLUGIN_UI_SIDE_PANE_TITLE_BAR = {
  height: 48,
  leftInset: 0,
  viewportLeftInset: 0,
} as const;

export function readPluginUiScopeRef(
  input: Pick<OpenPluginUiSideTabRequest, "toolCallId" | "surfaceId" | "instanceId">,
): PluginUiScopeRef | null {
  if (input.surfaceId)
    return {
      kind: "surface",
      surfaceId: input.instanceId
        ? `${input.surfaceId}:instance:${input.instanceId}`
        : input.surfaceId,
    };
  if (input.toolCallId) return { kind: "toolCall", toolCallId: input.toolCallId };
  return null;
}

export interface PluginUiSessionScope {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  sessionId: string;
}

export interface PluginUiSessionActions {
  
  sendFollowUp(input: {
    prompt: string;
    source: ConversationInputSource;
    images?: readonly PluginUiImageBlock[];
  }): Promise<void>;
}

export interface PluginUiSessionCommandPort {
  sendText(
    prompt: string,
    options: { source: ConversationInputSource; attachments?: AttachmentRef[] },
  ): Promise<"sent" | "blocked" | "confirmationRequired" | undefined>;
  
  uploadAttachment(input: {
    fileName: string;
    mime: string;
    dataBase64: string;
  }): Promise<AttachmentRef>;
}

export type PluginUiOpenSurfaceRequest = PluginUiOpenTarget & {
  pluginId: string;
  resourceUri: string;
  title: string;
};

export interface PluginUiToolBinding {
  scope: PluginUiSessionScope & { toolCallId: string };
  onOpenSidePane?: (request: PluginUiOpenSurfaceRequest) => void;
}

export function buildPluginUiSessionKey(target: PluginUiSessionScope): string {
  return JSON.stringify([
    target.workspaceIdentity?.trim() || target.workspacePath,
    target.sessionId,
  ]);
}

export function buildPluginUiSurfaceKey(
  target: PluginUiSessionScope & { pluginId: string; serverName?: string; resourceUri?: string },
  scope: PluginUiScopeRef,
): string {
  return JSON.stringify([
    buildPluginUiSessionKey(target),
    target.pluginId,
    target.serverName ?? "",
    target.resourceUri ?? "",
    buildPluginSandboxScopeId(scope),
  ]);
}

export function buildPluginUiSidePaneTabId(request: OpenPluginUiSideTabRequest): string {
  const scope = readPluginUiScopeRef(request);
  if (!scope) throw new Error("plugin-ui side tab needs toolCallId or surfaceId");
  return [
    "plugin-ui",
    request.workspaceIdentity?.trim() || request.workspacePath,
    request.parentSessionId,
    request.pluginId,
    request.serverName ?? "",
    request.resourceUri,
    ...(scope.kind === "toolCall" ? [scope.toolCallId] : ["surface", scope.surfaceId]),
  ]
    .map(encodeURIComponent)
    .join(":");
}

export interface PluginUiSidePaneViewProps {
  
  visible: boolean;
  scopeRef: PluginUiScopeRef;
  host: {
    pageKey: string;
    handle: PluginSandboxHandle | null;
    phase: "idle" | "preparing" | "mounted" | "running" | "error" | "disposed";
    height: number;
    error: string | null;
    
    reload(): void;
  };
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  onWidthChange(width: number): void;
}

export interface PluginUiToolCallViewProps {
  supported: boolean;
  fallback: ReactNode;
  surface?: string;
  preferredDisplayMode: McpAppsDisplayMode;
  sidePaneActive: boolean;
  host: PluginUiSidePaneViewProps["host"];
  prefersBorder: boolean;
  
  superseded: boolean;
  
  pinned?: boolean;
  pinLabel: string;
  unpinLabel: string;
  onTogglePin?: () => void;
  loadingLabel: string;
  errorLabel: string;
  retryLabel: string;
  openedLabel: string;
  openLabel: string;
  onWidthChange(width: number): void;
  onOpenSidePane?: () => void;
}

export interface PluginUiResourceNotificationTarget {
  notifyInstanceClosed?(): void;
  notifyResourceUpdated(uri: string): void;
  notifyResourceListChanged(): void;
  
  notifyAppToolCall(call: McpAppsAppToolCallRequest): void;
}

export function documentViewerInstance(resourceUri: string): { instanceId?: string } {
  return /^ui:\/\/(documents|pdf|presentations|spreadsheets)\/panel\.html$/.test(resourceUri)
    ? { instanceId: crypto.randomUUID() }
    : {};
}
