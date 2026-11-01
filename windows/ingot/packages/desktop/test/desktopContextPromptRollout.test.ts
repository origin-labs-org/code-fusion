import { describe, expect, it, vi } from "vitest";
import {
  createDesktopContextPromptRollout,
  resolveDesktopContextPromptConfig,
} from "../src/main/desktopContextPromptRollout.js";

function config(enabled: boolean, configVersion = "desktop-sp-v1") {
  return {
    code: 0,
    data: {
      configs: {
        desktopContextPrompt: {
          enabled,
          config_version: configVersion,
        },
      },
    },
  };
}

describe("desktopContextPromptRollout", () => {
  it("Only accept Desktop SP configuration where code=0 and enabled is boolean", () => {
    expect(resolveDesktopContextPromptConfig(config(true))).toEqual({
      enabled: true,
      configVersion: "desktop-sp-v1",
    });
    expect(resolveDesktopContextPromptConfig(config(false, "v2"))).toEqual({
      enabled: false,
      configVersion: "v2",
    });
    expect(resolveDesktopContextPromptConfig({ code: 500, data: config(true).data })).toBeNull();
    expect(
      resolveDesktopContextPromptConfig({ success: false, data: config(true).data }),
    ).toBeNull();
    expect(
      resolveDesktopContextPromptConfig({ code: 0, data: { configs: {} } }),
    ).toEqual({ enabled: false });
    expect(
      resolveDesktopContextPromptConfig({
        code: 0,
        data: { configs: { desktopContextPrompt: { enabled: "true" } } },
      }),
    ).toBeNull();
  });

  it("Overwrite old cache and treat as disabled when server responds successfully without configuration", async () => {
    vi.useFakeTimers();
    try {
      const fetchConfig = vi
        .fn<(_: AbortSignal) => Promise<unknown>>()
        .mockResolvedValueOnce(config(true))
        .mockResolvedValueOnce({ code: 0, data: { configs: {} } });
      const rollout = createDesktopContextPromptRollout({
        fetchConfig,
        logger: { warn: vi.fn() },
        cacheTtlMs: 1,
      });

      await expect(rollout.refresh()).resolves.toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });
      await vi.advanceTimersByTimeAsync(1);
      await expect(rollout.refresh()).resolves.toEqual({ enabled: false });
      expect(rollout.getSnapshot()).toEqual({ enabled: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("Default to disabled on first request failure without blocking result reads", async () => {
    const rollout = createDesktopContextPromptRollout({
      fetchConfig: vi.fn(async () => {
        throw new Error("offline");
      }),
      logger: { warn: vi.fn() },
    });

    await expect(rollout.refresh()).resolves.toEqual({ enabled: false });
    expect(rollout.getSnapshot()).toEqual({ enabled: false });
  });

  it("Reuse latest successful result when request exceeds 3 seconds", async () => {
    vi.useFakeTimers();
    try {
      let resolveRequest!: (value: unknown) => void;
      const fetchConfig = vi
        .fn<(_: AbortSignal) => Promise<unknown>>()
        .mockResolvedValueOnce(config(true))
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveRequest = resolve;
            }),
        );
      const rollout = createDesktopContextPromptRollout({
        fetchConfig,
        logger: { warn: vi.fn() },
        cacheTtlMs: 1,
      });

      await expect(rollout.refresh()).resolves.toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });
      await vi.advanceTimersByTimeAsync(1);
      const pending = rollout.refresh();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });

      // A late response from the timed-out request must not overwrite the cached decision.
      resolveRequest(config(false, "late"));
      await Promise.resolve();
      expect(rollout.getSnapshot()).toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("Reuse successful results directly within 1-hour TTL, re-requesting only after expiration", async () => {
    vi.useFakeTimers();
    try {
      const fetchConfig = vi
        .fn<(_: AbortSignal) => Promise<unknown>>()
        .mockResolvedValueOnce(config(true))
        .mockResolvedValueOnce(config(false, "desktop-sp-v2"));
      const rollout = createDesktopContextPromptRollout({
        fetchConfig,
        logger: { warn: vi.fn() },
      });

      await expect(rollout.refresh()).resolves.toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });
      await expect(rollout.refresh()).resolves.toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });
      expect(fetchConfig).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
      await expect(rollout.refresh()).resolves.toEqual({
        enabled: false,
        configVersion: "desktop-sp-v2",
      });
      expect(fetchConfig).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Reuse the same in-flight request to avoid duplicate config endpoint calls", async () => {
    let resolveRequest!: (value: unknown) => void;
    const fetchConfig = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const rollout = createDesktopContextPromptRollout({
      fetchConfig,
      logger: { warn: vi.fn() },
    });

    const first = rollout.refresh();
    const second = rollout.refresh();
    expect(fetchConfig).toHaveBeenCalledOnce();
    resolveRequest(config(true));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { enabled: true, configVersion: "desktop-sp-v1" },
      { enabled: true, configVersion: "desktop-sp-v1" },
    ]);
  });

  it("awaitFirstDecision 在超时窗口内拿到服务端真值", async () => {
    vi.useFakeTimers();
    try {
      const fetchConfig = vi
        .fn<(_: AbortSignal) => Promise<unknown>>()
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve(config(true)), 100);
            }),
        );
      const rollout = createDesktopContextPromptRollout({
        fetchConfig,
        logger: { warn: vi.fn() },
      });

      const pending = rollout.awaitFirstDecision(2_000);
      await vi.advanceTimersByTimeAsync(100);
      await expect(pending).resolves.toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("awaitFirstDecision falls back to current snapshot on timeout, ensuring consistent concurrent calls without blocking background request updates", async () => {
    vi.useFakeTimers();
    try {
      const fetchConfig = vi
        .fn<(_: AbortSignal) => Promise<unknown>>()
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve(config(true)), 200);
            }),
        );
      const rollout = createDesktopContextPromptRollout({
        fetchConfig,
        logger: { warn: vi.fn() },
      });

      const first = rollout.awaitFirstDecision(50);
      const second = rollout.awaitFirstDecision(50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(first).resolves.toEqual({ enabled: false });
      await expect(second).resolves.toEqual({ enabled: false });

      await vi.advanceTimersByTimeAsync(150);
      expect(rollout.getSnapshot()).toEqual({
        enabled: true,
        configVersion: "desktop-sp-v1",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("Bounded wait before first Host spawn: synchronously read snapshot as true value after slow successful response with enabled=true", async () => {
    vi.useFakeTimers();
    try {
      const fetchConfig = vi
        .fn<(_: AbortSignal) => Promise<unknown>>()
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve(config(true)), 100);
            }),
        );
      const rollout = createDesktopContextPromptRollout({
        fetchConfig,
        logger: { warn: vi.fn() },
      });

      void rollout.refresh();
      const decision = rollout.awaitFirstDecision(2_000);
      await vi.advanceTimersByTimeAsync(100);
      await decision;
      expect(rollout.getSnapshot().enabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
