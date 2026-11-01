import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cliProcessResourceSampleSource,
  ingestCliResourceSample,
} from "@desktop/main/processResourceCliSource";
import { PROCESS_RESOURCE_SAMPLE_SOURCES } from "@desktop/main/processResourceSampleSourceRegistry";
import {
  collectExternalAppResourceTotals,
  recordExternalAppResourceSample,
  resetExternalAppResourceSamples,
} from "@desktop/main/processResourceExternalAppSamples";
import type { ProcessRoleSample } from "@desktop/main/processResourceWindowAggregator";
import { CF_CLI_RESOURCE_SAMPLE_INTERVAL_MS } from "@origin-ai/cf-shared";

const CLI_PERIOD_MS = CF_CLI_RESOURCE_SAMPLE_INTERVAL_MS;

function cliSample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: "darwin",
    arch: "arm64",
    logicalCpuCount: 10,
    intervalMs: CLI_PERIOD_MS,
    cpuCores: 0.5,
    cpuPercent: 5,
    rssKb: 200_000,
    heapUsedKb: 40_000,
    uptimeMinutes: 8,
    totalMemoryGb: 32,
    instanceToken: "chat-instance-0001",
    lane: "chat",
    ...overrides,
  };
}

function ingestAt(
  now: number,
  sample: unknown,
  runtimeSurface: "local" | "remote" = "local",
): void {
  vi.setSystemTime(now);
  ingestCliResourceSample(sample, runtimeSurface);
}

function collect(
  run: (context: Parameters<NonNullable<typeof cliProcessResourceSampleSource.sample>>[0]) => void,
  now: number,
): ProcessRoleSample[] {
  vi.setSystemTime(now);
  const samples: ProcessRoleSample[] = [];
  run({
    now,
    addRoleSample: (sample) => samples.push(sample),
    addRoleHeapSample: () => {},
    addAppProcessTotals: () => {},
  });
  return samples;
}

function tickAt(now = 0): ProcessRoleSample[] {
  return collect((context) => cliProcessResourceSampleSource.sample?.(context), now);
}

function flushAt(now = 0): ProcessRoleSample[] {
  return collect((context) => cliProcessResourceSampleSource.flushPending?.(context), now);
}

describe("processResourceCliSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    cliProcessResourceSampleSource.reset?.();
    resetExternalAppResourceSamples();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("PRT-007: Two processes in chat lane aggregate into cli_chat; plugin lane belongs to cli_aux", () => {
    ingestAt(0, cliSample({ instanceToken: "chat-instance-0001", cpuPercent: 5, rssKb: 200_000 }));
    ingestAt(
      0,
      cliSample({
        instanceToken: "chat-instance-0002",
        cpuPercent: 7,
        rssKb: 300_000,
        heapUsedKb: 90_000,
        uptimeMinutes: 12,
      }),
    );
    ingestAt(
      0,
      cliSample({
        lane: "plugin",
        instanceToken: "aux-instance-0001",
        cpuPercent: 1,
        rssKb: 90_000,
      }),
    );

    expect(tickAt()).toEqual([
      {
        role: "cli_chat",
        runtimeSurface: "local",
        cpuPercent: 12,
        rssKbTotal: 500_000,
        rssKbMaxProcess: 300_000,
        processCount: 2,
        uptimeMinutes: 12,
        heapUsedKb: 90_000,
        hardware: { platform: "darwin", arch: "arm64", logicalCpuCount: 10, totalMemoryGb: 32 },
      },
      {
        role: "cli_aux",
        runtimeSurface: "local",
        cpuPercent: 1,
        rssKbTotal: 90_000,
        rssKbMaxProcess: 90_000,
        processCount: 1,
        uptimeMinutes: 8,
        heapUsedKb: 40_000,
        hardware: { platform: "darwin", arch: "arm64", logicalCpuCount: 10, totalMemoryGb: 32 },
      },
    ]);
  });

  it("mcp-status lane and plugin merge into the same cli_aux", () => {
    ingestAt(
      0,
      cliSample({ lane: "mcp-status", instanceToken: "aux-mcp-status-01", rssKb: 100_000 }),
    );
    ingestAt(0, cliSample({ lane: "plugin", instanceToken: "aux-plugin-01", rssKb: 150_000 }));

    const samples = tickAt();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      role: "cli_aux",
      processCount: 2,
      rssKbTotal: 250_000,
      rssKbMaxProcess: 150_000,
    });
  });

  it("PRT-008: Remote samples include host machine info and do not enter device-level application total", () => {
    ingestAt(
      0,
      cliSample({
        platform: "linux",
        arch: "x64",
        logicalCpuCount: 4,
        totalMemoryGb: 8,
        instanceToken: "remote-instance-01",
      }),
      "remote",
    );

    expect(tickAt()).toEqual([
      expect.objectContaining({
        role: "cli_chat",
        runtimeSurface: "remote",
        hardware: { platform: "linux", arch: "x64", logicalCpuCount: 4, totalMemoryGb: 8 },
      }),
    ]);
    expect(collectExternalAppResourceTotals(0)).toEqual({
      cpuPercent: 0,
      rssKbTotal: 0,
      processCount: 0,
    });
  });

  it("Processes with the same role running on two different remote machines are split into two samples; RSS is not summed", () => {
    ingestAt(
      0,
      cliSample({
        platform: "linux",
        arch: "x64",
        logicalCpuCount: 4,
        totalMemoryGb: 8,
        instanceToken: "remote-host-a",
        rssKb: 100_000,
      }),
      "remote",
    );
    ingestAt(
      0,
      cliSample({
        platform: "linux",
        arch: "arm64",
        logicalCpuCount: 16,
        totalMemoryGb: 64,
        instanceToken: "remote-host-b",
        rssKb: 900_000,
      }),
      "remote",
    );

    const samples = tickAt();
    expect(samples).toHaveLength(2);
    expect(samples.map((sample) => sample.rssKbTotal)).toEqual([100_000, 900_000]);
    expect(samples.map((sample) => sample.hardware?.logicalCpuCount)).toEqual([4, 16]);
    expect(samples.every((sample) => sample.processCount === 1)).toBe(true);
  });

  it("Feed local samples by role into the external sample entry of device-level application total", () => {
    ingestAt(0, cliSample({ instanceToken: "chat-instance-0001" }));
    ingestAt(
      0,
      cliSample({
        lane: "plugin",
        instanceToken: "aux-instance-0001",
        cpuPercent: 1,
        rssKb: 90_000,
      }),
    );
    tickAt();

    expect(collectExternalAppResourceTotals(0)).toEqual({
      cpuPercent: 6,
      rssKbTotal: 290_000,
      processCount: 2,
    });
  });

  it("Submit at most once every 60 seconds and only with new readings; the same reading is not counted twice", () => {
    ingestAt(0, cliSample());

    expect(tickAt(0)).toHaveLength(1);
    expect(tickAt(10_000)).toHaveLength(0);
    expect(tickAt(CLI_PERIOD_MS)).toHaveLength(0);

    ingestAt(CLI_PERIOD_MS, cliSample({ rssKb: 260_000 }));
    expect(tickAt(CLI_PERIOD_MS + 10_000)[0]).toMatchObject({ rssKbTotal: 260_000 });
  });

  it("Backfill readings that missed the 60-second delivery point to window on graceful exit", () => {
    ingestAt(0, cliSample());
    expect(tickAt(0)).toHaveLength(1);

    ingestAt(30_000, cliSample({ rssKb: 280_000 }));
    expect(tickAt(40_000)).toHaveLength(0);
    expect(flushAt(40_000)[0]).toMatchObject({ role: "cli_chat", rssKbTotal: 280_000 });

    expect(flushAt(41_000)).toEqual([]);
  });

  it("New readings for the same process overwrite old ones; processes not updated for over two sampling cycles are no longer included", () => {
    ingestAt(0, cliSample({ rssKb: 200_000 }));
    expect(tickAt(0)[0]).toMatchObject({ rssKbTotal: 200_000, processCount: 1 });

    ingestAt(CLI_PERIOD_MS, cliSample({ rssKb: 260_000 }));
    expect(tickAt(CLI_PERIOD_MS)[0]).toMatchObject({ rssKbTotal: 260_000, processCount: 1 });

    expect(tickAt(CLI_PERIOD_MS * 3 + 1)).toEqual([]);
    expect(flushAt(CLI_PERIOD_MS * 3 + 1)).toEqual([]);
  });

  it("Invalid samples are discarded at main entry without throwing errors", () => {
    for (const invalid of [
      undefined,
      null,
      "sample",
      {},
      cliSample({ lane: "unknown-lane" }),
      cliSample({ instanceToken: "/Users/somebody/repo" }),
      cliSample({ cpuPercent: Number.NaN }),
      { ...cliSample(), pid: 4_321 },
      { ...cliSample(), workspacePath: "/Users/somebody/repo" },
    ]) {
      expect(() => ingestCliResourceSample(invalid, "local")).not.toThrow();
    }

    expect(tickAt()).toEqual([]);
  });

  it("Samples from legacy CLI aggregate without new fields; missing heap and uptime are omitted from events", () => {
    ingestAt(0, {
      platform: "darwin",
      arch: "arm64",
      logicalCpuCount: 10,
      intervalMs: CLI_PERIOD_MS,
      cpuCores: 0.5,
      cpuPercent: 5,
      rssKb: 200_000,
    });

    expect(tickAt()).toEqual([
      {
        role: "cli_chat",
        runtimeSurface: "local",
        cpuPercent: 5,
        rssKbTotal: 200_000,
        rssKbMaxProcess: 200_000,
        processCount: 1,
        uptimeMinutes: 0,
        hardware: { platform: "darwin", arch: "arm64", logicalCpuCount: 10 },
      },
    ]);
  });

  it("reset discards uncommitted samples", () => {
    ingestAt(0, cliSample());
    cliProcessResourceSampleSource.reset?.();

    expect(tickAt()).toEqual([]);
  });

  it("PRT-033: Local aux is not repeatedly delivered or renewed by new chat readings after updates stop", () => {
    ingestAt(0, cliSample({ lane: "plugin", instanceToken: "aux-stopped-01", rssKb: 250_000 }));
    expect(tickAt(0)).toHaveLength(1);
    for (const now of [60_000, 120_000]) {
      ingestAt(now, cliSample({ instanceToken: "chat-active-01", rssKb: 400_000 }));
      expect(tickAt(now).map((sample) => sample.role)).toEqual(["cli_chat"]);
    }
    expect(tickAt(120_001)).toEqual([]);
    expect(collectExternalAppResourceTotals(120_001)).toMatchObject({
      rssKbTotal: 400_000,
      processCount: 1,
    });
    ingestAt(130_000, cliSample({ instanceToken: "chat-active-01", rssKb: 420_000 }));
    expect(flushAt(130_000).map((sample) => sample.role)).toEqual(["cli_chat"]);
    expect(flushAt(130_001)).toEqual([]);
  });

  it("PRT-033: Two out-of-phase groups each deliver five times across five cycles", () => {
    const delivered: ProcessRoleSample[] = [];
    for (let now = 0; now <= 300_000; now += 10_000) {
      if (now < 300_000 && now % 60_000 === 0)
        ingestAt(now, cliSample({ instanceToken: "chat-active-01" }));
      if (now % 60_000 === 30_000)
        ingestAt(now, cliSample({ instanceToken: "aux-active-01", lane: "plugin" }));
      delivered.push(...tickAt(now));
    }
    expect(delivered.filter((sample) => sample.role === "cli_chat")).toHaveLength(5);
    expect(delivered.filter((sample) => sample.role === "cli_aux")).toHaveLength(5);
  });

  it("PRT-033: An instance in the same group immediately exits device total upon expiration without waiting for the other instance's next delivery", () => {
    ingestAt(0, cliSample({ instanceToken: "chat-stopped-01", rssKb: 250_000 }));
    ingestAt(0, cliSample({ instanceToken: "chat-active-01", rssKb: 400_000 }));
    tickAt(0);
    for (const now of [60_000, 120_000]) {
      ingestAt(now, cliSample({ instanceToken: "chat-active-01", rssKb: 400_000 }));
      tickAt(now);
    }
    expect(collectExternalAppResourceTotals(120_000).processCount).toBe(2);
    tickAt(120_001);
    expect(collectExternalAppResourceTotals(120_001)).toMatchObject({
      rssKbTotal: 400_000,
      processCount: 1,
    });
  });

  it("PRT-033: Retain MCP source budget after saving CLI by instance", () => {
    for (let index = 0; index < 64; index++) {
      ingestAt(0, cliSample({ instanceToken: `chat-instance-${index}` }));
    }
    for (let index = 0; index < 32; index++) {
      recordExternalAppResourceSample({
        sourceKey: `mcp:${index}`,
        runtimeSurface: "local",
        cpuPercent: 0,
        rssKbTotal: 1000,
        processCount: 1,
        receivedAt: 0,
        intervalMs: 300_000,
      });
    }
    expect(collectExternalAppResourceTotals(0).processCount).toBe(96);
  });

  it("PRT-034: Same hardware with different environments and identical instance IDs are still isolated; repeated forwards in the same environment count only once", () => {
    const raw = cliSample({ cpuPercent: 80, rssKb: 500_000 });
    const environmentA = "a".repeat(64);
    const environmentB = "b".repeat(64);
    ingestCliResourceSample(raw, "remote", environmentA);
    ingestCliResourceSample(raw, "remote", environmentB);
    ingestCliResourceSample(raw, "remote", environmentA);
    const samples = tickAt();
    expect(samples).toHaveLength(2);
    expect(samples.map((sample) => sample.environmentKey)).toEqual([environmentA, environmentB]);
    expect(
      samples.every(
        (sample) =>
          sample.cpuPercent === 80 && sample.rssKbTotal === 500_000 && sample.processCount === 1,
      ),
    ).toBe(true);
    expect(collectExternalAppResourceTotals(0).processCount).toBe(0);
  });

  it("已注册进来源注册表", () => {
    expect(PROCESS_RESOURCE_SAMPLE_SOURCES.map((source) => source.id)).toContain(
      cliProcessResourceSampleSource.id,
    );
  });
});
