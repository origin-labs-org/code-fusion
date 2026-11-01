

export type McpAppsDownloadFileItem =
  | {
      type: "resource";
      resource: { uri: string; name?: string; mimeType?: string; text?: string; blob?: string };
    }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string };

export const MCP_APPS_DOWNLOAD_FILE_MAX_ITEMS = 16;
export const MCP_APPS_DOWNLOAD_FILE_MAX_BYTES = 50 * 1024 * 1024;

export type McpAppsContentBlock = Record<string, unknown>;

export interface McpAppsToolInputPayload {
  arguments?: Record<string, unknown>;
}
export interface McpAppsToolResultPayload {
  content?: McpAppsContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface McpAppsHostTitleBar {
  height: number;
  leftInset: number;
  viewportLeftInset: number;
}

export type McpAppsStyleVariables = Record<string, string>;
