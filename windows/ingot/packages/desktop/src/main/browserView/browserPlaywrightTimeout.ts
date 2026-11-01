export const PLAYWRIGHT_DEFAULT_TIMEOUT_MS = 3_000;

export function normalizePlaywrightTimeout(
  timeoutMs: number | undefined,
  max = PLAYWRIGHT_DEFAULT_TIMEOUT_MS,
): number {
  const requested = typeof timeoutMs === "number" ? timeoutMs : PLAYWRIGHT_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(0, requested), max || PLAYWRIGHT_DEFAULT_TIMEOUT_MS);
}
