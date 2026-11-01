import { beforeEach, describe, expect, it } from "vitest";
import {
  collectExternalAppResourceTotals,
  EXTERNAL_APP_RESOURCE_SAMPLE_DEFAULT_INTERVAL_MS,
  PROCESS_RESOURCE_MAX_EXTERNAL_SAMPLE_SOURCES,
  recordExternalAppResourceSample,
  resetExternalAppResourceSamples,
} from "../src/main/processResourceExternalAppSamples.js";

const NOW = 1_700_000_000_000;

function cliSample(overrides: { receivedAt?: number; rssKbTotal?: number } = {}) {
  return {
    sourceKey: "cli_chat",
    runtimeSurface: "local" as const,
    cpuPercent: 20,
    rssKbTotal: overrides.rssKbTotal ?? 500_000,
    processCount: 2,
    intervalMs: 60_000,
    receivedAt: overrides.receivedAt ?? NOW,
  };
}

describe("processResourceExternalAppSamples", () => {
  beforeEach(() => {
    resetExternalAppResourceSamples();
  });

  it("Latest sample counted toward total; new samples from the same source overwrite old values", () => {
    recordExternalAppResourceSample(cliSample());
    expect(collectExternalAppResourceTotals(NOW)).toEqual({
      cpuPercent: 20,
      rssKbTotal: 500_000,
      processCount: 2,
    });

    recordExternalAppResourceSample(cliSample({ receivedAt: NOW + 60_000, rssKbTotal: 700_000 }));
    expect(collectExternalAppResourceTotals(NOW + 60_000).rssKbTotal).toBe(700_000);
  });

  it("Multiple sources accumulated separately", () => {
    recordExternalAppResourceSample(cliSample());
    recordExternalAppResourceSample({
      sourceKey: "mcp:filesystem",
      runtimeSurface: "local",
      cpuPercent: 5,
      rssKbTotal: 100_000,
      processCount: 3,
      intervalMs: 300_000,
      receivedAt: NOW,
    });

    expect(collectExternalAppResourceTotals(NOW)).toEqual({
      cpuPercent: 25,
      rssKbTotal: 600_000,
      processCount: 5,
    });
  });

  it("Samples not updated for over two sampling cycles are no longer included", () => {
    recordExternalAppResourceSample(cliSample());

    expect(collectExternalAppResourceTotals(NOW + 120_000).rssKbTotal).toBe(500_000);
    expect(collectExternalAppResourceTotals(NOW + 120_001).rssKbTotal).toBe(0);
    expect(collectExternalAppResourceTotals(NOW + 120_001).processCount).toBe(0);
  });

  it("Expiration criteria are calculated based on the source's own sampling cycle; 5-minute sampled MCP will not be falsely expired by CLI cycle", () => {
    recordExternalAppResourceSample({
      sourceKey: "mcp:filesystem",
      runtimeSurface: "local",
      cpuPercent: 5,
      rssKbTotal: 100_000,
      processCount: 1,
      intervalMs: 300_000,
      receivedAt: NOW,
    });

    expect(collectExternalAppResourceTotals(NOW + 599_000).rssKbTotal).toBe(100_000);
    expect(collectExternalAppResourceTotals(NOW + 600_001).rssKbTotal).toBe(0);
  });

  it("Determine expiration by default 60-second cycle when intervalMs is missing", () => {
    recordExternalAppResourceSample({
      sourceKey: "cli_aux",
      runtimeSurface: "local",
      cpuPercent: 1,
      rssKbTotal: 10_000,
      processCount: 1,
      receivedAt: NOW,
    });

    const ttlMs = EXTERNAL_APP_RESOURCE_SAMPLE_DEFAULT_INTERVAL_MS * 2;
    expect(collectExternalAppResourceTotals(NOW + ttlMs).rssKbTotal).toBe(10_000);
    expect(collectExternalAppResourceTotals(NOW + ttlMs + 1).rssKbTotal).toBe(0);
  });

  it("Remote processes are not counted in device-level application total", () => {
    recordExternalAppResourceSample({ ...cliSample(), runtimeSurface: "remote" });
    expect(collectExternalAppResourceTotals(NOW)).toEqual({
      cpuPercent: 0,
      rssKbTotal: 0,
      processCount: 0,
    });
  });

  it("Samples with invalid values are directly discarded without polluting total", () => {
    recordExternalAppResourceSample({ ...cliSample(), rssKbTotal: Number.NaN });
    recordExternalAppResourceSample({ ...cliSample(), sourceKey: "cli_aux", cpuPercent: -1 });
    expect(collectExternalAppResourceTotals(NOW)).toEqual({
      cpuPercent: 0,
      rssKbTotal: 0,
      processCount: 0,
    });
  });

  it("Source entries are bounded: new sources exceeding limit are discarded (performance red line 5: bounded memory)", () => {
    for (let index = 0; index < PROCESS_RESOURCE_MAX_EXTERNAL_SAMPLE_SOURCES; index += 1) {
      recordExternalAppResourceSample({ ...cliSample(), sourceKey: `mcp:${index}`, rssKbTotal: 1 });
    }
    expect(collectExternalAppResourceTotals(NOW).rssKbTotal).toBe(
      PROCESS_RESOURCE_MAX_EXTERNAL_SAMPLE_SOURCES,
    );

    recordExternalAppResourceSample({ ...cliSample(), sourceKey: "mcp:overflow", rssKbTotal: 1 });
    expect(collectExternalAppResourceTotals(NOW).rssKbTotal).toBe(
      PROCESS_RESOURCE_MAX_EXTERNAL_SAMPLE_SOURCES,
    );
  });

  it("reset clears all sources to prevent data crossover across sampling sessions", () => {
    recordExternalAppResourceSample(cliSample());
    resetExternalAppResourceSamples();
    expect(collectExternalAppResourceTotals(NOW).rssKbTotal).toBe(0);
  });
});
