
import type { McpOfficialProvenance, CfOfficialMcpAuthConfig } from "@origin-ai/cf-contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCfOfficialAuth(
  value: unknown,
  mcpKey: string,
): CfOfficialMcpAuthConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`MCP server ${mcpKey}: auth must be an object`);
  }
  if (value.type !== "cf_official") {
    throw new Error(`MCP server ${mcpKey}: unsupported auth type: ${String(value.type)}`);
  }
  if (value.provider !== "jwt_token") {
    throw new Error(`MCP server ${mcpKey}: unsupported auth provider: ${String(value.provider)}`);
  }
  return { type: "cf_official", provider: "jwt_token" };
}

export function buildOfficialProvenance(identity: {
  mcpKey: string;
  pluginId: string;
}): McpOfficialProvenance {
  return { mcpKey: identity.mcpKey, pluginId: identity.pluginId, source: "plugin" };
}
