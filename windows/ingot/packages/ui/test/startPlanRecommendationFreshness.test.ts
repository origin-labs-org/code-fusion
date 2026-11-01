// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModelSelectionView } from "@origin-ai/cf-provider";
import type { IUsageStatsService, ProviderSettingsView } from "@origin-ai/cf-services";
import type { UsageEntitlementSnapshot } from "@origin-ai/cf-shared";
import { useStartPlanRecommendation } from "@/hooks/useStartPlanRecommendation.js";
import { useUsageEntitlementWithService } from "@/hooks/useUsageEntitlement.js";
import { buildStartPlanEntitlementOptions } from "@/lib/startPlanEntitlementOptions.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
const f = vi.hoisted(() => ({
  query: vi.fn(),
  account: "A",
  service: undefined as IUsageStatsService | undefined,
}));
vi.mock("@/components/ui/toast.js", () => ({ toast: vi.fn() }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useOptionalBaseWorkspaceServices: () => ({
    usageStatsService: f.service,
    settingService: { get: async () => ({ startPlanRecommendationDismissed: false }) },
  }),
}));
vi.mock("@/hooks/useProviderSettingsView.js", () => ({
  useProviderSettingsView: () => ({ state: { status: "ready", view: settingsView() } }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
const startId = "account:bigmodel-start-plan";
const paid = {
  providerId: "account:bigmodel-individual-coding-plan",
  modelId: "glm-5",
  options: { reasoningLevel: "high" },
};
function settingsView(): ProviderSettingsView {
  return {
    revision: 1,
    providers: [
      {
        providerId: startId,
        accountState: {
          availability: "available",
          entitled: true,
          current: true,
          connectionKey: f.account,
        },
        effectiveConfig: {
          access: {
            type: "zhipu-account",
            accountType: "bigmodel",
            mode: "start-plan",
            entitled: true,
          },
        },
      },
    ],
  } as ProviderSettingsView;
}
const view = {
  revision: 1,
  providers: [
    {
      providerId: startId,
      config: {},
      models: [
        { modelId: "glm-5", config: { optionSpecs: { reasoningLevel: { values: ["high"] } } } },
      ],
    },
  ],
} as unknown as ModelSelectionView;
const snapshot = (remaining: number): UsageEntitlementSnapshot =>
  ({
    provider: { id: startId },
    generatedAt: Date.now(),
    quota: {
      limits: [
        {
          remaining,
          number: 100,
          periodStart: 0,
          periodEnd: Date.now() + 600000,
          usageDetails: [{ modelCode: "glm-5" }],
        },
      ],
    },
  }) as UsageEntitlementSnapshot;
beforeEach(() => {
  f.account = "A";
  f.query.mockReset().mockImplementation(async () => snapshot(10));
  f.service = { getEntitlementSnapshot: f.query } as unknown as IUsageStatsService;
  localStorage.clear();
});
afterEach(() => {
  act(() => useConfirmDialogStore.getState().settleChoice("dismiss"));
  cleanup();
  vi.restoreAllMocks();
});
async function shown(recommend: ReturnType<typeof useStartPlanRecommendation>) {
  let pending!: ReturnType<typeof recommend>;
  await act(async () => {
    pending = recommend(paid);
  });
  const visible = Boolean(useConfirmDialogStore.getState().pendingRequest);
  act(() => useConfirmDialogStore.getState().settleChoice("cancel"));
  await pending;
  return visible;
}
async function ready() {
  const hook = renderHook(() => useStartPlanRecommendation(view));
  await waitFor(() => expect(f.query).toHaveBeenCalledTimes(1));
  await act(async () => {});
  return hook;
}
it("Do not wait for balance or show late alerts on this submission after prolonged idle; use new samples subsequently", async () => {
  const hook = await ready();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61000);
  expect(await shown(hook.result.current)).toBe(false);
  expect(f.query).toHaveBeenCalledTimes(2);
  expect(await shown(hook.result.current)).toBe(true);
});
it("Use real sampling time on remount; requery on cross-day access", async () => {
  const first = await ready();
  first.unmount();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86400000);
  f.query.mockImplementation(async () => snapshot(0));
  const next = renderHook(() => useStartPlanRecommendation(view));
  await act(async () => {});
  expect(f.query).toHaveBeenCalledTimes(2);
  expect(await shown(next.result.current)).toBe(false);
});
it("Switching accounts under the same brand retrieves new balance using original connection fingerprint", async () => {
  const hook = await ready();
  f.account = "B";
  f.query.mockImplementation(async () => snapshot(0));
  hook.rerender();
  await act(async () => {});
  expect(f.query).toHaveBeenCalledTimes(2);
  expect(await shown(hook.result.current)).toBe(false);
});
it("Settings page refresh publishes zero and replenished positive quotas to recommendations, merging the same access", async () => {
  const hook = await ready();
  const settings = renderHook(() =>
    useUsageEntitlementWithService(
      f.service,
      buildStartPlanEntitlementOptions(settingsView(), startId),
    ),
  );
  await act(async () => {
    await settings.result.current.refresh({ reason: "access" });
  });
  expect(f.query).toHaveBeenCalledTimes(1);
  for (const remaining of [0, 10]) {
    f.query.mockImplementation(async () => snapshot(remaining));
    await act(async () => {
      await settings.result.current.refresh({ force: true, reason: "manual" });
    });
    expect(await shown(hook.result.current)).toBe(remaining > 0);
  }
});
it("Skip recommendation on refresh failure, respect backoff on duplicate submissions, and allow recommendation again after recovery", async () => {
  const hook = await ready();
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61000);
  f.query.mockRejectedValue(new Error("offline"));
  expect(await shown(hook.result.current)).toBe(false);
  expect(await shown(hook.result.current)).toBe(false);
  expect(f.query).toHaveBeenCalledTimes(2);
  now.mockReturnValue(Date.now() + 61000);
  f.query.mockImplementation(async () => snapshot(10));
  expect(await shown(hook.result.current)).toBe(false);
  expect(await shown(hook.result.current)).toBe(true);
});

it("Failed settings refresh must not allow another entry point to continue recommending based on stale positive quota", async () => {
  const hook = await ready();
  const settings = renderHook(() =>
    useUsageEntitlementWithService(
      f.service,
      buildStartPlanEntitlementOptions(settingsView(), startId),
    ),
  );
  f.query.mockRejectedValue(new Error("offline"));
  await act(async () => {
    await settings.result.current.refresh({ force: true, silent: true });
  });
  expect(await shown(hook.result.current)).toBe(false);
});
