import { describe, expect, it, vi } from "vitest";
import {
  createWebRemoteControlBridgeRecoveryRunner,
  getWebRemoteControlBridgeRecoveryRetryDelay,
} from "#src/web-remote-control/index.js";

describe("web remote control bridge recovery", () => {
  it("uses bounded backoff for bridge rebuild failures", () => {
    expect([0, 1, 2, 3].map(getWebRemoteControlBridgeRecoveryRetryDelay)).toEqual([
      1_000,
      2_000,
      5_000,
      null,
    ]);
  });

  it("Reconnect成功WaitingOldOffline bootstrap Completed后补One次恢复，并合并同时到达的成功通知", async () => {
    let release!: () => void;
    const oldBootstrap = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recover = vi.fn(async (reason: string) => {
      if (reason === "source-disconnected") await oldBootstrap;
    });
    const run = createWebRemoteControlBridgeRecoveryRunner(recover);
    const first = run("source-disconnected");
    await Promise.resolve();
    const reconnected = run("workspace-reconnected", () => true);
    const duplicate = run("workspace-reconnected", () => true);
    expect(recover).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, reconnected, duplicate]);
    expect(recover.mock.calls.map(([reason]) => reason)).toEqual([
      "source-disconnected",
      "workspace-reconnected",
    ]);
  });

  it("Waiting恢复期间切换 workspace 后丢弃OldProject的Reconnect通知", async () => {
    let release!: () => void;
    const oldBootstrap = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recover = vi.fn(async () => oldBootstrap);
    const run = createWebRemoteControlBridgeRecoveryRunner(recover);
    let workspace = "A";
    const first = run("source-disconnected");
    const reconnected = run("workspace-reconnected", () => workspace === "A");
    workspace = "B";
    release();
    await Promise.all([first, reconnected]);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("Lifecycle重复唤醒SharedCurrent恢复，Failed后仍可显式Retry", async () => {
    const recover = vi
      .fn()
      .mockRejectedValueOnce(new Error("bootstrap failed"))
      .mockResolvedValue(undefined);
    const run = createWebRemoteControlBridgeRecoveryRunner(recover);
    const results = await Promise.allSettled([run("online"), run("visible")]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(recover).toHaveBeenCalledTimes(1);
    await run("retry");
    expect(recover).toHaveBeenCalledTimes(2);
  });
});
