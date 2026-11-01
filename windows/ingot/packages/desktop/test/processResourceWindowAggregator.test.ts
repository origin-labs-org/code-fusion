import { describe, expect, it } from "vitest";
import {
  ProcessResourceWindowAggregator,
  type ProcessRoleSample,
} from "@desktop/main/processResourceWindowAggregator";

function sample(overrides: Partial<ProcessRoleSample> = {}): ProcessRoleSample {
  return {
    role: "main",
    cpuPercent: 10,
    rssKbTotal: 1_000,
    rssKbMaxProcess: 1_000,
    processCount: 1,
    uptimeMinutes: 5,
    ...overrides,
  };
}

describe("ProcessResourceWindowAggregator", () => {
  it("PRT-034 Different environments on the same hardware open windows independently; identity does not enter egress properties", async () => {
    const { buildProcessWindowEventProperties } =
      await import("@desktop/main/processResourceWindowEvent");
    const aggregator = new ProcessResourceWindowAggregator();
    const hardware = {
      platform: "linux" as const,
      arch: "x64",
      logicalCpuCount: 8,
      totalMemoryGb: 32,
    };
    for (const environmentKey of ["a".repeat(64), "b".repeat(64)]) {
      aggregator.add(
        sample({
          role: "cli_chat",
          runtimeSurface: "remote",
          cpuPercent: 80,
          environmentKey,
          hardware,
        }),
      );
    }
    const reports = aggregator.drain();
    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report.cpuPercentPeak).toBe(80);
      const properties = buildProcessWindowEventProperties(report, {
        deviceMid: "test",
        appVersion: "test",
        armsEnv: "test",
        desktopHardware: hardware,
      });
      expect(properties).not.toHaveProperty("environmentKey");
      expect(Object.values(properties)).not.toContain("a".repeat(64));
      expect(Object.values(properties)).not.toContain("b".repeat(64));
    }
  });

  it("One report per role: CPU provides mean / p95 / peak, memory provides mean / peak / max single process", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    aggregator.add(sample({ cpuPercent: 10, rssKbTotal: 100, rssKbMaxProcess: 60 }));
    aggregator.add(sample({ cpuPercent: 30, rssKbTotal: 300, rssKbMaxProcess: 200 }));
    aggregator.add(sample({ role: "gpu", cpuPercent: 5, rssKbTotal: 50, rssKbMaxProcess: 50 }));

    const reports = aggregator.drain();
    expect(reports.map((report) => report.role)).toEqual(["main", "gpu"]);
    expect(reports[0]).toMatchObject({
      cpuPercentMean: 20,
      cpuPercentPeak: 30,
      cpuPercentP95: 30,
      rssKbTotalMean: 200,
      rssKbTotalPeak: 300,
      rssKbMaxProcessPeak: 200,
      processCountPeak: 1,
      sampleCount: 2,
    });
  });

  it("PRT-003 process_count_peak for multi-process roles takes the maximum within the window", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    aggregator.add(sample({ role: "renderer_guest", processCount: 1, rssKbTotal: 100 }));
    aggregator.add(sample({ role: "renderer_guest", processCount: 3, rssKbTotal: 600 }));
    aggregator.add(sample({ role: "renderer_guest", processCount: 2, rssKbTotal: 300 }));

    const [report] = aggregator.drain();
    expect(report?.processCountPeak).toBe(3);
    expect(report?.rssKbTotalPeak).toBe(600);
  });

  it("PRT-004 background_ratio is the proportion of background ticks within the window", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    for (let index = 0; index < 30; index += 1) {
      aggregator.recordScene(index < 9 ? "background" : "foreground");
      aggregator.add(sample());
    }

    const [report] = aggregator.drain();
    expect(report?.backgroundRatio).toBe(0.3);
    expect(report?.sampleCount).toBe(30);
  });

  it("PRT-005 uptime_minutes takes the maximum within the window", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    aggregator.add(sample({ uptimeMinutes: 10 }));
    aggregator.add(sample({ uptimeMinutes: 90 }));

    expect(aggregator.drain()[0]?.uptimeMinutes).toBe(90);
  });

  it("PRT-018 Single-role sample count is truncated to 32", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    for (let index = 0; index < 40; index += 1) {
      aggregator.recordScene("foreground");
      aggregator.add(sample({ cpuPercent: index }));
    }

    const [report] = aggregator.drain();
    expect(report?.sampleCount).toBe(32);
    expect(report?.cpuPercentPeak).toBe(39);
  });

  it("heap is output only when samples exist and is decoupled from the rss sample count", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    aggregator.add(sample({ heapUsedKb: 100 }));
    aggregator.add(sample());
    aggregator.add(sample({ heapUsedKb: 300 }));
    aggregator.add(sample({ role: "gpu" }));

    const reports = aggregator.drain();
    expect(reports[0]).toMatchObject({ heapUsedKbMean: 200, heapUsedKbPeak: 300, sampleCount: 3 });
    expect(reports[1]?.heapUsedKbMean).toBeUndefined();
    expect(reports[1]?.heapUsedKbPeak).toBeUndefined();
  });

  it("mcp_id 与 runtime_surface 不同的样本分属不同窗口", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    aggregator.add(sample({ role: "mcp", mcpId: "alpha" }));
    aggregator.add(sample({ role: "mcp", mcpId: "beta" }));
    aggregator.add(sample({ role: "cli_chat", runtimeSurface: "remote" }));
    aggregator.add(sample({ role: "cli_chat" }));

    const reports = aggregator.drain();
    expect(reports).toHaveLength(4);
    expect(reports.filter((report) => report.role === "mcp").map((report) => report.mcpId)).toEqual(
      ["alpha", "beta"],
    );
  });

  it("The same role across multiple machines belongs to different windows; a single event describes only one machine", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    const hostA = { platform: "linux" as const, arch: "x64", logicalCpuCount: 4, totalMemoryGb: 8 };
    const hostB = {
      platform: "linux" as const,
      arch: "arm64",
      logicalCpuCount: 16,
      totalMemoryGb: 64,
    };
    aggregator.add(
      sample({ role: "cli_chat", runtimeSurface: "remote", hardware: hostA, rssKbTotal: 100 }),
    );
    aggregator.add(
      sample({ role: "cli_chat", runtimeSurface: "remote", hardware: hostB, rssKbTotal: 900 }),
    );

    const reports = aggregator.drain();
    expect(reports).toHaveLength(2);
    expect(reports.map((report) => report.hardware)).toEqual([hostA, hostB]);
    expect(reports.map((report) => report.rssKbTotalPeak)).toEqual([100, 900]);
  });

  it("Windows are cleared after drain, and scene counts are also reset", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    aggregator.recordScene("background");
    aggregator.add(sample());
    expect(aggregator.drain()).toHaveLength(1);
    expect(aggregator.drain()).toEqual([]);

    aggregator.recordScene("foreground");
    aggregator.add(sample());
    expect(aggregator.drain()[0]?.backgroundRatio).toBe(0);
  });

  it("clear discards residual windows without generating events", () => {
    const aggregator = new ProcessResourceWindowAggregator();
    aggregator.add(sample());
    aggregator.clear();
    expect(aggregator.drain()).toEqual([]);
  });
});
