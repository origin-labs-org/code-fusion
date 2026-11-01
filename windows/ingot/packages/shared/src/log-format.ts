

export function formatTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}-${mo}-${d} ${h}:${min}:${s}.${ms}`;
}

export function formatLogPrefix(source: string, pid?: number): string {
  const ts = formatTimestamp();
  const pidPart = pid != null ? ` [pid:${pid}]` : "";
  return `[${ts}]${pidPart} [${source}]`;
}
