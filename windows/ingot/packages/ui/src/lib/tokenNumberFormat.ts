export function formatCompactTokenNumber(
  locale: string,
  value: number,
  options: { maximumFractionDigits?: number } = {},
): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  const maximumFractionDigits = options.maximumFractionDigits ?? 1;
  const absValue = Math.abs(value);

  return new Intl.NumberFormat(locale || undefined, {
    notation: absValue >= 1_000 ? "compact" : "standard",
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatModelContextWindowLabel(contextWindow: number, _locale = "en-US"): string {
  return formatCompactTokenNumber("en-US", contextWindow);
}
