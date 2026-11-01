

const WAITED_MINUTE_MS = 60_000;
const WAITED_HOUR_MS = 60 * WAITED_MINUTE_MS;
const WAITED_DAY_MS = 24 * WAITED_HOUR_MS;

type FormatMessage = (descriptor: { id: string }, values?: Record<string, string>) => string;

export function workflowRunQuestionWaitedLabel(
  askedAt: number | undefined,
  now: number,
  formatMessage: FormatMessage,
): string | undefined {
  if (askedAt === undefined || !Number.isFinite(askedAt)) return undefined;
  const elapsed = now - askedAt;
  if (elapsed < WAITED_MINUTE_MS) return formatMessage({ id: "sidePane.time.justNow" });
  if (elapsed < WAITED_HOUR_MS) {
    return formatMessage(
      { id: "sidePane.time.minutesAgo" },
      { count: String(Math.floor(elapsed / WAITED_MINUTE_MS)) },
    );
  }
  if (elapsed < WAITED_DAY_MS) {
    return formatMessage(
      { id: "sidePane.time.hoursAgo" },
      { count: String(Math.floor(elapsed / WAITED_HOUR_MS)) },
    );
  }
  return formatMessage(
    { id: "sidePane.time.daysAgo" },
    { count: String(Math.floor(elapsed / WAITED_DAY_MS)) },
  );
}
