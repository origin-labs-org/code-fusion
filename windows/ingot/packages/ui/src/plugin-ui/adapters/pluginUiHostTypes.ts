import type { McpUiAppCapabilities } from "@modelcontextprotocol/ext-apps/app-bridge";
import type {
  McpAppsDisplayMode,
  McpAppsHostTitleBar,
  McpAppsToolResultPayload,
  PluginSandboxHandle,
} from "@origin-ai/cf-shared/mcp-apps";
import type {
  PluginUiHostControllerDeps,
  PluginUiHostPhase,
  PluginUiHostScope,
} from "../app/pluginUiHostController.js";
import type { PluginUiPresentation } from "../contract.js";
export interface UsePluginUiHostInput {
  presentation: PluginUiPresentation;
  scope: PluginUiHostScope;
  theme: "light" | "dark";
  locale: string;
  displayMode: McpAppsDisplayMode;
  toolInput: Record<string, unknown> | undefined;
  toolResult: McpAppsToolResultPayload | undefined;
  
  toolCallId?: string;
  
  toolCancelled?: boolean;
  hostVersion: string;
  
  availableDisplayModes?: readonly McpAppsDisplayMode[];
  onDisplayModeRequest?: (mode: McpAppsDisplayMode) => McpAppsDisplayMode;
  onOpenExternal?: (url: string) => void;
  
  width: number;
  
  titleBar?: McpAppsHostTitleBar;
  
  enabled?: boolean;
  
  interactions?: Pick<PluginUiHostControllerDeps, "onSendFollowUpMessage" | "onUpdateModelContext">;
}

export interface UsePluginUiHostResult {
  
  pageKey: string;
  supported: boolean;
  phase: PluginUiHostPhase;
  handle: PluginSandboxHandle | null;
  height: number;
  error: string | null;
  
  appCapabilities: McpUiAppCapabilities | undefined;
  
  reload(): void;
}

export interface Page {
  readonly kind: "mcp";
  key: string;
  task: string;
  visible: boolean;
  snapshot(): UsePluginUiHostResult;
  subscribe(listener: () => void): () => void;
  start(): void;
  update(input: UsePluginUiHostInput): void;
  updateToolFeed(
    input: Pick<UsePluginUiHostInput, "toolCallId" | "toolInput" | "toolResult" | "toolCancelled">,
  ): void;
  bind(node: HTMLElement, sidebar: boolean): () => void;
  busy(): boolean;
  running(): boolean;
  suspend(force?: boolean): Promise<boolean>;
  destroy(): void;
}
