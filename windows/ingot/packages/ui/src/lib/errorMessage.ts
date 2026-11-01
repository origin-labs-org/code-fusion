export function getErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : String(error);

  return rawMessage.replace(/^(Error:\s*)+/i, "").trim();
}
