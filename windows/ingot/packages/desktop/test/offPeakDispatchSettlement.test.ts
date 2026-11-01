import { describe, expect, it, vi } from "vitest";
import {
  OFF_PEAK_DISPATCH_RETRY_BASE_MS,
  settleOffPeakDispatchResult,
} from "../src/scheduler/offPeakDispatchSettlement.js";

const NOW = 1_700_000_000_000;

function makeDeps() {
  const repo = {
    markRunning: vi.fn(async () => ({ status: "running" })),
    markTerminal: vi.fn(async () => ({ status: "failed" })),
    releaseClaim: vi.fn(async () => undefined),
  };
  const retryAt = new Map<string, number>();
  const retryAttempts = new Map<string, number>();
  const log = vi.fn();
  return {
    deps: {
      repo: repo as never,
      retryAt,
      retryAttempts,
      now: () => NOW,
      log,
    },
    log,
    repo,
    retryAt,
    retryAttempts,
  };
}

describe("settleOffPeakDispatchResult", () => {
  it("Late dispatch ack cannot overwrite waiting-for-new-ticket state when lifecycle has been admitted by Host", async () => {
    const state = makeDeps();
    await settleOffPeakDispatchResult(state.deps, {
      type: "offpeak-dispatch-result",
      offPeakTaskId: "task",
      ok: true,
      lifecycleManaged: true,
    });
    expect(state.repo.markRunning).not.toHaveBeenCalled();
    expect(state.repo.releaseClaim).not.toHaveBeenCalled();
  });
  it("permanent error transitions directly to failed and clears backoff", async () => {
    const state = makeDeps();
    state.retryAt.set("task-1", NOW + 10_000);
    state.retryAttempts.set("task-1", 3);

    await settleOffPeakDispatchResult(state.deps, {
      type: "offpeak-dispatch-result",
      offPeakTaskId: "task-1",
      ok: false,
      error: "workspace model unavailable",
      failureKind: "permanent",
    });

    expect(state.repo.markTerminal).toHaveBeenCalledWith("task-1", {
      status: "failed",
      endedAt: NOW,
      failureReason: "workspace model unavailable",
      dispatchError: "workspace model unavailable",
    });
    expect(state.repo.releaseClaim).not.toHaveBeenCalled();
    expect(state.retryAt.has("task-1")).toBe(false);
    expect(state.retryAttempts.has("task-1")).toBe(false);
  });

  it("transient error remains queued and backs off exponentially", async () => {
    const state = makeDeps();

    await settleOffPeakDispatchResult(state.deps, {
      type: "offpeak-dispatch-result",
      offPeakTaskId: "task-2",
      ok: false,
      error: "agent unavailable",
      failureKind: "transient",
    });

    expect(state.repo.markTerminal).not.toHaveBeenCalled();
    expect(state.repo.releaseClaim).toHaveBeenCalledWith("task-2", {
      error: "agent unavailable",
      now: NOW,
    });
    expect(state.retryAttempts.get("task-2")).toBe(1);
    expect(state.retryAt.get("task-2")).toBe(NOW + OFF_PEAK_DISPATCH_RETRY_BASE_MS);
  });

  it("Successful dispatch enters running and clears old backoff", async () => {
    const state = makeDeps();
    state.retryAt.set("task-3", NOW + 10_000);
    state.retryAttempts.set("task-3", 2);

    await settleOffPeakDispatchResult(state.deps, {
      type: "offpeak-dispatch-result",
      offPeakTaskId: "task-3",
      ok: true,
      conversationId: "conversation-3",
      sessionId: "session-3",
    });

    expect(state.repo.markRunning).toHaveBeenCalledWith("task-3", {
      startedAt: NOW,
      conversationId: "conversation-3",
      sessionId: "session-3",
    });
    expect(state.retryAt.has("task-3")).toBe(false);
    expect(state.retryAttempts.has("task-3")).toBe(false);
  });
});
