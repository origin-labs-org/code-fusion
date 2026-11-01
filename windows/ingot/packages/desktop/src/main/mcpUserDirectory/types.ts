

import type { CliMcpSource, McpFileFormat } from "@origin-ai/cf-shared";

export type McpConfigKeyName = "mcpServers" | "mcp" | "mcp_servers" | "mcp.servers";

export interface OpenCodeMcpServerConfig {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface McpSourceDescriptor {
  source: CliMcpSource;
  configDirSegments: string[];
  fileName: string;
  format: McpFileFormat;
  configKeyName: McpConfigKeyName;
}

export const MCP_SOURCE_DESCRIPTORS: McpSourceDescriptor[] = [
  {
    source: "cfagentmcp",
    configDirSegments: [".cf", "cli"],
    fileName: "config.json",
    format: "json",
    configKeyName: "mcp.servers",
  },
];

export function getSourceDescriptor(source: CliMcpSource): McpSourceDescriptor {
  const descriptor = MCP_SOURCE_DESCRIPTORS.find((item) => item.source === source);
  if (!descriptor) {
    throw new Error(`Unsupported MCP source: ${source}`);
  }
  return descriptor;
}
