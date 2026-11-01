import { describe, expect, it } from "vitest";
import { PROCESS_RESOURCE_SAMPLE_SOURCES } from "@desktop/main/processResourceSampleSourceRegistry";
import {
  ingestHostSelfResourceSample,
  ingestSchedulerSelfResourceSample,
  selfHeapProcessResourceSampleSource,
} from "@desktop/main/processResourceSelfHeapSource";
import type { ProcessResourceRole } from "@origin-ai/cf-shared";

interface Collected {
  heapSamples: Array<[ProcessResourceRole, number]>;
  roleSamples: number;
}

function runSample(): Collected {
  const collected: Collected = { heapSamples: [], roleSamples: 0 };
  selfHeapProcessResourceSampleSource.sample?.({
    now: 0,
    addRoleSample: () => {
      collected.roleSamples += 1;
    },
    addRoleHeapSample: (role, heapUsedKb) => collected.heapSamples.push([role, heapUsedKb]),
    addAppProcessTotals: () => {},
  });
  return collected;
}

const sample = (heapUsedKb: number) => ({ cpuPercent: 1.5, rssKb: 380_000, heapUsedKb });

describe("processResourceSelfHeapSource", () => {
  it.each([
    [900_000, 100_000],
    [100_000, 900_000],
  ])("PRT-035 Multi-Host heap aggregates by maximum, independent of arrival order %j", (first, second) => {
    selfHeapProcessResourceSampleSource.reset?.();
    ingestHostSelfResourceSample(sample(first));
    ingestHostSelfResourceSample(sample(second));
    expect(runSample().heapSamples).toEqual([["host", 900_000]]);
    expect(runSample().heapSamples).toEqual([]);
  });

  it("Host and scheduler samples each contribute only heap, without opening additional role samples", () => {
    ingestHostSelfResourceSample(sample(92_160));
    ingestSchedulerSelfResourceSample(sample(24_576));

    const collected = runSample();

    expect(collected.heapSamples).toEqual([
      ["host", 92_160],
      ["scheduler", 24_576],
    ]);
    expect(collected.roleSamples).toBe(0);
  });

  it("Samples with missing fields, type errors, or non-objects are discarded at the main entry without throwing errors", () => {
    for (const invalid of [
      undefined,
      null,
      "sample",
      {},
      { cpuPercent: 1, rssKb: 100 },
      { cpuPercent: 1, rssKb: 100, heapUsedKb: "512" },
      { cpuPercent: 1, rssKb: 100, heapUsedKb: Number.NaN },
      { cpuPercent: 1, rssKb: 100, heapUsedKb: -1 },
      { cpuPercent: 1, rssKb: 100, heapUsedKb: 512, pid: 4_321 },
    ]) {
      expect(() => ingestHostSelfResourceSample(invalid)).not.toThrow();
      expect(() => ingestSchedulerSelfResourceSample(invalid)).not.toThrow();
    }

    expect(runSample().heapSamples).toEqual([]);
  });

  it("reset 丢弃尚未交付的样本", () => {
    ingestHostSelfResourceSample(sample(92_160));
    selfHeapProcessResourceSampleSource.reset?.();

    expect(runSample().heapSamples).toEqual([]);
  });

  it("已注册进来源注册表", () => {
    expect(PROCESS_RESOURCE_SAMPLE_SOURCES.map((source) => source.id)).toContain(
      selfHeapProcessResourceSampleSource.id,
    );
  });

  it("Pending delivery samples are already cleared when delivery throws an error; the next tick does not redeliver old values", () => {
    ingestHostSelfResourceSample(sample(92_160));

    expect(() =>
      selfHeapProcessResourceSampleSource.sample?.({
        now: 0,
        addRoleSample: () => {},
        addRoleHeapSample: () => {
          throw new Error("aggregator failed");
        },
        addAppProcessTotals: () => {},
      }),
    ).toThrow();

    expect(runSample().heapSamples).toEqual([]);
  });
});
