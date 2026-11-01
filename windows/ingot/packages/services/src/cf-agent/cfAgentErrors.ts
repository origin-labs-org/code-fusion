export const CF_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE =
  "CF_AGENT_MCP_STATUS_MODE_UNSUPPORTED";

export class CfAgentMcpStatusModeUnsupportedError extends Error {
  readonly code = CF_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE;

  constructor() {
    super("The connected CodeFusion Agent does not support MCP status-only refresh");
    this.name = "CfAgentMcpStatusModeUnsupportedError";
  }
}

export function isCfAgentMcpStatusModeUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as { code?: unknown }).code === CF_AGENT_MCP_STATUS_MODE_UNSUPPORTED_ERROR_CODE;
}
