

export const OFFICIAL_MCP_TOOL_ERROR_CODES = ["quota_exceeded", "coding_plan_required"] as const;

export type OfficialMcpToolErrorCode = (typeof OFFICIAL_MCP_TOOL_ERROR_CODES)[number];

const OFFICIAL_MCP_TOOL_ERROR_CODE_SET = new Set<string>(OFFICIAL_MCP_TOOL_ERROR_CODES);

export interface OfficialMcpToolError {
  code: OfficialMcpToolErrorCode;
  
  message?: string;
  
  requestId?: string;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseOfficialMcpToolError(text: string): OfficialMcpToolError | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return undefined;

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (typeof payload !== "object" || payload === null) return undefined;

  const record = payload as Record<string, unknown>;
  const code = readString(record.error_code);
  if (!code || !OFFICIAL_MCP_TOOL_ERROR_CODE_SET.has(code)) return undefined;

  const message = readString(record.message);
  const requestId = readString(record.request_id);
  return {
    code: code as OfficialMcpToolErrorCode,
    ...(message ? { message } : {}),
    ...(requestId ? { requestId } : {}),
  };
}
