

import { readWorkflowArtifactField } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  artifactFieldLabel,
  chartSeriesFields,
  type ArtifactChartScale,
  type ArtifactChartType,
  type ArtifactField,
  type ArtifactPresetKind,
  type ArtifactPresetSpec,
  type BoardSpec,
  type ChartSpec,
  type MetricsSpec,
  type TableSpec,
} from "@/app-shell/workflow-artifacts/presets/spec.js";

export type ArtifactItem = {
  sequence: number;
  siteId: string;
  ordinal: number;
  
  item?: unknown;
  
  fields?: Record<string, unknown>;
};

export type ChartSeriesModel = {
  
  key: string;
  field: string;
  label: string;
  unit?: string;
  
  colorIndex: number;
};

export type ChartPointModel = Record<string, number | string | null> & {
  
  sequence: number;
  
  x: number;
  
  xLabel: string;
};

export type ChartModel = {
  kind: "chart";
  type: ArtifactChartType;
  scale: ArtifactChartScale;
  series: ChartSeriesModel[];
  points: ChartPointModel[];
  x: { label: string; unit?: string; numeric: boolean };
  
  baseline?: { value: number; label: string; unit?: string };
  
  domain?: { xMin: number; xMax: number; yMin: number; yMax: number };
};

type TableColumnModel = { field: string; label: string; unit?: string };
type TableRowModel = { id: string; sequence: number; cells: string[] };
type TableModel = {
  kind: "table";
  columns: TableColumnModel[];
  rows: TableRowModel[];
};

export type MetricTileModel = {
  field: string;
  label: string;
  unit?: string;
  
  value?: string;
  raw?: unknown;
  
  sequence?: number;
};
type MetricsModel = { kind: "metrics"; metrics: MetricTileModel[] };

export type BoardCardModel = {
  id: string;
  sequence: number;
  title: string;
  status: string;
  details: { label: string; value: string; unit?: string }[];
};
export type BoardColumnModel = {
  id: string;
  
  other: boolean;
  cards: BoardCardModel[];
};
type BoardModel = {
  kind: "board";
  columns: BoardColumnModel[];
  cardCount: number;
};

type ArtifactPresetModel = ChartModel | TableModel | MetricsModel | BoardModel;

const BOARD_OTHER_COLUMN_ID = "__other__";

export function readArtifactField(item: unknown, path: string): unknown {
  return readWorkflowArtifactField(item, path);
}

function readEntryField(entry: ArtifactItem, path: string): unknown {
  if (entry.fields !== undefined) {
    return Object.hasOwn(entry.fields, path) ? entry.fields[path] : undefined;
  }
  return readArtifactField(entry.item, path);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function formatArtifactValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

function seriesKey(index: number): string {
  return `y${index}`;
}

function applyChart(spec: ChartSpec, items: readonly ArtifactItem[]): ChartModel {
  const fields = chartSeriesFields(spec);
  const series: ChartSeriesModel[] = fields.map((field, index) => ({
    key: seriesKey(index),
    field: field.field,
    label: artifactFieldLabel(field),
    ...(field.unit ? { unit: field.unit } : {}),
    colorIndex: index,
  }));

  type Raw = { sequence: number; x: unknown; values: (number | undefined)[] };
  const raws: Raw[] = [];
  let baseline: ChartModel["baseline"];

  for (const entry of items) {
    const rawX = readEntryField(entry, spec.x.field);
    if (!hasValue(rawX)) {
      continue;
    }
    const values = fields.map((field) => {
      const value = toFiniteNumber(readEntryField(entry, field.field));
      if (value === undefined) {
        return undefined;
      }
      return spec.scale === "log" && value <= 0 ? undefined : value;
    });
    raws.push({ sequence: entry.sequence, x: rawX, values });

    if (spec.baseline && !baseline) {
      const raw = readEntryField(entry, spec.baseline.field);
      const value = toFiniteNumber(raw);
      if (value !== undefined && !(spec.scale === "log" && value <= 0)) {
        baseline = {
          value,
          label: artifactFieldLabel(spec.baseline),
          ...(spec.baseline.unit ? { unit: spec.baseline.unit } : {}),
        };
      }
    }
  }

  const numericX = raws.length > 0 && raws.every((raw) => toFiniteNumber(raw.x) !== undefined);
  const ordered = numericX
    ? [...raws].sort((left, right) => {
        const delta = toFiniteNumber(left.x)! - toFiniteNumber(right.x)!;
        return delta !== 0 ? delta : left.sequence - right.sequence;
      })
    : raws;

  const points: ChartPointModel[] = ordered.map((raw, index) => {
    const x = numericX ? toFiniteNumber(raw.x)! : index;
    const point: ChartPointModel = {
      sequence: raw.sequence,
      x,
      xLabel: formatArtifactValue(raw.x),
    };
    raw.values.forEach((value, seriesIndex) => {
      point[seriesKey(seriesIndex)] = value ?? null;
    });
    return point;
  });

  const yValues = ordered.flatMap((raw) =>
    raw.values.filter((value): value is number => value !== undefined),
  );
  const domain =
    points.length > 0 && yValues.length > 0
      ? {
          xMin: Math.min(...points.map((point) => point.x)),
          xMax: Math.max(...points.map((point) => point.x)),
          yMin: Math.min(...yValues),
          yMax: Math.max(...yValues),
        }
      : undefined;

  return {
    kind: "chart",
    type: spec.type ?? "line",
    scale: spec.scale ?? "linear",
    series,
    points,
    x: {
      label: artifactFieldLabel(spec.x),
      ...(spec.x.unit ? { unit: spec.x.unit } : {}),
      numeric: numericX,
    },
    ...(baseline ? { baseline } : {}),
    ...(domain ? { domain } : {}),
  };
}

function applyTable(spec: TableSpec, items: readonly ArtifactItem[]): TableModel {
  const columns: TableColumnModel[] = spec.columns.map((column) => ({
    field: column.field,
    label: artifactFieldLabel(column),
    ...(column.unit ? { unit: column.unit } : {}),
  }));

  const byId = new Map<string, TableRowModel>();
  for (const entry of items) {
    const keyValue = spec.key ? readEntryField(entry, spec.key) : undefined;
    const id = hasValue(keyValue)
      ? formatArtifactValue(keyValue)
      : `${entry.siteId}@${entry.ordinal}`;
    byId.set(id, {
      id,
      sequence: entry.sequence,
      cells: columns.map((column) => formatArtifactValue(readEntryField(entry, column.field))),
    });
  }

  return { kind: "table", columns, rows: [...byId.values()] };
}

function applyMetrics(spec: MetricsSpec, items: readonly ArtifactItem[]): MetricsModel {
  const metrics: MetricTileModel[] = spec.metrics.map((metric) => ({
    field: metric.field,
    label: artifactFieldLabel(metric),
    ...(metric.unit ? { unit: metric.unit } : {}),
  }));

  for (const entry of items) {
    metrics.forEach((tile, index) => {
      const raw = readEntryField(entry, tile.field);
      if (!hasValue(raw)) {
        return;
      }
      metrics[index] = {
        ...tile,
        value: formatArtifactValue(raw),
        raw,
        sequence: entry.sequence,
      };
    });
  }

  return { kind: "metrics", metrics };
}

function applyBoard(spec: BoardSpec, items: readonly ArtifactItem[]): BoardModel {
  const detail: ArtifactField[] = spec.detail ?? [];
  const byId = new Map<string, BoardCardModel>();

  for (const entry of items) {
    const keyValue = readEntryField(entry, spec.key);
    if (!hasValue(keyValue)) {
      continue;
    }
    const id = formatArtifactValue(keyValue);
    const status = formatArtifactValue(readEntryField(entry, spec.status));
    const titleRaw = spec.cardTitle ? readEntryField(entry, spec.cardTitle) : undefined;
    byId.set(id, {
      id,
      sequence: entry.sequence,
      title: hasValue(titleRaw) ? formatArtifactValue(titleRaw) : id,
      status,
      details: detail.map((field) => ({
        label: artifactFieldLabel(field),
        value: formatArtifactValue(readEntryField(entry, field.field)),
        ...(field.unit ? { unit: field.unit } : {}),
      })),
    });
  }

  const columns: BoardColumnModel[] = spec.columns.map((column) => ({
    id: column,
    other: false,
    cards: [],
  }));
  const listed = new Map(columns.map((column) => [column.id, column]));
  const other: BoardColumnModel = { id: BOARD_OTHER_COLUMN_ID, other: true, cards: [] };

  for (const card of byId.values()) {
    (listed.get(card.status) ?? other).cards.push(card);
  }

  return {
    kind: "board",
    columns: other.cards.length > 0 ? [...columns, other] : columns,
    cardCount: byId.size,
  };
}

export function applyArtifactItems(
  kind: "chart",
  spec: ChartSpec,
  items: readonly ArtifactItem[],
): ChartModel;
export function applyArtifactItems(
  kind: "table",
  spec: TableSpec,
  items: readonly ArtifactItem[],
): TableModel;
export function applyArtifactItems(
  kind: "metrics",
  spec: MetricsSpec,
  items: readonly ArtifactItem[],
): MetricsModel;
export function applyArtifactItems(
  kind: "board",
  spec: BoardSpec,
  items: readonly ArtifactItem[],
): BoardModel;
export function applyArtifactItems(
  kind: ArtifactPresetKind,
  spec: ArtifactPresetSpec,
  items: readonly ArtifactItem[],
): ArtifactPresetModel;
export function applyArtifactItems(
  kind: ArtifactPresetKind,
  spec: ArtifactPresetSpec,
  items: readonly ArtifactItem[],
): ArtifactPresetModel {
  switch (kind) {
    case "chart":
      return applyChart(spec as ChartSpec, items);
    case "table":
      return applyTable(spec as TableSpec, items);
    case "metrics":
      return applyMetrics(spec as MetricsSpec, items);
    case "board":
      return applyBoard(spec as BoardSpec, items);
  }
}
