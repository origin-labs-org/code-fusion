

export type ArtifactField = {
  field: string;
  label?: string;
  unit?: string;
};

export type ArtifactChartType = "line" | "bar" | "scatter";
export type ArtifactChartScale = "linear" | "log";

const CHART_TYPES: readonly ArtifactChartType[] = ["line", "bar", "scatter"];
const CHART_SCALES: readonly ArtifactChartScale[] = ["linear", "log"];

type ArtifactPresetOptions = {
  title?: string;
  description?: string;
};

export type ChartSpec = ArtifactPresetOptions & {
  
  type?: ArtifactChartType;
  x: ArtifactField;
  
  y: ArtifactField | ArtifactField[];
  
  scale?: ArtifactChartScale;
  
  baseline?: ArtifactField;
};

export type TableSpec = ArtifactPresetOptions & {
  columns: ArtifactField[];
  
  key?: string;
};

export type MetricsSpec = ArtifactPresetOptions & {
  
  metrics: ArtifactField[];
};

export type BoardSpec = ArtifactPresetOptions & {
  
  key: string;
  
  status: string;
  
  columns: string[];
  
  cardTitle?: string;
  detail?: ArtifactField[];
};

export type ArtifactPresetKind = "chart" | "table" | "metrics" | "board";
export type ArtifactPresetSpec = ChartSpec | TableSpec | MetricsSpec | BoardSpec;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseField(value: unknown): ArtifactField | undefined {
  const shorthand = readNonEmptyString(value);
  if (shorthand) {
    return { field: shorthand };
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const field = readNonEmptyString(value.field);
  if (!field) {
    return undefined;
  }
  const label = readNonEmptyString(value.label);
  const unit = readNonEmptyString(value.unit);
  return { field, ...(label ? { label } : {}), ...(unit ? { unit } : {}) };
}

function parseFieldList(value: unknown): ArtifactField[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const fields = value
    .map(parseField)
    .filter((field): field is ArtifactField => field !== undefined);
  return fields.length > 0 ? fields : undefined;
}

function parseOptions(spec: Record<string, unknown>): ArtifactPresetOptions {
  const title = readNonEmptyString(spec.title);
  const description = readNonEmptyString(spec.description);
  return { ...(title ? { title } : {}), ...(description ? { description } : {}) };
}

function parseChartSpec(spec: Record<string, unknown>): ChartSpec | undefined {
  const x = parseField(spec.x);
  if (!x) {
    return undefined;
  }
  const single = Array.isArray(spec.y) ? undefined : parseField(spec.y);
  const y = Array.isArray(spec.y) ? parseFieldList(spec.y) : single ? [single] : undefined;
  if (!y) {
    return undefined;
  }
  const type = CHART_TYPES.find((candidate) => candidate === spec.type) ?? "line";
  const scale = CHART_SCALES.find((candidate) => candidate === spec.scale) ?? "linear";
  const baseline = parseField(spec.baseline);
  return {
    ...parseOptions(spec),
    type,
    x,
    y,
    scale,
    ...(baseline ? { baseline } : {}),
  };
}

function parseTableSpec(spec: Record<string, unknown>): TableSpec | undefined {
  const columns = parseFieldList(spec.columns);
  if (!columns) {
    return undefined;
  }
  const key = readNonEmptyString(spec.key);
  return { ...parseOptions(spec), columns, ...(key ? { key } : {}) };
}

function parseMetricsSpec(spec: Record<string, unknown>): MetricsSpec | undefined {
  const metrics = parseFieldList(spec.metrics);
  if (!metrics) {
    return undefined;
  }
  return { ...parseOptions(spec), metrics };
}

function parseBoardSpec(spec: Record<string, unknown>): BoardSpec | undefined {
  const key = readNonEmptyString(spec.key);
  const status = readNonEmptyString(spec.status);
  if (!key || !status) {
    return undefined;
  }
  if (!Array.isArray(spec.columns)) {
    return undefined;
  }
  const columns = spec.columns
    .map(readNonEmptyString)
    .filter((column): column is string => column !== undefined);
  if (columns.length === 0) {
    return undefined;
  }
  const cardTitle = readNonEmptyString(spec.cardTitle);
  const detail = parseFieldList(spec.detail);
  return {
    ...parseOptions(spec),
    key,
    status,
    columns,
    ...(cardTitle ? { cardTitle } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function parseArtifactPresetSpec(
  kind: ArtifactPresetKind,
  spec: unknown,
): ArtifactPresetSpec | undefined {
  if (!isRecord(spec)) {
    return undefined;
  }
  switch (kind) {
    case "chart":
      return parseChartSpec(spec);
    case "table":
      return parseTableSpec(spec);
    case "metrics":
      return parseMetricsSpec(spec);
    case "board":
      return parseBoardSpec(spec);
    default:
      return undefined;
  }
}

export function chartSeriesFields(spec: ChartSpec): ArtifactField[] {
  return Array.isArray(spec.y) ? spec.y : [spec.y];
}

export function artifactFieldLabel(field: ArtifactField): string {
  return field.label ?? field.field;
}

export function artifactPresetFieldPaths(
  kind: ArtifactPresetKind,
  rawSpec: unknown,
): string[] | undefined {
  const spec = parseArtifactPresetSpec(kind, rawSpec);
  if (spec === undefined) return undefined;
  const paths: string[] = [];
  const add = (path: string | undefined): void => {
    if (path !== undefined && !paths.includes(path)) paths.push(path);
  };
  switch (kind) {
    case "chart": {
      const chart = spec as ChartSpec;
      add(chart.x.field);
      for (const field of chartSeriesFields(chart)) add(field.field);
      add(chart.baseline?.field);
      break;
    }
    case "table": {
      const table = spec as TableSpec;
      add(table.key);
      for (const column of table.columns) add(column.field);
      break;
    }
    case "metrics":
      for (const metric of (spec as MetricsSpec).metrics) add(metric.field);
      break;
    case "board": {
      const board = spec as BoardSpec;
      add(board.key);
      add(board.status);
      add(board.cardTitle);
      for (const field of board.detail ?? []) add(field.field);
      break;
    }
  }
  return paths;
}
