import type {
  CallToolResult,
  Implementation,
  ListResourceTemplatesResult,
  ListResourcesResult,
  ReadResourceResult,
} from "@modelcontextprotocol/client";
import type {
  McpUiDisplayMode,
  McpUiHostCapabilities,
  McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { McpAppsDownloadFileItem } from "@origin-ai/cf-shared/mcp-apps";

export interface CfAliasApi {
  readonly toolInput: Record<string, unknown> | null;
  readonly toolOutput: unknown;
  readonly toolResponseMetadata: Record<string, unknown> | null;
  readonly toolCancelled: { reason?: string } | null;
  readonly theme: "light" | "dark" | null;
  readonly locale: string | null;
  readonly displayMode: McpUiDisplayMode | null;
  readonly maxHeight: number | null;
  readonly safeArea: McpUiHostContext["safeAreaInsets"] | null;
  readonly userAgent: string | null;
  
  readonly hostInfo: Implementation | null;
  readonly hostCapabilities: McpUiHostCapabilities | null;
  readonly hostContext: McpUiHostContext | null;
  readonly protocolVersion: string | null;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  
  readResource(uri: string): Promise<ReadResourceResult>;
  listResources(input?: { cursor?: string }): Promise<ListResourcesResult>;
  listResourceTemplates(input?: { cursor?: string }): Promise<ListResourceTemplatesResult>;
  
  subscribeResource(uri: string): Promise<void>;
  unsubscribeResource(uri: string): Promise<void>;
  onResourceUpdated(listener: (uri: string) => void): () => void;
  onResourceListChanged(listener: () => void): () => void;
  requestDisplayMode(input: { mode: McpUiDisplayMode }): Promise<{ mode: McpUiDisplayMode }>;
  openExternal(input: { href: string }): void;
  
  downloadFile(contents: McpAppsDownloadFileItem[]): Promise<{ isError?: boolean }>;
  notifyIntrinsicHeight(height: number): void;
  
  readonly widgetState: unknown;
  
  setWidgetState(widgetState: unknown): Promise<void>;
  
  sendFollowUpMessage(input: {
    prompt: string;
    structuredContent?: Record<string, unknown>;
  }): Promise<void>;
  
  updateModelContext(input: {
    content?: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
  }): Promise<void>;
  
  subscribe(listener: () => void): () => void;
  
  ready(): Promise<void>;
}

export interface OpenAiCompatApi {
  readonly toolInput: Record<string, unknown> | null;
  readonly toolOutput: unknown;
  readonly toolResponseMetadata: Record<string, unknown> | null;
  readonly widgetState: unknown;
  readonly theme: "light" | "dark" | null;
  readonly locale: string | null;
  readonly displayMode: McpUiDisplayMode | null;
  readonly maxHeight: number | null;
  readonly safeArea: McpUiHostContext["safeAreaInsets"] | null;
  readonly userAgent: string | null;
  setWidgetState(state: unknown): Promise<void>;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  sendFollowUpMessage(input: { prompt: string }): Promise<void>;
  requestDisplayMode(input: { mode: McpUiDisplayMode }): Promise<{ mode: McpUiDisplayMode }>;
  openExternal(input: { href: string }): void;
  notifyIntrinsicHeight(height: number): void;
}
