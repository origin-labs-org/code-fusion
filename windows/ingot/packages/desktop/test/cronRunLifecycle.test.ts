import { describe, expect, it, vi } from "vitest";
import {
  recordCronRunOutcomeBestEffort,
  startManualClaimHeartbeat,
  settleCronRunTerminalOutcome,
  settleManualDispatchFailureBestEffort,
} from "../src/host/cronRunLifecycle.js";

function createRepo() {
  return {
    ensureRunClaimed: vi.fn(async () => {}),
    markRunOutcome: vi.fn(async () => {}),
    markRunDispatch: vi.fn(async () => {}),
    touchManualClaim: vi.fn(async () => {}),
    releaseManualClaim: vi.fn(async () => {}),
  };
}

const identity = {
  automationId: "automation-1",
  runId: "automation-1:manual:1",
  workspaceKey: "ssh://host/workspace",
  scheduledAt: 1,
  trigger: "manual" as const,
};

describe("cron run lifecycle", () => {
  it("Only write back outcome during running/queued phase without releasing manual claim", async () => {
    const repo = createRepo();

    await recordCronRunOutcomeBestEffort({
      ...identity,
      repo,
      outcome: "running",
      logWarn: vi.fn(),
    });

    expect(repo.markRunOutcome).toHaveBeenCalledWith(identity.runId, "running", undefined);
    expect(repo.releaseManualClaim).not.toHaveBeenCalled();
  });

  it("Release claim by workspaceKey only after manual turn reaches terminal state", async () => {
    const repo = createRepo();

    await settleCronRunTerminalOutcome({
      ...identity,
      repo,
      outcome: "succeeded",
      logWarn: vi.fn(),
    });

    expect(repo.markRunOutcome).toHaveBeenCalledWith(identity.runId, "succeeded", undefined);
    expect(repo.releaseManualClaim).toHaveBeenCalledWith(
      identity.automationId,
      identity.workspaceKey,
    );
    expect(repo.markRunOutcome.mock.invocationCallOrder[0]).toBeLessThan(
      repo.releaseManualClaim.mock.invocationCallOrder[0]!,
    );
  });

  it("Scheduled turn does not release manual claim, and release failure does not overwrite terminal state", async () => {
    const repo = createRepo();
    await settleCronRunTerminalOutcome({
      ...identity,
      trigger: "schedule",
      repo,
      outcome: "failed",
      error: "turn failed",
      logWarn: vi.fn(),
    });
    expect(repo.releaseManualClaim).not.toHaveBeenCalled();

    repo.releaseManualClaim.mockRejectedValueOnce(new Error("sqlite busy"));
    const logWarn = vi.fn();
    await expect(
      settleCronRunTerminalOutcome({
        ...identity,
        repo,
        outcome: "stopped",
        logWarn,
      }),
    ).resolves.toBeUndefined();
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining("释放 manual automation claim 失败"),
      expect.any(Error),
    );
  });

  it("Cleanup exceptions on dispatch failure are not thrown, allowing caller to retain original dispatch error", async () => {
    const repo = createRepo();
    repo.markRunDispatch.mockRejectedValueOnce(new Error("write failed"));
    repo.releaseManualClaim.mockRejectedValueOnce(new Error("release failed"));
    const logWarn = vi.fn();

    await expect(
      settleManualDispatchFailureBestEffort({
        ...identity,
        repo,
        dispatchError: new Error("original dispatch failed"),
        logWarn,
      }),
    ).resolves.toBeUndefined();

    expect(repo.markRunDispatch).toHaveBeenCalledWith({
      runId: identity.runId,
      dispatchStatus: "failed_to_dispatch",
      error: "original dispatch failed",
    });
    expect(logWarn).toHaveBeenCalledTimes(2);
  });

  it("Manual run renews lease during queue/running, stopping after dispose", async () => {
    vi.useFakeTimers();
    const repo = createRepo();
    try {
      const heartbeat = startManualClaimHeartbeat({
        ...identity,
        repo,
        logWarn: vi.fn(),
        intervalMs: 100,
      });

      await vi.advanceTimersByTimeAsync(250);
      expect(repo.touchManualClaim).toHaveBeenCalledTimes(2);
      expect(repo.touchManualClaim).toHaveBeenCalledWith(
        identity.automationId,
        identity.workspaceKey,
      );

      heartbeat.dispose();
      await vi.advanceTimersByTimeAsync(200);
      expect(repo.touchManualClaim).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
