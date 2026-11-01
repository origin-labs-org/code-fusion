// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  applyArtifactItems,
  type ArtifactItem,
} from "@/app-shell/workflow-artifacts/presets/apply.js";
import { chartPlotPropsEqual } from "@/app-shell/workflow-artifacts/presets/ArtifactChartView.js";
import {
  ArtifactBoard,
  ArtifactChart,
  ArtifactMetrics,
  ArtifactTable,
  parseArtifactPresetSpec,
  type BoardSpec,
  type ChartSpec,
  type MetricsSpec,
  type PresetLabels,
  type TableSpec,
} from "@/app-shell/workflow-artifacts/presets/index.js";

const labels: PresetLabels = {
  otherColumn: "其他",
  empty: "暂无Data",
  itemsCount: (count) => `${count} 条`,
};

function items(...raw: unknown[]): ArtifactItem[] {
  return raw.map((item, index) => ({
    sequence: index + 1,
    siteId: "report#1",
    ordinal: index + 1,
    item,
  }));
}

let restoreRect: (() => void) | undefined;

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function stubbedRect(this: Element): DOMRect {
    return {
      bottom: 200,
      height: 200,
      left: 0,
      right: 320,
      toJSON: () => ({}),
      top: 0,
      width: 320,
      x: 0,
      y: 0,
    } as DOMRect;
  };
  restoreRect = () => {
    Element.prototype.getBoundingClientRect = original;
  };
});

afterAll(() => {
  restoreRect?.();
});

afterEach(() => {
  cleanup();
});

describe("ArtifactMetrics", () => {
  const spec = parseArtifactPresetSpec("metrics", {
    title: "性能",
    metrics: [{ field: "p99", label: "P99", unit: "ms" }, { field: "errors" }],
  }) as MetricsSpec;

  it("renders a tile row in the compact form", () => {
    render(
      createElement(ArtifactMetrics, {
        compact: true,
        items: items({ p99: 12, errors: 0 }, { p99: 9 }),
        labels,
        spec,
      }),
    );
    const values = screen.getAllByTestId("artifact-metric-value").map((node) => node.textContent);
    expect(values).toEqual(["9", "0"]);
    expect(screen.queryByText("性能")).toBeNull();
  });

  it("renders the title and tiles in the full form", () => {
    render(createElement(ArtifactMetrics, { items: items({ p99: 9 }), labels, spec }));
    expect(screen.getByText("性能")).toBeTruthy();
    expect(screen.getAllByTestId("artifact-metric-tile")).toHaveLength(2);
    expect(screen.getAllByTestId("artifact-metric-value")[1]!.textContent).toBe("—");
  });

  it("shows the empty state before any item arrives", () => {
    render(createElement(ArtifactMetrics, { items: [], labels, spec }));
    expect(screen.getByTestId("artifact-preset-empty").textContent).toBe("暂无Data");
  });
});

describe("ArtifactTable", () => {
  const spec = parseArtifactPresetSpec("table", {
    title: "回合",
    columns: [{ field: "name" }, { field: "ms", label: "耗时", unit: "ms" }],
    key: "name",
  }) as TableSpec;

  it("shows the row count and only the first three rows in the compact form", () => {
    render(
      createElement(ArtifactTable, {
        compact: true,
        items: items(
          { name: "a", ms: 1 },
          { name: "b", ms: 2 },
          { name: "c", ms: 3 },
          { name: "d", ms: 4 },
        ),
        labels,
        spec,
      }),
    );
    expect(screen.getByTestId("artifact-table-count").textContent).toBe("4 条");
    expect(screen.getAllByTestId("artifact-table-row")).toHaveLength(3);
  });

  it("renders every row with unit-bearing headers in the full form", () => {
    render(
      createElement(ArtifactTable, {
        items: items({ name: "a", ms: 1 }, { name: "b", ms: 2 }, { name: "c", ms: 3 }),
        labels,
        spec,
      }),
    );
    expect(screen.getByText("回合")).toBeTruthy();
    expect(screen.getByText("耗时 (ms)")).toBeTruthy();
    expect(screen.getAllByTestId("artifact-table-row")).toHaveLength(3);
  });

  it("shows the empty state before any item arrives", () => {
    render(createElement(ArtifactTable, { items: [], labels, spec }));
    expect(screen.getByTestId("artifact-preset-empty")).toBeTruthy();
  });
});

describe("ArtifactBoard", () => {
  const spec = parseArtifactPresetSpec("board", {
    title: "驱动",
    key: "id",
    status: "state",
    columns: ["todo", "done"],
    cardTitle: "name",
    detail: [{ field: "owner", label: "负责人" }],
  }) as BoardSpec;

  const stream = items(
    { id: "1", state: "todo", name: "uart", owner: "a" },
    { id: "2", state: "done", name: "spi" },
    { id: "3", state: "blocked", name: "i2c" },
  );

  it("renders per-column counts in the compact form", () => {
    render(createElement(ArtifactBoard, { compact: true, items: stream, labels, spec }));
    const counts = screen
      .getAllByTestId("artifact-board-column-count")
      .map((node) => node.textContent);
    expect(counts).toEqual(["todo1", "done1", "Other1"]);
    expect(screen.queryByTestId("artifact-board-card")).toBeNull();
  });

  it("renders columns and cards in the full form", () => {
    render(createElement(ArtifactBoard, { items: stream, labels, spec }));
    expect(screen.getAllByTestId("artifact-board-column")).toHaveLength(3);
    expect(screen.getAllByTestId("artifact-board-card")).toHaveLength(3);
    expect(screen.getByText("uart")).toBeTruthy();
    expect(screen.getByText("其他")).toBeTruthy();
    expect(screen.getAllByText("负责人")).toHaveLength(3);
  });

  it("shows the empty state before any item arrives", () => {
    render(createElement(ArtifactBoard, { items: [], labels, spec }));
    expect(screen.getByTestId("artifact-preset-empty")).toBeTruthy();
  });
});

describe("ArtifactChart", () => {
  const spec = parseArtifactPresetSpec("chart", {
    title: "Query耗时",
    x: { field: "round", label: "轮次" },
    y: [
      { field: "queryMs", label: "查询", unit: "ms" },
      { field: "writeMs", label: "写入", unit: "ms" },
    ],
    baseline: { field: "budgetMs", label: "预算" },
  }) as ChartSpec;

  const stream = items(
    { round: 1, queryMs: 10, writeMs: 4, budgetMs: 6 },
    { round: 2, queryMs: 8, writeMs: 5 },
    { round: 3, queryMs: 6, writeMs: 5 },
  );

  it("lazily renders a sparkline plus the latest value in the compact form", async () => {
    render(createElement(ArtifactChart, { compact: true, items: stream, labels, spec }));
    expect(screen.getByTestId("artifact-chart-skeleton")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("artifact-chart-compact")).toBeTruthy());
    expect(screen.getByTestId("artifact-chart-latest").textContent).toBe("6ms");
    expect(document.querySelector("svg.recharts-surface")).toBeTruthy();
    expect(document.querySelector(".recharts-cartesian-axis-tick")).toBeNull();
  });

  it("renders axes, a legend and the x-axis caption in the full form", async () => {
    render(createElement(ArtifactChart, { items: stream, labels, spec }));
    await waitFor(() => expect(screen.getByTestId("artifact-chart")).toBeTruthy());
    expect(screen.getByText("Query耗时")).toBeTruthy();
    const legend = screen.getAllByTestId("artifact-chart-legend-item").map((n) => n.textContent);
    expect(legend).toEqual(["Query6 ms", "Write5 ms"]);
    expect(screen.getByText("轮次")).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector(".recharts-cartesian-axis-tick")).toBeTruthy(),
    );
    expect(document.querySelector(".recharts-reference-line")).toBeTruthy();
  });

  it("shows the empty state before any item arrives", async () => {
    render(createElement(ArtifactChart, { items: [], labels, spec }));
    await waitFor(() => expect(screen.getByTestId("artifact-preset-empty")).toBeTruthy());
  });

  it("keeps recharts out of the barrel's static import graph", async () => {
    const { readFile } = await import("node:fs/promises");
    const [entry, view, barrel] = await Promise.all(
      [
        "packages/ui/src/app-shell/workflow-artifacts/presets/ArtifactChart.tsx",
        "packages/ui/src/app-shell/workflow-artifacts/presets/ArtifactChartView.tsx",
        "packages/ui/src/app-shell/workflow-artifacts/presets/index.ts",
      ].map((path) => readFile(path, "utf8")),
    );
    expect(view).toContain('from "recharts"');
    expect(entry).not.toContain('from "recharts"');
    expect(entry).toContain("lazy(");
    expect(entry).toContain(
      'import("@/app-shell/workflow-artifacts/presets/ArtifactChartView.js")',
    );
    expect(barrel).not.toContain("ArtifactChartView");
  });
});

describe("chartPlotPropsEqual — 绘图体的重渲染契About", () => {
  const spec = parseArtifactPresetSpec("chart", {
    x: "round",
    y: "ms",
    baseline: "budget",
  }) as ChartSpec;

  function plot(count: number, options: { baseline?: number; offset?: number } = {}) {
    const stream = Array.from({ length: count }, (_, index) => ({
      sequence: index + 1 + (options.offset ?? 0),
      siteId: "report#1",
      ordinal: index + 1,
      item: {
        round: index + 1,
        ms: (index + 1) * 2,
        ...(options.baseline === undefined ? {} : { budget: options.baseline }),
      },
    }));
    return { compact: false, model: applyArtifactItems("chart", spec, stream) };
  }

  it("skips the re-render when a fresh model carries the same points", () => {
    expect(chartPlotPropsEqual(plot(3), plot(3))).toBe(true);
  });

  it("re-renders when a point arrives", () => {
    expect(chartPlotPropsEqual(plot(3), plot(4))).toBe(false);
  });

  it("re-renders when the same-sized batch was actually replaced", () => {
    expect(chartPlotPropsEqual(plot(3), plot(3, { offset: 100 }))).toBe(false);
  });

  it("re-renders when the baseline or the form changes", () => {
    expect(chartPlotPropsEqual(plot(3), plot(3, { baseline: 5 }))).toBe(false);
    expect(chartPlotPropsEqual(plot(3), { ...plot(3), compact: true })).toBe(false);
  });
});
