

export const ARTIFACT_CHART_MAX_SERIES = 6;

export function artifactSeriesColorVar(index: number): string {
  return `var(--color-usage-chart-${(index % ARTIFACT_CHART_MAX_SERIES) + 1})`;
}

const SERIES_DASH: readonly (string | undefined)[] = [
  undefined,
  "6 3",
  "2 3",
  "9 3 2 3",
  "1 3",
  "12 4",
];

export function artifactSeriesDash(index: number): string | undefined {
  return SERIES_DASH[index % SERIES_DASH.length];
}

const SERIES_SYMBOL = ["circle", "cross", "diamond", "square", "triangle", "star"] as const;

export function artifactSeriesSymbol(index: number): (typeof SERIES_SYMBOL)[number] {
  return SERIES_SYMBOL[index % SERIES_SYMBOL.length]!;
}
