import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetHostResourceUsage,
  requestHostResourceUsage,
  resolveHostResourceUsageResult,
} from "../src/main/resourceManagerHostSampling.js";

describe("resource manager sampling lifetime", () => {
  afterEach(() => {
    forgetHostResourceUsage("test-host");
    vi.useRealTimers();
  });

  it("Reuse in-flight samples after display timeout; cancel and discard stale results upon stopping", async () => {
    vi.useFakeTimers();
    const postMessage = vi.fn();
    const controller = new AbortController();
    const first = requestHostResourceUsage("test-host", { postMessage }, 900, controller.signal);
    const requestId = postMessage.mock.calls[0][0].requestId;
    await vi.advanceTimersByTimeAsync(900);
    await expect(first).resolves.toEqual([]);
    const second = requestHostResourceUsage("test-host", { postMessage }, 900, controller.signal);
    await vi.advanceTimersByTimeAsync(900);
    await second;
    expect(postMessage).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "resource-usage-snapshot-cancel",
      requestId,
    });
    resolveHostResourceUsageResult("test-host", {
      type: "resource-usage-snapshot-result",
      requestId,
      sampledAt: 1,
      processes: [
        {
          pid: 123,
          name: "stale",
          category: "base",
          groupKey: "cli",
          groupLabel: "cli",
          cpuPercent: 1,
          memoryBytes: 1,
        },
      ],
    });
    const reopened = new AbortController();
    const next = requestHostResourceUsage("test-host", { postMessage }, 900, reopened.signal);
    await vi.advanceTimersByTimeAsync(900);
    await expect(next).resolves.toEqual([]);
    reopened.abort();
  });

  it("Do not send requests for closed sampling sessions", async () => {
    const postMessage = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestHostResourceUsage("test-host", { postMessage }, 900, controller.signal),
    ).resolves.toEqual([]);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
