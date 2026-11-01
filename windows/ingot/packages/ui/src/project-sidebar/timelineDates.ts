import type { Locale } from "@/project-sidebar/contract.js";

interface TimelineDateHeading {
  key: string;
  id: string;
  values?: { days: string };
}

function calendarDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function timelineDateHeadings(
  timestamps: readonly number[],
  now: number,
  locale: Locale,
): Array<TimelineDateHeading | null> {
  const today = calendarDay(now);
  const date = new Date(now);
  const weekStart = today - ((date.getDay() + (locale === "en-US" ? 0 : 6)) % 7);
  const monthStart = calendarDay(new Date(date.getFullYear(), date.getMonth(), 1).getTime());
  const lastMonthStart = calendarDay(
    new Date(date.getFullYear(), date.getMonth() - 1, 1).getTime(),
  );
  let previousKey: string | undefined;
  return timestamps.map((timestamp) => {
    const day = calendarDay(timestamp);
    const daysAgo = today - day;
    const kind =
      daysAgo <= 0
        ? "today"
        : daysAgo === 1
          ? "yesterday"
          : daysAgo <= 3
            ? "daysAgo"
            : day >= weekStart
              ? "thisWeek"
              : day >= weekStart - 7
                ? "lastWeek"
                : day >= monthStart
                  ? "thisMonth"
                  : day >= lastMonthStart
                    ? "lastMonth"
                    : "older";
    const key = kind === "daysAgo" ? `${kind}:${daysAgo}` : kind;
    if (key === previousKey) return null;
    previousKey = key;
    return {
      key,
      id: `taskTimeline.${kind}`,
      ...(kind === "daysAgo" ? { values: { days: String(daysAgo) } } : {}),
    };
  });
}
