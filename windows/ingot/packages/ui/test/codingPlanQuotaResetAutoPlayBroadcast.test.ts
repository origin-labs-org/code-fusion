// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BroadcastMessage, IBroadcastService, IUsageStatsService } from "@origin-ai/cf-services";
import type { CodingPlanResetStatusSnapshot, CfAccountAccess } from "@origin-ai/cf-shared";
import { StoreContext } from "@/store/StoreProvider.js";

const mocks = vi.hoisted(() => ({
  services: null as { usageStatsService: IUsageStatsService } | null,
  toast: vi.fn(),
}));

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useOptionalBaseWorkspaceServices: () => mocks.services,
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: { formatMessage: ({ id }: { id: string }) => id },
    locale: "zh-CN",
  }),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: mocks.toast,
}));

import { useCodingPlanQuotaResetUi } from "@/hooks/useCodingPlanQuotaResetUi.js";
import { coordinateCodingPlanQuotaResetAutoPlay } from "@/chat-input-toolbar/codingPlanQuotaResetAutoPlay.js";
import { pruneCodingPlanQuotaResetConfettiArms } from "@/lib/codingPlanQuotaResetUi.js";
import { CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL } from "@/store/codingPlanQuotaResetState.js";
import { createCfStore } from "@/store/index.js";
import type { CfStore } from "@/store/index.js";

const TEST_ACCOUNT_ACCESS: CfAccountAccess = {
  type: "zhipu-account",
  family: "bigmodel",
  planKind: "individual-coding-plan",
};

type BroadcastListener = (message: BroadcastMessage) => void;

function createBroadcastHarness({
  claimStatus = "acquired",
}: {
  claimStatus?: "acquired" | "busy" | "committed";
} = {}) {
  const listeners = new Set<BroadcastListener>();
  const send = vi.fn(async () => undefined);
  const acquireClaim = vi.fn(async (key: string) =>
    claimStatus === "acquired"
      ? { status: "acquired" as const, lease: { key, token: "claim-token" } }
      : claimStatus === "busy"
        ? { status: "busy" as const, retryAfterMs: 100 }
        : { status: "committed" as const },
  );
  const commitClaim = vi.fn(async () => undefined);
  const releaseClaim = vi.fn(async () => undefined);
  const tryClaim = vi.fn(async () => false);
  const service = {
    send,
    acquireClaim,
    commitClaim,
    releaseClaim,
    tryClaim,
    onMessage: (listener: BroadcastListener) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as IBroadcastService;
  return {
    service,
    send,
    acquireClaim,
    commitClaim,
    releaseClaim,
    tryClaim,
    emit: (message: BroadcastMessage) => {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

function automaticCompletedEntry(completedAt: number, observedAt: number | null) {
  return {
    status: "completed" as const,
    opportunityCount: 0,
    opportunityExpiresAt: null,
    startedAt: null,
    completedAt,
    observedAt,
    quotaOverridePending: true,
    nextResetAt: completedAt + 5 * 60 * 60 * 1_000,
    idempotencyKey: null,
    error: null,
  };
}

function manualCompletedEntry(completedAt: number, startedAt: number) {
  return { ...automaticCompletedEntry(completedAt, null), startedAt };
}

function status(
  overrides: Partial<CodingPlanResetStatusSnapshot> = {},
): CodingPlanResetStatusSnapshot {
  return {
    availableFiveHourResets: [],
    availableWeekResets: [],
    latestFiveHourResetHistory: null,
    latestWeekResetHistory: null,
    hasUnreadHistory: false,
    ...overrides,
  };
}

function createUsageStatsService(overrides: Partial<IUsageStatsService> = {}): IUsageStatsService {
  return {
    getAppUsageSnapshot: vi.fn(),
    getCodingPlanUsageSnapshot: vi.fn(),
    getCodingPlanResetStatus: vi.fn(async () => status()),
    requestCodingPlanResetOpportunity: vi.fn(async () => ({
      granted: false,
      nextTryAt: null,
    })),
    useCodingPlanReset: vi.fn(async () => ({ used: true as const })),
    markCodingPlanResetHistoryRead: vi.fn(async () => undefined),
    getSnapshot: vi.fn(),
    getEntitlementSnapshot: vi.fn(),
    ...overrides,
  };
}

function wrapperFor(store: CfStore) {
  return ({ children }: { children: ReactNode }) =>
    createElement(StoreContext.Provider, { value: store }, children);
}

describe("coding plan quota reset autoplay broadcast (store)", () => {
  it("status write only records observation; non-Composer entry points do not claim playback eligibility", () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);

    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry(
          "src",
          "FIVE_HOUR",
          automaticCompletedEntry(1_000, 2_000),
          0,
        );
    });

    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src).toBeUndefined();
    expect(harness.acquireClaim).not.toHaveBeenCalled();
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("Composer reservation winner 在 commit 前不写 played、不广播", async () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry(
          "src",
          "FIVE_HOUR",
          automaticCompletedEntry(1_000, 2_000),
          0,
        );
    });

    const attempt = await store
      .getState()
      .reserveCodingPlanQuotaResetAutoPlay("src", "FIVE_HOUR", 1_000);

    expect(attempt).toEqual({
      status: "reserved",
      reservation: expect.objectContaining({
        sourceKey: "src",
        resetType: "FIVE_HOUR",
        completedAt: 1_000,
      }),
    });
    expect(harness.acquireClaim).toHaveBeenCalledWith(
      "coding-plan-reset-autoplay:src:FIVE_HOUR:1000",
    );
    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src).toBeUndefined();
    expect(harness.send).not.toHaveBeenCalled();

    if (attempt.status !== "reserved") {
      throw new Error("expected reservation");
    }
    expect(store.getState().commitCodingPlanQuotaResetAutoPlay(attempt.reservation)).toBe(true);
    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src?.fiveHour).toBe(1_000);
    expect(harness.commitClaim).toHaveBeenCalledWith(attempt.reservation.lease);
    expect(harness.send).toHaveBeenCalledWith({
      channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
      payload: { sourceKey: "src", resetType: "FIVE_HOUR", completedAt: 1_000 },
    });
    expect(store.getState().codingPlanQuotaResetUiBySource.src?.fiveHour?.observedAt).toBe(2_000);
  });

  it("Composer acquire busy retains observed_at without mistaking occupancy for played", async () => {
    const harness = createBroadcastHarness({ claimStatus: "busy" });
    const store = createCfStore(harness.service);
    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry("src", "WEEK", automaticCompletedEntry(3_000, 4_000), 0);
    });

    await expect(
      store.getState().reserveCodingPlanQuotaResetAutoPlay("src", "WEEK", 3_000),
    ).resolves.toEqual({ status: "retry", retryAfterMs: 100 });

    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src).toBeUndefined();
    expect(store.getState().codingPlanQuotaResetUiBySource.src?.week?.observedAt).toBe(4_000);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("Do not write played when reservation is released; subsequent windows can still contend", async () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry("src", "WEEK", automaticCompletedEntry(3_000, 4_000), 0);
    });

    const attempt = await store
      .getState()
      .reserveCodingPlanQuotaResetAutoPlay("src", "WEEK", 3_000);
    if (attempt.status !== "reserved") {
      throw new Error("expected reservation");
    }
    await store.getState().releaseCodingPlanQuotaResetAutoPlay(attempt.reservation);

    expect(harness.releaseClaim).toHaveBeenCalledWith(attempt.reservation.lease);
    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src).toBeUndefined();
    expect(store.getState().codingPlanQuotaResetUiBySource.src?.week?.observedAt).toBe(4_000);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("Manual completion will not be claimed as auto-playback", async () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry("src", "FIVE_HOUR", manualCompletedEntry(1_000, 900), 0);
    });

    await expect(
      store.getState().reserveCodingPlanQuotaResetAutoPlay("src", "FIVE_HOUR", 1_000),
    ).resolves.toEqual({ status: "blocked" });
    expect(harness.acquireClaim).not.toHaveBeenCalled();
  });

  it("Suppress auto-completion waiting for claim with same used_at in this window upon receiving cross-window broadcast", () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);

    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry(
          "src",
          "FIVE_HOUR",
          automaticCompletedEntry(1_000, Date.now()),
          0,
        );
      harness.emit({
        channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
        payload: {
          sourceKey: "src",
          resetType: "FIVE_HOUR",
          completedAt: 1_000,
        },
        sourceWindowId: 7,
      });
    });

    expect(store.getState().codingPlanQuotaResetUiBySource.src?.fiveHour?.observedAt).toBeNull();
    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src?.fiveHour).toBe(1_000);
  });

  it("Local echo (no sourceWindowId) does not suppress winner playback", async () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry(
          "src",
          "FIVE_HOUR",
          automaticCompletedEntry(1_000, Date.now()),
          0,
        );
    });
    const attempt = await store
      .getState()
      .reserveCodingPlanQuotaResetAutoPlay("src", "FIVE_HOUR", 1_000);
    if (attempt.status !== "reserved") {
      throw new Error("expected reservation");
    }
    store.getState().commitCodingPlanQuotaResetAutoPlay(attempt.reservation);

    act(() => {
      harness.emit({
        channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
        payload: {
          sourceKey: "src",
          resetType: "FIVE_HOUR",
          completedAt: 1_000,
        },
      });
    });

    expect(
      store.getState().codingPlanQuotaResetUiBySource.src?.fiveHour?.observedAt,
    ).not.toBeNull();
  });

  it("Late arrival of old broadcast will not roll back newer played records", () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    act(() => {
      store.setState({
        codingPlanQuotaResetAutoPlayedBySource: {
          src: { fiveHour: 2_000, week: null },
        },
      });
      harness.emit({
        channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
        payload: {
          sourceKey: "src",
          resetType: "FIVE_HOUR",
          completedAt: 1_000,
        },
        sourceWindowId: 7,
      });
    });

    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src?.fiveHour).toBe(2_000);
  });

  it("Broadcasts with mismatched used_at only merge played records without rewriting entry", () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    act(() => {
      store
        .getState()
        .setCodingPlanQuotaResetUiEntry(
          "src",
          "WEEK",
          automaticCompletedEntry(5_000, Date.now()),
          0,
        );
      harness.emit({
        channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
        payload: { sourceKey: "src", resetType: "WEEK", completedAt: 9_999 },
        sourceWindowId: 7,
      });
    });

    const entry = store.getState().codingPlanQuotaResetUiBySource.src?.week;
    expect(entry?.completedAt).toBe(5_000);
    expect(entry?.observedAt).not.toBeNull();
    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource.src?.week).toBe(9_999);
  });

  it("非法 payload 的广播被忽略", () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);

    expect(() => {
      act(() => {
        harness.emit({
          channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
          payload: { sourceKey: "src" },
          sourceWindowId: 7,
        });
        harness.emit({
          channel: CODING_PLAN_QUOTA_RESET_AUTO_PLAYED_CHANNEL,
          payload: { sourceKey: "src", resetType: "BAD", completedAt: 1 },
          sourceWindowId: 7,
        });
      });
    }).not.toThrow();
    expect(store.getState().codingPlanQuotaResetAutoPlayedBySource).toEqual({});
  });
});

describe("coordinateCodingPlanQuotaResetAutoPlay", () => {
  it("If component unmounts before reservation returns, only release without committing played", async () => {
    const reservation = {
      sourceKey: "src",
      resetType: "FIVE_HOUR" as const,
      completedAt: 1_000,
      lease: { key: "claim-key", token: "claim-token" },
    };
    let resolveAttempt!: (attempt: { status: "reserved"; reservation: typeof reservation }) => void;
    const reserve = vi.fn(
      () =>
        new Promise<{ status: "reserved"; reservation: typeof reservation }>((resolve) => {
          resolveAttempt = resolve;
        }),
    );
    let current = true;
    const commit = vi.fn(() => true);
    const release = vi.fn(async () => undefined);
    const onCommitted = vi.fn();

    const pending = coordinateCodingPlanQuotaResetAutoPlay({
      reserve,
      isCurrent: () => current,
      commit,
      release,
      onCommitted,
    });
    current = false;
    resolveAttempt({ status: "reserved", reservation });

    await expect(pending).resolves.toEqual({ status: "released" });
    expect(release).toHaveBeenCalledWith(reservation);
    expect(commit).not.toHaveBeenCalled();
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("Commit at the same display boundary and upgrade component state if still the current candidate", async () => {
    const reservation = {
      sourceKey: "src",
      resetType: "WEEK" as const,
      completedAt: 2_000,
      lease: { key: "claim-key", token: "claim-token" },
    };
    const commit = vi.fn(() => true);
    const release = vi.fn(async () => undefined);
    const onCommitted = vi.fn();

    await expect(
      coordinateCodingPlanQuotaResetAutoPlay({
        reserve: async () => ({ status: "reserved", reservation }),
        isCurrent: () => true,
        commit,
        release,
        onCommitted,
      }),
    ).resolves.toEqual({ status: "committed" });

    expect(commit).toHaveBeenCalledWith(reservation);
    expect(onCommitted).toHaveBeenCalledWith(reservation);
    expect(release).not.toHaveBeenCalled();
  });

  it("Release reservation if display boundary re-validation fails", async () => {
    const reservation = {
      sourceKey: "src",
      resetType: "WEEK" as const,
      completedAt: 2_000,
      lease: { key: "claim-key", token: "claim-token" },
    };
    const release = vi.fn(async () => undefined);
    const onCommitted = vi.fn();

    await expect(
      coordinateCodingPlanQuotaResetAutoPlay({
        reserve: async () => ({ status: "reserved", reservation }),
        isCurrent: () => true,
        commit: () => false,
        release,
        onCommitted,
      }),
    ).resolves.toEqual({ status: "released" });

    expect(release).toHaveBeenCalledWith(reservation);
    expect(onCommitted).not.toHaveBeenCalled();
  });
});

describe("coding plan quota reset autoplay broadcast (hook)", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("When played record already exists, polling enters completed state without playing notice", async () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    const usedAt = 12_345;
    act(() => {
      store.setState({
        codingPlanQuotaResetAutoPlayedBySource: {
          src: { fiveHour: usedAt, week: null },
        },
      });
    });
    const getCodingPlanResetStatus = vi.fn(async () =>
      status({
        hasUnreadHistory: true,
        latestFiveHourResetHistory: { usedAt },
      }),
    );
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "src",
          preferredProviderId: "p",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper: wrapperFor(store) },
    );

    await waitFor(() => expect(hook.result.current.done).toBe(true));
    expect(hook.result.current.entry?.completedAt).toBe(usedAt);
    expect(hook.result.current.entry?.observedAt).toBeNull();
    expect(hook.result.current.statusVisible).toBe(false);
    expect(harness.send).not.toHaveBeenCalled();
  });

  it("Hook does not auto-claim after observing completion; plays only upon explicit Composer claim", async () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    const usedAt = 23_456;
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            hasUnreadHistory: true,
            latestFiveHourResetHistory: { usedAt },
          }),
        ),
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "src",
          preferredProviderId: "p",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper: wrapperFor(store) },
    );

    await waitFor(() => expect(hook.result.current.done).toBe(true));
    expect(harness.acquireClaim).not.toHaveBeenCalled();

    let attempt: Awaited<ReturnType<typeof hook.result.current.reserveAutomaticCompletion>>;
    await act(async () => {
      attempt = await hook.result.current.reserveAutomaticCompletion("FIVE_HOUR", usedAt);
    });

    expect(attempt!).toEqual(expect.objectContaining({ status: "reserved" }));
    expect(harness.acquireClaim).toHaveBeenCalledTimes(1);
    if (attempt!.status !== "reserved") {
      throw new Error("expected reservation");
    }
    expect(hook.result.current.commitAutomaticCompletion(attempt!.reservation)).toBe(true);
    expect(
      store.getState().codingPlanQuotaResetUiBySource.src?.fiveHour?.observedAt,
    ).not.toBeNull();
  });

  it("Retain auto-completion candidates when Hook acquire is busy", async () => {
    const harness = createBroadcastHarness({ claimStatus: "busy" });
    const store = createCfStore(harness.service);
    const usedAt = 34_567;
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            hasUnreadHistory: true,
            latestWeekResetHistory: { usedAt },
          }),
        ),
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "src",
          preferredProviderId: "p",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper: wrapperFor(store) },
    );

    await waitFor(() => expect(hook.result.current.week.done).toBe(true));

    let attempt: Awaited<ReturnType<typeof hook.result.current.reserveAutomaticCompletion>>;
    await act(async () => {
      attempt = await hook.result.current.reserveAutomaticCompletion("WEEK", usedAt);
    });

    expect(attempt!).toEqual({ status: "retry", retryAfterMs: 100 });
    expect(store.getState().codingPlanQuotaResetUiBySource.src?.week?.observedAt).not.toBeNull();
  });

  it("Report history/read immediately upon observing unread completion without waiting for entitlement refresh", async () => {
    const harness = createBroadcastHarness();
    const store = createCfStore(harness.service);
    const usedAt = 45_678;
    const markCodingPlanResetHistoryRead = vi.fn(async () => undefined);
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            hasUnreadHistory: true,
            latestFiveHourResetHistory: { usedAt },
          }),
        ),
        markCodingPlanResetHistoryRead,
      }),
    };

    renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "src",
          preferredProviderId: "p",
          accountAccess: TEST_ACCOUNT_ACCESS,
          onEntitlementRefresh: () => new Promise<void>(() => {}),
        }),
      { wrapper: wrapperFor(store) },
    );

    await waitFor(() => expect(markCodingPlanResetHistoryRead).toHaveBeenCalledTimes(1));
  });
});

describe("pruneCodingPlanQuotaResetConfettiArms", () => {
  it("Clear confetti replay arm that has been suppressed or replaced by a new used_at", () => {
    expect(
      pruneCodingPlanQuotaResetConfettiArms(
        { FIVE_HOUR: 100, WEEK: 200 },
        { FIVE_HOUR: null, WEEK: null },
      ),
    ).toEqual({ FIVE_HOUR: null, WEEK: null });

    expect(
      pruneCodingPlanQuotaResetConfettiArms(
        { FIVE_HOUR: 100, WEEK: 200 },
        { FIVE_HOUR: 300, WEEK: 200 },
      ),
    ).toEqual({ FIVE_HOUR: null, WEEK: 200 });

    const unchanged = { FIVE_HOUR: 100 as number | null, WEEK: null };
    expect(
      pruneCodingPlanQuotaResetConfettiArms(unchanged, {
        FIVE_HOUR: 100,
        WEEK: null,
      }),
    ).toBe(unchanged);
  });
});
