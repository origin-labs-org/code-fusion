
type FormatMessage = (descriptor: { id: string }) => string;

interface WorkDurationPart {
  value: number;
  
  unit: string;
}

const UNIT_IDS = {
  day: "chat.history.duration.day",
  hour: "chat.history.duration.hour",
  minute: "chat.history.duration.minute",
  second: "chat.history.duration.second",
} as const;

export function workDurationParts(
  durationMs: number,
  formatMessage: FormatMessage,
): WorkDurationPart[] {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: WorkDurationPart[] = [];
  if (days > 0) parts.push({ value: days, unit: formatMessage({ id: UNIT_IDS.day }) });
  if (hours > 0) parts.push({ value: hours, unit: formatMessage({ id: UNIT_IDS.hour }) });
  if (minutes > 0) parts.push({ value: minutes, unit: formatMessage({ id: UNIT_IDS.minute }) });
  if (seconds > 0 || parts.length === 0) {
    parts.push({ value: seconds, unit: formatMessage({ id: UNIT_IDS.second }) });
  }
  return parts.slice(0, 2);
}

export function workDurationUnitSeparator(locale: string): string {
  return locale === "zh-CN" ? " " : "";
}

export function formatWorkDuration(
  durationMs: number | undefined,
  formatMessage: FormatMessage,
  locale: string,
): string | null {
  if (durationMs === undefined) return null;
  const separator = workDurationUnitSeparator(locale);
  return workDurationParts(durationMs, formatMessage)
    .map((part) => `${part.value}${separator}${part.unit}`)
    .join(" ");
}
