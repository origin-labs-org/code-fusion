/** When Zephium AI's daily limit next resets: 00:00 UTC, shown on the person's own clock. */
export function dailyResetTime(now: Date = new Date()): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(next);
}
