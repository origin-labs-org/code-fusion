// @vitest-environment jsdom

import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IBroadcastService, IUsageStatsService } from "@origin-ai/cf-services";
import type { CodingPlanResetStatusSnapshot, CfAccountAccess } from "@origin-ai/cf-shared";
import { StoreProvider, useCfStore } from "@/store/StoreProvider.js";

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

const broadcastService = {
  send: vi.fn(async () => undefined),
  onMessage: () => ({ dispose: () => {} }),
} as unknown as IBroadcastService;

const TEST_ACCOUNT_ACCESS: CfAccountAccess = {
  type: "zhipu-account",
  family: "bigmodel",
  planKind: "individual-coding-plan",
};
const TEST_TEAM_ACCOUNT_ACCESS: CfAccountAccess = {
  type: "zhipu-account",
  family: "bigmodel",
  planKind: "team-coding-plan",
  productId: "product-team",
  organizationId: "org",
  projectId: "project",
};

function wrapper({ children }: { children: ReactNode }) {
  return createElement(StoreProvider, { broadcastService }, children);
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

describe("useCodingPlanQuotaResetUi", () => {
  beforeEach(() => {
    mocks.toast.mockReset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    cleanup();
    mocks.services = null;
  });

  it("首次 status 无机会时调用 opportunity，未发放则保持Hide", async () => {
    const getCodingPlanResetStatus = vi.fn(async () => status());
    const requestCodingPlanResetOpportunity = vi.fn(async () => ({
      granted: false,
      nextTryAt: null,
    }));
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        requestCodingPlanResetOpportunity,
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-empty",
          preferredProviderId: "builtin:personal-empty",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );

    await waitFor(() => expect(requestCodingPlanResetOpportunity).toHaveBeenCalledTimes(1));
    expect(requestCodingPlanResetOpportunity).toHaveBeenCalledWith({
      preferredProviderId: "builtin:personal-empty",
      accountAccess: TEST_ACCOUNT_ACCESS,
      idempotencyKey: expect.any(String),
    });
    expect(hook.result.current.opportunityVisible).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("opportunity 发放成功后强制Refresh status 并展示机会", async () => {
    const expiresAt = Date.now() + 60_000;
    const getCodingPlanResetStatus = vi
      .fn<() => Promise<CodingPlanResetStatusSnapshot>>()
      .mockResolvedValueOnce(status())
      .mockResolvedValue(status({ availableFiveHourResets: [{ expireAt: expiresAt }] }));
    const requestCodingPlanResetOpportunity = vi.fn(async () => ({
      granted: true,
      nextTryAt: null,
    }));
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        requestCodingPlanResetOpportunity,
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-granted",
          preferredProviderId: "builtin:personal-granted",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.opportunityVisible).toBe(true));
    expect(requestCodingPlanResetOpportunity).toHaveBeenCalledTimes(1);
    expect(getCodingPlanResetStatus).toHaveBeenCalledTimes(2);
  });

  it("opportunity Request failed时Retain status Status且不弹手动Reset toast", async () => {
    const requestCodingPlanResetOpportunity = vi.fn(async () => {
      throw new Error("coding_plan_reset_api_error:2007");
    });
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () => status()),
        requestCodingPlanResetOpportunity,
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-opportunity-failed",
          preferredProviderId: "builtin:personal-opportunity-failed",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );

    await waitFor(() => expect(requestCodingPlanResetOpportunity).toHaveBeenCalledTimes(1));
    expect(hook.result.current.opportunityVisible).toBe(false);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("多个入口对E同 service + scope 合并 opportunity in-flight", async () => {
    let resolveOpportunity!: (value: { granted: boolean; nextTryAt: number | null }) => void;
    const getCodingPlanResetStatus = vi.fn(async () => status());
    const requestCodingPlanResetOpportunity = vi.fn(
      () =>
        new Promise<{ granted: boolean; nextTryAt: number | null }>((resolve) => {
          resolveOpportunity = resolve;
        }),
    );
    const service = createUsageStatsService({
      getCodingPlanResetStatus,
      requestCodingPlanResetOpportunity,
    });
    mocks.services = { usageStatsService: service };
    const options = {
      sourceKey: "team:bigmodel:product-team:org:project-opportunity",
      preferredProviderId: "builtin:team",
      accountAccess: TEST_TEAM_ACCOUNT_ACCESS,
    };

    const first = renderHook(() => useCodingPlanQuotaResetUi(options), {
      wrapper,
    });
    const second = renderHook(() => useCodingPlanQuotaResetUi(options), {
      wrapper,
    });

    await waitFor(() => expect(requestCodingPlanResetOpportunity).toHaveBeenCalledTimes(1));
    expect(requestCodingPlanResetOpportunity).toHaveBeenCalledWith({
      preferredProviderId: "builtin:team",
      accountAccess: TEST_TEAM_ACCOUNT_ACCESS,
      idempotencyKey: expect.any(String),
    });
    resolveOpportunity({ granted: false, nextTryAt: Date.now() + 60_000 });
    await waitFor(() => expect(first.result.current.opportunityVisible).toBe(false));
    expect(second.result.current.opportunityVisible).toBe(false);
  });

  it("本轮刚Completed时Skip opportunity(Completed周期不抢发放)", async () => {
    const requestCodingPlanResetOpportunity = vi.fn(async () => ({
      granted: false,
      nextTryAt: null,
    }));
    const completedUsedAt = Date.now() - 1_000;
    const completedService = createUsageStatsService({
      getCodingPlanResetStatus: vi.fn(async () =>
        status({
          latestFiveHourResetHistory: { usedAt: completedUsedAt },
          latestWeekResetHistory: { usedAt: completedUsedAt },
          hasUnreadHistory: true,
        }),
      ),
      requestCodingPlanResetOpportunity,
    });
    mocks.services = { usageStatsService: completedService };
    const completed = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-completed",
          preferredProviderId: "builtin:personal-completed",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(completed.result.current.done).toBe(true));
    await waitFor(() => expect(completed.result.current.week.done).toBe(true));
    expect(requestCodingPlanResetOpportunity).not.toHaveBeenCalled();
  });

  it("任One类型已有机会时仍调用 opportunity 以发放另One类(Backend有上限不会膨胀)", async () => {
    const requestCodingPlanResetOpportunity = vi.fn(async () => ({
      granted: false,
      nextTryAt: null,
    }));

    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            availableFiveHourResets: [{ expireAt: Date.now() + 60_000 }],
          }),
        ),
        requestCodingPlanResetOpportunity,
      }),
    };
    const fiveHourOnly = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-five-hour-only",
          preferredProviderId: "builtin:personal-five-hour-only",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(fiveHourOnly.result.current.opportunityVisible).toBe(true));
    await waitFor(() => expect(requestCodingPlanResetOpportunity).toHaveBeenCalled());
    expect(fiveHourOnly.result.current.week.opportunityVisible).toBe(false);
    fiveHourOnly.unmount();
    requestCodingPlanResetOpportunity.mockClear();

    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({ availableWeekResets: [{ expireAt: Date.now() + 60_000 }] }),
        ),
        requestCodingPlanResetOpportunity,
      }),
    };
    const weekOnly = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-week-only",
          preferredProviderId: "builtin:personal-week-only",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(weekOnly.result.current.week.opportunityVisible).toBe(true));
    await waitFor(() => expect(requestCodingPlanResetOpportunity).toHaveBeenCalled());
    weekOnly.unmount();
    requestCodingPlanResetOpportunity.mockClear();

    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            availableFiveHourResets: [{ expireAt: Date.now() + 60_000 }],
            availableWeekResets: [{ expireAt: Date.now() + 60_000 }],
          }),
        ),
        requestCodingPlanResetOpportunity,
      }),
    };
    const bothAvailable = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-both-available",
          preferredProviderId: "builtin:personal-both-available",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(bothAvailable.result.current.opportunityVisible).toBe(true));
    await waitFor(() => expect(bothAvailable.result.current.week.opportunityVisible).toBe(true));
    await waitFor(() => expect(requestCodingPlanResetOpportunity).toHaveBeenCalled());
  });

  it("多个入口对E同 service + scope 合并 status in-flight", async () => {
    let resolveStatus!: (value: CodingPlanResetStatusSnapshot) => void;
    const getCodingPlanResetStatus = vi.fn(
      () =>
        new Promise<CodingPlanResetStatusSnapshot>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const service = createUsageStatsService({ getCodingPlanResetStatus });
    mocks.services = { usageStatsService: service };
    const options = {
      sourceKey: "builtin:personal",
      preferredProviderId: "builtin:personal",
      accountAccess: TEST_ACCOUNT_ACCESS,
    };

    const first = renderHook(() => useCodingPlanQuotaResetUi(options), {
      wrapper,
    });
    const second = renderHook(() => useCodingPlanQuotaResetUi(options), {
      wrapper,
    });

    await waitFor(() => expect(getCodingPlanResetStatus).toHaveBeenCalledTimes(1));
    resolveStatus(status({ availableFiveHourResets: [{ expireAt: Date.now() + 60_000 }] }));
    await waitFor(() => expect(first.result.current.opportunityVisible).toBe(true));
    await waitFor(() => expect(second.result.current.opportunityVisible).toBe(true));
  });

  it("手动FailedRetry复用同One个幂等键", async () => {
    const getCodingPlanResetStatus = vi.fn(async () =>
      status({ availableFiveHourResets: [{ expireAt: Date.now() + 60_000 }] }),
    );
    const useCodingPlanReset = vi.fn(async () => {
      throw new Error("coding_plan_reset_api_error:2007");
    });
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        useCodingPlanReset,
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal",
          preferredProviderId: "builtin:personal",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.opportunityVisible).toBe(true));

    await act(async () => {
      await expect(hook.result.current.reset()).rejects.toThrow("2007");
    });
    await waitFor(() => expect(hook.result.current.opportunityVisible).toBe(true));
    await act(async () => {
      await expect(hook.result.current.reset()).rejects.toThrow("2007");
    });

    expect(useCodingPlanReset).toHaveBeenCalledTimes(2);
    expect(useCodingPlanReset.mock.calls[0]?.[0].idempotencyKey).toBe(
      useCodingPlanReset.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(mocks.toast).toHaveBeenCalledTimes(2);
  });

  it("重渲染仅更换 onEntitlementRefresh 身份时不重启轮询、不重复Request opportunity", async () => {
    const getCodingPlanResetStatus = vi.fn(async () => status());
    const requestCodingPlanResetOpportunity = vi.fn(async () => ({
      granted: false,
      nextTryAt: null,
    }));
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        requestCodingPlanResetOpportunity,
      }),
    };

    const hook = renderHook(
      ({ onEntitlementRefresh }: { onEntitlementRefresh: () => Promise<void> }) =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-callback-identity",
          preferredProviderId: "builtin:personal-callback-identity",
          accountAccess: TEST_ACCOUNT_ACCESS,
          onEntitlementRefresh,
        }),
      {
        wrapper,
        initialProps: { onEntitlementRefresh: vi.fn(async () => undefined) },
      },
    );
    await waitFor(() => expect(requestCodingPlanResetOpportunity).toHaveBeenCalledTimes(1));
    const statusCalls = getCodingPlanResetStatus.mock.calls.length;

    for (let index = 0; index < 5; index += 1) {
      hook.rerender({ onEntitlementRefresh: vi.fn(async () => undefined) });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(requestCodingPlanResetOpportunity).toHaveBeenCalledTimes(1);
    expect(getCodingPlanResetStatus).toHaveBeenCalledTimes(statusCalls);
  });

  it("use 成功后以Service端 usedAt Completed，Refresh entitlement 并上报 history/read", async () => {
    const now = Date.now();
    const usedAt = now + 1_000;
    const getCodingPlanResetStatus = vi
      .fn<() => Promise<CodingPlanResetStatusSnapshot>>()
      .mockResolvedValueOnce(status({ availableFiveHourResets: [{ expireAt: now + 60_000 }] }))
      .mockResolvedValue(
        status({
          latestFiveHourResetHistory: { usedAt },
          hasUnreadHistory: true,
        }),
      );
    const markCodingPlanResetHistoryRead = vi.fn(async () => undefined);
    const onEntitlementRefresh = vi.fn(async () => undefined);
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        markCodingPlanResetHistoryRead,
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "team:bigmodel:product-team:org:project",
          preferredProviderId: "builtin:team",
          accountAccess: TEST_TEAM_ACCOUNT_ACCESS,
          onEntitlementRefresh,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.opportunityVisible).toBe(true));

    await act(async () => {
      await hook.result.current.reset();
    });

    expect(hook.result.current.entry?.completedAt).toBe(usedAt);
    expect(onEntitlementRefresh).toHaveBeenCalledTimes(1);
    expect(hook.result.current.entry?.quotaOverridePending).toBe(false);
    await waitFor(() => expect(markCodingPlanResetHistoryRead).toHaveBeenCalledTimes(1));
    expect(markCodingPlanResetHistoryRead).toHaveBeenCalledWith({
      preferredProviderId: "builtin:team",
      accountAccess: TEST_TEAM_ACCOUNT_ACCESS,
    });
  });

  it("同One service 下两个 scope E同 usedAt 只上报One次 history/read（User级Shared游Label契About）", async () => {
    const now = Date.now();
    const usedAt = now + 1_000;
    const opportunity = () => status({ availableFiveHourResets: [{ expireAt: now + 60_000 }] });
    const completed = () =>
      status({ latestFiveHourResetHistory: { usedAt }, hasUnreadHistory: true });
    let phase: "personal-opportunity" | "team-opportunity" | "completed" = "personal-opportunity";
    const getCodingPlanResetStatus = vi.fn(async () => {
      if (phase !== "completed") return opportunity();
      return completed();
    });
    const markCodingPlanResetHistoryRead = vi.fn(async () => undefined);
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        markCodingPlanResetHistoryRead,
      }),
    };

    const personal = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-granted",
          preferredProviderId: "builtin:personal-granted",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(personal.result.current.opportunityVisible).toBe(true));
    phase = "completed";
    await act(async () => {
      await personal.result.current.reset();
    });
    await waitFor(() => expect(markCodingPlanResetHistoryRead).toHaveBeenCalledTimes(1));
    personal.unmount();

    phase = "team-opportunity";
    const team = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "team:bigmodel:product-team:org:project",
          preferredProviderId: "builtin:team",
          accountAccess: TEST_TEAM_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(team.result.current.opportunityVisible).toBe(true));
    phase = "completed";
    await act(async () => {
      await team.result.current.reset();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(markCodingPlanResetHistoryRead).toHaveBeenCalledTimes(1);
    team.unmount();
  });

  it("Other入口观察到手动Reset历史时不会误触发AutoReset交互", async () => {
    const now = Date.now();
    const usedAt = now + 1_000;
    let currentStatus = status({
      availableFiveHourResets: [{ expireAt: now + 60_000 }],
    });
    const getCodingPlanResetStatus = vi.fn(async () => currentStatus);
    const useCodingPlanReset = vi.fn(async () => {
      currentStatus = status({
        latestFiveHourResetHistory: { usedAt },
        hasUnreadHistory: true,
      });
      return { used: true as const };
    });
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        useCodingPlanReset,
      }),
    };
    const scope = {
      preferredProviderId: "builtin:personal-shared-manual",
      accountAccess: TEST_ACCOUNT_ACCESS,
    };
    const settingsEntry = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "settings:personal-shared-manual",
          ...scope,
        }),
      { wrapper },
    );
    const composerEntry = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "composer:personal-shared-manual",
          ...scope,
        }),
      { wrapper },
    );

    await waitFor(() => expect(settingsEntry.result.current.opportunityVisible).toBe(true));
    await waitFor(() => expect(composerEntry.result.current.opportunityVisible).toBe(true));

    await act(async () => settingsEntry.result.current.reset());
    expect(settingsEntry.result.current.entry?.startedAt).not.toBeNull();
    expect(settingsEntry.result.current.statusVisible).toBe(false);

    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(composerEntry.result.current.done).toBe(true));
    expect(composerEntry.result.current.entry?.completedAt).toBe(usedAt);
    expect(composerEntry.result.current.entry?.startedAt).not.toBeNull();
    expect(composerEntry.result.current.statusVisible).toBe(false);
  });

  it("Other入口的手动核销仍在进行时,第Two个入口 reset 不发FromSecond time /use", async () => {
    const now = Date.now();
    let currentStatus = status({
      availableFiveHourResets: [{ expireAt: now + 60_000 }],
    });
    const getCodingPlanResetStatus = vi.fn(async () => currentStatus);
    let resolveUse!: (value: { used: true }) => void;
    const useCodingPlanReset = vi.fn(
      () =>
        new Promise<{ used: true }>((resolve) => {
          resolveUse = resolve;
        }),
    );
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        useCodingPlanReset,
      }),
    };
    const scope = {
      preferredProviderId: "builtin:personal-use-single-flight",
      accountAccess: TEST_ACCOUNT_ACCESS,
    };
    const settingsEntry = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "settings:use-single-flight",
          ...scope,
        }),
      { wrapper },
    );
    const composerEntry = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "composer:use-single-flight",
          ...scope,
        }),
      { wrapper },
    );
    await waitFor(() => expect(settingsEntry.result.current.opportunityVisible).toBe(true));
    await waitFor(() => expect(composerEntry.result.current.opportunityVisible).toBe(true));

    let settingsReset!: Promise<void>;
    act(() => {
      settingsReset = settingsEntry.result.current.reset();
    });
    await waitFor(() => expect(useCodingPlanReset).toHaveBeenCalledTimes(1));

    await act(async () => {
      await composerEntry.result.current.reset();
    });
    expect(useCodingPlanReset).toHaveBeenCalledTimes(1);
    expect(composerEntry.result.current.processing).toBe(false);

    const usedAt = now + 1_000;
    currentStatus = status({
      latestFiveHourResetHistory: { usedAt },
      hasUnreadHistory: true,
    });
    resolveUse({ used: true });
    await act(async () => {
      await settingsReset;
    });
    expect(settingsEntry.result.current.done).toBe(true);
  });

  it("手动核销Completed后,尚未轮询到的入口点击 reset 只对账为手动Completed,不重Review销", async () => {
    const now = Date.now();
    const usedAt = now + 1_000;
    let currentStatus = status({
      availableFiveHourResets: [{ expireAt: now + 60_000 }],
    });
    const getCodingPlanResetStatus = vi.fn(async () => currentStatus);
    const useCodingPlanReset = vi.fn(async () => {
      currentStatus = status({
        latestFiveHourResetHistory: { usedAt },
        hasUnreadHistory: true,
      });
      return { used: true as const };
    });
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        useCodingPlanReset,
      }),
    };
    const scope = {
      preferredProviderId: "builtin:personal-stale-entry",
      accountAccess: TEST_ACCOUNT_ACCESS,
    };
    const settingsEntry = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "settings:stale-entry",
          ...scope,
        }),
      { wrapper },
    );
    const composerEntry = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "composer:stale-entry",
          ...scope,
        }),
      { wrapper },
    );
    await waitFor(() => expect(settingsEntry.result.current.opportunityVisible).toBe(true));
    await waitFor(() => expect(composerEntry.result.current.opportunityVisible).toBe(true));

    await act(async () => settingsEntry.result.current.reset());
    expect(settingsEntry.result.current.done).toBe(true);

    await act(async () => composerEntry.result.current.reset());
    expect(useCodingPlanReset).toHaveBeenCalledTimes(1);
    expect(composerEntry.result.current.done).toBe(true);
    expect(composerEntry.result.current.entry?.startedAt).not.toBeNull();
    expect(composerEntry.result.current.statusVisible).toBe(false);
  });

  it("Completed后同One used_at 周期innerNew发放的机会恢复Reset入口,无需Log In Again", async () => {
    const now = Date.now();
    const usedAt = now - 1_000;
    let currentStatus = status({
      latestFiveHourResetHistory: { usedAt },
      hasUnreadHistory: true,
    });
    const getCodingPlanResetStatus = vi.fn(async () => currentStatus);
    mocks.services = {
      usageStatsService: createUsageStatsService({ getCodingPlanResetStatus }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-regrant",
          preferredProviderId: "builtin:personal-regrant",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.done).toBe(true));

    currentStatus = status({
      availableFiveHourResets: [{ expireAt: now + 120_000 }],
      latestFiveHourResetHistory: { usedAt },
      hasUnreadHistory: false,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(hook.result.current.opportunityVisible).toBe(true));
    expect(hook.result.current.done).toBe(false);
  });

  it.each([
    { clearUnreadOnRead: true, label: "history/read 已清除 unread" },
    { clearUnreadOnRead: false, label: "unread 尚未清除" },
  ])(
    "同类型多张机会：核销One张后Completed态Retain余下机会，不重挂载即可再次核销（$label）",
    async ({ clearUnreadOnRead }) => {
      const now = Date.now();
      let useCount = 0;
      let currentStatus = status({
        availableFiveHourResets: [{ expireAt: now + 60_000 }, { expireAt: now + 120_000 }],
      });
      const getCodingPlanResetStatus = vi.fn(async () => currentStatus);
      const useCodingPlanReset = vi.fn(async () => {
        useCount += 1;
        currentStatus = status({
          availableFiveHourResets: currentStatus.availableFiveHourResets.slice(1),
          latestFiveHourResetHistory: { usedAt: now + 1_000 * useCount },
          hasUnreadHistory: true,
        });
        return { used: true as const };
      });
      const markCodingPlanResetHistoryRead = vi.fn(async () => {
        if (clearUnreadOnRead) {
          currentStatus = { ...currentStatus, hasUnreadHistory: false };
        }
      });
      mocks.services = {
        usageStatsService: createUsageStatsService({
          getCodingPlanResetStatus,
          useCodingPlanReset,
          markCodingPlanResetHistoryRead,
        }),
      };
      const scopeId = `builtin:personal-multi-${clearUnreadOnRead}`;

      const hook = renderHook(
        () =>
          useCodingPlanQuotaResetUi({
            sourceKey: scopeId,
            preferredProviderId: scopeId,
            accountAccess: TEST_ACCOUNT_ACCESS,
          }),
        { wrapper },
      );
      await waitFor(() => expect(hook.result.current.entry?.opportunityCount).toBe(2));

      await act(async () => hook.result.current.reset());

      expect(hook.result.current.done).toBe(true);
      expect(hook.result.current.entry).toMatchObject({
        completedAt: now + 1_000,
        opportunityCount: 1,
        opportunityExpiresAt: now + 120_000,
      });
      expect(hook.result.current.opportunityVisible).toBe(true);

      await act(async () => hook.result.current.reset());

      expect(useCodingPlanReset).toHaveBeenCalledTimes(2);
      expect(useCodingPlanReset.mock.calls[1]?.[0].idempotencyKey).not.toBe(
        useCodingPlanReset.mock.calls[0]?.[0].idempotencyKey,
      );
      expect(hook.result.current.entry).toMatchObject({
        status: "completed",
        completedAt: now + 2_000,
        opportunityCount: 0,
        opportunityExpiresAt: null,
      });
      expect(hook.result.current.opportunityVisible).toBe(false);
    },
  );

  function createLaggingSecondUseService(params: { lagReads: number; staleUnread: boolean }) {
    const now = Date.now();
    let useCount = 0;
    let lagReadsRemaining = 0;
    let pendingStatus: CodingPlanResetStatusSnapshot | null = null;
    let remaining = [{ expireAt: now + 60_000 }, { expireAt: now + 120_000 }];
    let currentStatus = status({ availableFiveHourResets: remaining });
    const getCodingPlanResetStatus = vi.fn(async () => {
      if (lagReadsRemaining > 0) {
        lagReadsRemaining -= 1;
        return currentStatus;
      }
      if (pendingStatus) {
        currentStatus = pendingStatus;
        pendingStatus = null;
      }
      return currentStatus;
    });
    const useCodingPlanReset = vi.fn(async () => {
      useCount += 1;
      remaining = remaining.slice(1);
      const next = status({
        availableFiveHourResets: remaining,
        latestFiveHourResetHistory: { usedAt: now + 1_000 * useCount },
        hasUnreadHistory: true,
      });
      if (useCount === 1) {
        currentStatus = next;
      } else {
        pendingStatus = next;
        lagReadsRemaining = params.lagReads;
        currentStatus = { ...currentStatus, hasUnreadHistory: params.staleUnread };
      }
      return { used: true as const };
    });
    return { now, getCodingPlanResetStatus, useCodingPlanReset };
  }

  it.each([
    { staleUnread: true, label: "滞后快照 unread 未清" },
    { staleUnread: false, label: "滞后快照 unread 已清" },
  ])(
    "Completed态再次核销时 status 仍Yes上One张 used_at，等到New used_at 才确认成功（$label）",
    async ({ staleUnread }) => {
      const { now, getCodingPlanResetStatus, useCodingPlanReset } = createLaggingSecondUseService({
        lagReads: 2,
        staleUnread,
      });
      mocks.services = {
        usageStatsService: createUsageStatsService({
          getCodingPlanResetStatus,
          useCodingPlanReset,
        }),
      };
      const scopeId = `builtin:personal-lagging-${staleUnread}`;
      const hook = renderHook(
        () =>
          useCodingPlanQuotaResetUi({
            sourceKey: scopeId,
            preferredProviderId: scopeId,
            accountAccess: TEST_ACCOUNT_ACCESS,
          }),
        { wrapper },
      );
      await waitFor(() => expect(hook.result.current.entry?.opportunityCount).toBe(2));

      await act(async () => hook.result.current.reset());
      expect(hook.result.current.entry).toMatchObject({
        status: "completed",
        completedAt: now + 1_000,
        opportunityCount: 1,
      });

      await act(async () => hook.result.current.reset());

      expect(useCodingPlanReset).toHaveBeenCalledTimes(2);
      expect(hook.result.current.entry).toMatchObject({
        status: "completed",
        completedAt: now + 2_000,
        opportunityCount: 0,
        opportunityExpiresAt: null,
      });
      expect(hook.result.current.opportunityVisible).toBe(false);
    },
  );

  it("Completed态再次核销后 4 times对账都未见New used_at 时走Failed恢复，不静默成功", async () => {
    const { getCodingPlanResetStatus, useCodingPlanReset } = createLaggingSecondUseService({
      lagReads: 4,
      staleUnread: true,
    });
    mocks.services = {
      usageStatsService: createUsageStatsService({ getCodingPlanResetStatus, useCodingPlanReset }),
    };
    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-lagging-timeout",
          preferredProviderId: "builtin:personal-lagging-timeout",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.entry?.opportunityCount).toBe(2));
    await act(async () => hook.result.current.reset());
    mocks.toast.mockReset();

    await act(async () => {
      await expect(hook.result.current.reset()).rejects.toThrow(
        "coding_plan_reset_status_not_confirmed",
      );
    });

    expect(useCodingPlanReset).toHaveBeenCalledTimes(2);
    expect(hook.result.current.entry).toMatchObject({ status: "available", opportunityCount: 1 });
    expect(hook.result.current.entry?.error).toBe("coding_plan_reset_status_not_confirmed");
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });

  it("没有手动核销轨迹的New历史仍RetainAutoResetCompletedNotice", async () => {
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            latestFiveHourResetHistory: { usedAt: Date.now() - 1_000 },
            hasUnreadHistory: true,
          }),
        ),
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-automatic-remains",
          preferredProviderId: "builtin:personal-automatic-remains",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.done).toBe(true));
    expect(hook.result.current.entry?.startedAt).toBeNull();
    expect(hook.result.current.statusVisible).toBe(true);
  });

  it("entitlement RefreshFailed时Retain乐观覆盖，并在后续Status校正时Retry", async () => {
    const usedAt = Date.now() - 1_000;
    const onEntitlementRefresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("temporary refresh failure"))
      .mockResolvedValue(undefined);
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            latestFiveHourResetHistory: { usedAt },
            hasUnreadHistory: true,
          }),
        ),
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-refresh-retry",
          preferredProviderId: "builtin:personal-refresh-retry",
          accountAccess: TEST_ACCOUNT_ACCESS,
          onEntitlementRefresh,
        }),
      { wrapper },
    );

    await waitFor(() => expect(onEntitlementRefresh).toHaveBeenCalledTimes(1));
    expect(hook.result.current.entry?.quotaOverridePending).toBe(true);

    act(() => document.dispatchEvent(new Event("visibilitychange")));

    await waitFor(() => expect(onEntitlementRefresh).toHaveBeenCalledTimes(2));
    expect(hook.result.current.entry?.quotaOverridePending).toBe(false);
  });

  it("周额度机会独立于五小时Passed week 子控制器暴露", async () => {
    const expiresAt = Date.now() + 60_000;
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({ availableWeekResets: [{ expireAt: expiresAt }] }),
        ),
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-week-available",
          preferredProviderId: "builtin:personal-week-available",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.week.opportunityVisible).toBe(true));
    expect(hook.result.current.week.entry?.opportunityExpiresAt).toBe(expiresAt);
    expect(hook.result.current.opportunityVisible).toBe(false);
    expect(hook.result.current.entry).toBeNull();
  });

  it("周额度手动ResetSend resetType=WEEK 并以Service端 usedAt Completed", async () => {
    const now = Date.now();
    const usedAt = now + 1_000;
    const getCodingPlanResetStatus = vi
      .fn<() => Promise<CodingPlanResetStatusSnapshot>>()
      .mockResolvedValueOnce(status({ availableWeekResets: [{ expireAt: now + 60_000 }] }))
      .mockResolvedValue(
        status({
          latestWeekResetHistory: { usedAt },
          hasUnreadHistory: true,
        }),
      );
    const useCodingPlanReset = vi.fn(async () => ({ used: true as const }));
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus,
        useCodingPlanReset,
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-week-reset",
          preferredProviderId: "builtin:personal-week-reset",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current.week.opportunityVisible).toBe(true));

    await act(async () => {
      await hook.result.current.week.reset();
    });

    expect(useCodingPlanReset).toHaveBeenCalledWith(expect.objectContaining({ resetType: "WEEK" }));
    expect(hook.result.current.week.entry?.completedAt).toBe(usedAt);
    expect(hook.result.current.week.done).toBe(true);
    expect(hook.result.current.done).toBe(false);
  });

  it("周额度AutoCompleted时只有 week 子控制器进入 done", async () => {
    const usedAt = Date.now() - 1_000;
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () =>
          status({
            latestWeekResetHistory: { usedAt },
            hasUnreadHistory: true,
          }),
        ),
      }),
    };

    const hook = renderHook(
      () =>
        useCodingPlanQuotaResetUi({
          sourceKey: "builtin:personal-week-auto",
          preferredProviderId: "builtin:personal-week-auto",
          accountAccess: TEST_ACCOUNT_ACCESS,
        }),
      { wrapper },
    );

    await waitFor(() => expect(hook.result.current.week.done).toBe(true));
    expect(hook.result.current.week.entry?.startedAt).toBeNull();
    expect(hook.result.current.week.statusVisible).toBe(true);
    expect(hook.result.current.done).toBe(false);
    expect(hook.result.current.entry).toBeNull();
  });

  it("只在鉴权Session变化后静音Old周AutoCompleted,同SessionOther入口后挂载仍展示", async () => {
    const firstUsedAt = Date.now() - 10_000;
    const secondUsedAt = Date.now() - 1_000;
    let currentStatus = status({
      latestWeekResetHistory: { usedAt: firstUsedAt },
      hasUnreadHistory: true,
    });
    mocks.services = {
      usageStatsService: createUsageStatsService({
        getCodingPlanResetStatus: vi.fn(async () => currentStatus),
      }),
    };

    const hookProps = {
      sourceKey: "composer:relogin-week",
      preferredProviderId: "builtin:personal-relogin-week",
      accountAccess: TEST_ACCOUNT_ACCESS,
    };
    let latest: ReturnType<typeof useCodingPlanQuotaResetUi> | null = null;
    let startAuthenticatedSession: (() => void) | null = null;
    function Probe(props: Parameters<typeof useCodingPlanQuotaResetUi>[0]) {
      latest = useCodingPlanQuotaResetUi(props);
      return null;
    }
    function AuthControl() {
      const setUser = useCfStore((state) => state.setUser);
      startAuthenticatedSession = () =>
        setUser({ id: "user-1", username: "tester", displayName: "Tester" });
      return null;
    }
    function Harness({ mountKey }: { mountKey: string }) {
      return createElement(
        StoreProvider,
        { broadcastService },
        createElement(AuthControl),
        createElement(Probe, { key: mountKey, ...hookProps }),
      );
    }

    const view = render(createElement(Harness, { mountKey: "settings-entry" }));
    await waitFor(() => expect(latest?.week.done).toBe(true));
    expect(latest?.week.entry?.observedAt).not.toBeNull();
    expect(latest?.week.statusVisible).toBe(true);

    view.rerender(createElement(Harness, { mountKey: "composer-same-session" }));
    await waitFor(() => expect(latest?.week.done).toBe(true));
    expect(latest?.week.entry?.observedAt).not.toBeNull();
    expect(latest?.week.statusVisible).toBe(true);

    act(() => startAuthenticatedSession?.());
    view.rerender(createElement(Harness, { mountKey: "composer-next-session" }));
    await waitFor(() => {
      expect(latest?.week.entry?.observedAt).toBeNull();
      expect(latest?.week.statusVisible).toBe(false);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(latest?.week.entry?.observedAt).toBeNull());
    expect(latest?.week.statusVisible).toBe(false);

    currentStatus = status({
      latestWeekResetHistory: { usedAt: secondUsedAt },
      hasUnreadHistory: true,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(latest?.week.entry?.completedAt).toBe(secondUsedAt));
    expect(latest?.week.entry?.observedAt).not.toBeNull();
    expect(latest?.week.statusVisible).toBe(true);
  });
});
