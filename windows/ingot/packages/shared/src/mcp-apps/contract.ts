

export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";

export const MCP_APPS_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

export const MCP_APPS_LEGACY_RESOURCE_URI_META_KEY = "ui/resourceUri";

export type McpAppsClientCapability = { mimeTypes: string[] };

export function buildMcpAppsClientCapabilities(): {
  extensions: { [extensionId: string]: McpAppsClientCapability };
} {
  return { extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APPS_RESOURCE_MIME_TYPE] } } };
}

export const MCP_APPS_HOST_NAME = "cf";
export const MCP_APPS_HOST_VERSION = "1";

export const MCP_APPS_HANDSHAKE_TIMEOUT_MS = 15_000;
export const MCP_APPS_TEARDOWN_TIMEOUT_MS = 500;

export type McpAppsDisplayMode = "inline" | "fullscreen" | "pip";
export type McpAppsToolVisibility = "model" | "app";
export const MCP_APPS_DEFAULT_TOOL_VISIBILITY: readonly McpAppsToolVisibility[] = ["model", "app"];

export interface McpToolUiCsp {
  connectDomains?: string[];
  resourceDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

export const MCP_APPS_CSP_RELAXATION_META_KEY = "cf/csp";
export const MCP_APPS_CSP_RELAXATION_FLAGS = ["unsafeEval", "wasmUnsafeEval"] as const;
export type McpAppCspRelaxationFlag = (typeof MCP_APPS_CSP_RELAXATION_FLAGS)[number];
export type McpAppCspRelaxations = Partial<Record<McpAppCspRelaxationFlag, boolean>>;
export function buildMcpAppsCspExperimentalCapability(): {
  [MCP_APPS_CSP_RELAXATION_META_KEY]: { flags: McpAppCspRelaxationFlag[] };
} {
  return { [MCP_APPS_CSP_RELAXATION_META_KEY]: { flags: [...MCP_APPS_CSP_RELAXATION_FLAGS] } };
}

export const MCP_APPS_RESOURCE_PERMISSIONS = [
  "camera",
  "microphone",
  "geolocation",
  "clipboardWrite",
] as const;
export type McpAppsResourcePermission = (typeof MCP_APPS_RESOURCE_PERMISSIONS)[number];

export const MCP_APPS_IFRAME_ALLOW_TOKENS: Record<McpAppsResourcePermission, string> = {
  camera: "camera",
  microphone: "microphone",
  geolocation: "geolocation",
  clipboardWrite: "clipboard-write",
};

export function buildMcpAppsIframeAllow(
  permissions: readonly McpAppsResourcePermission[] | undefined,
): string {
  if (!permissions?.length) return "";
  return MCP_APPS_RESOURCE_PERMISSIONS.filter((key) => permissions.includes(key))
    .map((key) => MCP_APPS_IFRAME_ALLOW_TOKENS[key])
    .join("; ");
}

export interface McpAppResourceMeta {
  csp?: McpToolUiCsp;
  cspRelaxations?: McpAppCspRelaxations;
  
  permissions?: McpAppsResourcePermission[];
  prefersBorder?: boolean;
  heightHint?: number;
  minFrameHeight?: number;
  showInline?: boolean;
}

export type PluginSandboxResourceMeta = Omit<McpAppResourceMeta, "csp" | "cspRelaxations">;

export interface McpToolUiDescriptor {
  resourceUri: string;
  visibility?: McpAppsToolVisibility[];
  preferredDisplayMode?: McpAppsDisplayMode;
  csp?: McpToolUiCsp;
  prefersBorder?: boolean;
  
  surface?: string;
  
  showInline?: boolean;
}

export const MCP_APPS_SURFACE_ID_MAX_CHARS = 128;
export const MCP_APPS_SURFACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export const MCP_APPS_UI_RESOURCE_SCHEME = "ui://";
export const MCP_APPS_RESOURCE_URI_MAX_CHARS = 2048;

export const MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES = 64 * 1024;
export const MCP_APPS_WIDGET_META_MAX_BYTES = 16 * 1024;
export const MCP_APPS_CONTENT_MAX_BYTES = 32 * 1024;
export const MCP_APPS_TRUNCATED_META_KEY = "cf/truncated";

export const MCP_APPS_HTML_MAX_BYTES = 16 * 1024 * 1024;
export const MCP_APPS_HTML_MIME_TYPES = [MCP_APPS_RESOURCE_MIME_TYPE, "text/html"] as const;

export const MCP_APPS_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MCP_APPS_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export {
  MCP_APPS_UI_READ_RESOURCE_MAX_BYTES,
  MCP_APPS_UI_READ_RESOURCE_MIME_ALLOWLIST,
  isMcpAppsUiReadResourceMimeAllowed,
} from "./resourceMime.js";

export const MCP_APPS_WIDGET_STATE_EXPERIMENTAL_KEY = "cf/widgetState";
export const MCP_APPS_RESOURCE_SUBSCRIBE_EXPERIMENTAL_KEY = "cf/resourceSubscribe";
export const MCP_APPS_SURFACE_EXPERIMENTAL_KEY = "cf/surface";

export const MCP_APPS_SET_WIDGET_STATE_METHOD = "ui/set-widget-state";
export const MCP_APPS_WIDGET_STATE_CONTEXT_KEY = "cf/widgetState";

export const PLUGIN_SANDBOX_PORT_NAME = "plugin-sandbox-rpc";

export interface PluginSandboxTransportPort {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  start?(): void;
  close(): void;
}

export interface PluginSandboxPortsEvent {
  sandboxId: string;
  initId: number;
  port: PluginSandboxTransportPort;
}

export interface PluginSandboxPlatformPort {
  
  supportsRetainedMove?: boolean;
  
  copyImage?(input: PluginSandboxCaptureRequest): Promise<void>;
  
  setExecutionActive?(sandboxId: string, initId: number, active: boolean): Promise<void>;
  
  getOwnerWebContentsId(): Promise<number>;
  
  disposeSandbox(sandboxId: string, initId?: number): Promise<void>;
  consumeUserGesture(sandboxId: string): Promise<boolean>;
  onPorts(handler: (event: PluginSandboxPortsEvent) => void): () => void;
}

export interface PluginSandboxCaptureRequest {
  sandboxId: string;
  initId: number;
  captureRect: { x: number; y: number; width: number; height: number };
  viewportSize: { width: number; height: number };
}

export type PluginUiScopeRef =
  | { kind: "toolCall"; toolCallId: string }
  | { kind: "surface"; surfaceId: string };
export function buildPluginSandboxScopeId(scope: PluginUiScopeRef): string {
  return scope.kind === "toolCall" ? `tool:${scope.toolCallId}` : `surface:${scope.surfaceId}`;
}

export interface PluginSandboxRegisterRequestPayload {
  instance: import("./instance.js").McpAppInstance;
  requestId: string;
  
  workspacePath?: string;
  workspaceIdentity?: string;
  ownerWebContentsId: number;
  sessionId: string;
  /** Gen UI has Host provenance and never impersonates an MCP plugin. */
  contentKind?: "gen-ui";
  pluginId?: string;
  
  serverName?: string;
  
  scopeId: string;
  html: string;
  
  csp?: McpToolUiCsp;
  
  cspRelaxations?: McpAppCspRelaxations;
  
  permissions?: McpAppsResourcePermission[];
  prefersBorder?: boolean;
  
  heightHint?: number;
  minFrameHeight?: number;
  
  showInline?: boolean;
}

export type PluginSandboxRegisterInput = Omit<PluginSandboxRegisterRequestPayload, "requestId">;
export interface PluginSandboxHandle {
  instance: import("./instance.js").McpAppInstance;
  sandboxId: string;
  initId: number;
  shellUrl: string;
  partition: string;
  
  resourceMeta?: PluginSandboxResourceMeta;
}
export type PluginSandboxRegisterResultPayload =
  | ({ requestId: string; ok: true } & PluginSandboxHandle)
  | { requestId: string; ok: false; error: string };
