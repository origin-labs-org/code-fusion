import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureDesktopDeviceMidSync } from "../src/main/desktopDeviceMid.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-device-mid-"));
  tempDirs.push(dir);
  return dir;
}

function readState(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "telemetry-state.json"), "utf-8"));
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("ensureDesktopDeviceMidSync", () => {
  it("复用已存在的 deviceMid，且不改写文件", () => {
    const dir = makeTempDir();
    const stateFile = join(dir, "telemetry-state.json");
    writeFileSync(
      stateFile,
      JSON.stringify({ deviceMid: "existing-uuid", lastDailyActiveDate: "2026-01-01" }),
      "utf-8",
    );
    const mtimeBefore = statSync(stateFile).mtimeMs;

    const result = ensureDesktopDeviceMidSync({
      configDir: dir,
      createId: () => "should-not-be-used",
    });

    expect(result).toBe("existing-uuid");
    const state = readState(dir);
    expect(state.deviceMid).toBe("existing-uuid");
    expect(state.lastDailyActiveDate).toBe("2026-01-01");
    expect(statSync(stateFile).mtimeMs).toBe(mtimeBefore);
  });

  it("缺失时生成 UUID 并落盘", () => {
    const dir = makeTempDir();

    const result = ensureDesktopDeviceMidSync({
      configDir: dir,
      createId: () => "new-uuid",
    });

    expect(result).toBe("new-uuid");
    expect(readState(dir).deviceMid).toBe("new-uuid");
  });

  it("补写 deviceMid 时保留同文件其他字段", () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, "telemetry-state.json"),
      JSON.stringify({ lastDailyActiveDate: "2026-06-23", dailyActiveInFlight: { date: "x", startedAt: 1 } }),
      "utf-8",
    );

    ensureDesktopDeviceMidSync({ configDir: dir, createId: () => "added-uuid" });

    const state = readState(dir);
    expect(state.deviceMid).toBe("added-uuid");
    expect(state.lastDailyActiveDate).toBe("2026-06-23");
    expect(state.dailyActiveInFlight).toEqual({ date: "x", startedAt: 1 });
  });

  it("Read the same device_mid as data warehouse side (telemetryCore)", async () => {
    const dir = makeTempDir();
    const generated = ensureDesktopDeviceMidSync({
      configDir: dir,
      createId: () => "shared-device-uuid",
    });

    const home = makeTempDir();
    const sharedDir = join(home, ".cf", "v2");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(
      join(sharedDir, "telemetry-state.json"),
      JSON.stringify({ deviceMid: generated }),
      "utf-8",
    );

    const { createTelemetryCore } = await import("@origin-ai/cf-services/node");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const service = createTelemetryCore({
      homeDir: home,
      fetchImpl: fetchMock,
      randomUUID: () => "unrelated-event-id",
    }) as {
      reportAppLaunch(input: {
        clientTimezone: string;
        clientLanguage: string;
        screenResolution: string;
      }): Promise<void>;
    };

    await service.reportAppLaunch({
      clientTimezone: "Asia/Shanghai",
      clientLanguage: "zh-CN",
      screenResolution: "3024x1964",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.device_mid).toBe("shared-device-uuid");
  });

  it("Treat corrupted JSON as missing, generate new UUID without throwing", () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, "telemetry-state.json"), "{ not valid json", "utf-8");

    const result = ensureDesktopDeviceMidSync({ configDir: dir, createId: () => "recovered-uuid" });

    expect(result).toBe("recovered-uuid");
    expect(readState(dir).deviceMid).toBe("recovered-uuid");
  });

  it("Do not throw on disk write failure; still return generated UUID", () => {
    const dir = makeTempDir();
    const filePath = join(dir, "blocker");
    writeFileSync(filePath, "x", "utf-8");

    const result = ensureDesktopDeviceMidSync({
      configDir: join(filePath, "nested"),
      createId: () => "fallback-uuid",
    });

    expect(result).toBe("fallback-uuid");
  });
});
