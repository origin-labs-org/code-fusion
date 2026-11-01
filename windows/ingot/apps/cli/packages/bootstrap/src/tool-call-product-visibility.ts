const EMPTY_TOOL_NAME_PLACEHOLDER = "empty_tool_name";

export function shouldHideInvalidToolCallFromProduct(
  toolName: unknown,
  metadata?: Record<string, unknown>,
): boolean {
  if (typeof toolName !== "string") return false;
  if (toolName.trim().length === 0) return true;

  const providerToolName = metadata?.providerToolName;
  return (
    toolName === EMPTY_TOOL_NAME_PLACEHOLDER &&
    providerToolName !== undefined &&
    typeof providerToolName === "string" &&
    providerToolName.trim().length === 0
  );
}
