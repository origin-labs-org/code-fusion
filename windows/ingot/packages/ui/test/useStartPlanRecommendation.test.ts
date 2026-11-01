// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelSelectionView } from "@origin-ai/cf-provider";
import { useStartPlanRecommendation } from "@/hooks/useStartPlanRecommendation.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
const fixture = vi.hoisted(() => ({
  dismissed: false,
  update: vi.fn(),
  toast: vi.fn(),
  readError: false,
  error: null as string | null,
}));
vi.mock("@/hooks/useProviderSettingsView.js", () => ({
  useProviderSettingsView: () => ({
    state: {
      status: "ready",
      view: {
        revision: 1,
        providers: [
          {
            providerId: "account:bigmodel-start-plan",
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
      },
    },
  }),
}));
vi.mock("@/components/ui/toast.js", () => ({ toast: fixture.toast }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useOptionalBaseWorkspaceServices: () => ({
    settingService: {
      get: async () => {
        if (fixture.readError) throw new Error("settings unavailable");
        return { startPlanRecommendationDismissed: fixture.dismissed };
      },
      update: fixture.update,
    },
    usageStatsService: {},
  }),
}));
vi.mock("@/hooks/useUsageEntitlement.js", () => ({
  useUsageEntitlementWithService: (_service: unknown, options: { accountAccess: unknown }) => {
    expect(options.accountAccess).toEqual({
      type: "zhipu-account",
      family: "bigmodel",
      planKind: "start-plan",
    });
    return {
      error: fixture.error,
      refresh: vi.fn(),
      snapshot: {
        provider: { id: "account:bigmodel-start-plan" },
        generatedAt: Date.now(),
        quota: { limits: [{ remaining: 10, usageDetails: [{ modelCode: "glm-5" }] }] },
      },
    };
  },
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
const paid = {
  providerId: "account:bigmodel-individual-coding-plan",
  modelId: "glm-5",
  options: { reasoningLevel: "high" },
};
const start = { ...paid, providerId: "account:bigmodel-start-plan" };
const view = {
  revision: 1,
  providers: [
    {
      providerId: start.providerId,
      config: {},
      models: [
        {
          modelId: start.modelId,
          config: { optionSpecs: { reasoningLevel: { values: ["high"] } } },
        },
      ],
    },
  ],
} as unknown as ModelSelectionView;
beforeEach(() => {
  fixture.dismissed = false;
  fixture.readError = false;
  fixture.toast.mockReset();
  fixture.error = null;
  fixture.update.mockReset().mockImplementation(async (patch) => {
    fixture.dismissed = patch.startPlanRecommendationDismissed;
  });
});
afterEach(() => {
  act(() => useConfirmDialogStore.getState().settleChoice("dismiss"));
  cleanup();
});

describe("Submit推荐确认与 Host 偏OK", () => {
  it.each(["confirm", "cancel"] as const)(
    "%s + 不再Notice：只Save抑制偏OK，下次仍用Current入口的选择",
    async (choice) => {
      const first = renderHook(() => useStartPlanRecommendation(view));
      let pending!: ReturnType<typeof first.result.current>;
      await act(async () => {
        pending = first.result.current(paid);
      });
      expect(useConfirmDialogStore.getState().pendingRequest).toBeDefined();
      act(() => {
        useConfirmDialogStore.getState().pendingRequest?.checkbox?.onCheckedChange(true);
        useConfirmDialogStore.getState().settleChoice(choice);
      });
      const chosen = await pending;
      expect(chosen).toEqual(choice === "confirm" ? start : paid);
      expect(fixture.update).toHaveBeenCalledExactlyOnceWith({
        startPlanRecommendationDismissed: true,
      });
      first.unmount();
      const next = renderHook(() => useStartPlanRecommendation(view));
      await expect(next.result.current(paid)).resolves.toEqual(paid);
      await expect(next.result.current(start)).resolves.toEqual(start);
      expect(useConfirmDialogStore.getState().pendingRequest).toBeUndefined();
    },
  );
  it("Close弹窗Cancel本次Submit，即使勾选也不Save偏OK", async () => {
    const { result } = renderHook(() => useStartPlanRecommendation(view));
    let pending!: ReturnType<typeof result.current>;
    await act(async () => {
      pending = result.current(paid);
    });
    act(() => {
      useConfirmDialogStore.getState().pendingRequest?.checkbox?.onCheckedChange(true);
      useConfirmDialogStore.getState().settleChoice("dismiss");
    });
    await expect(pending).resolves.toBeNull();
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it("不勾选时Retain后续推荐，另One弹窗占用时不误当成“不了”Submit", async () => {
    const { result } = renderHook(() => useStartPlanRecommendation(view));
    let pending!: ReturnType<typeof result.current>;
    await act(async () => {
      pending = result.current(paid);
    });
    await expect(result.current(paid)).resolves.toBeNull();
    act(() => useConfirmDialogStore.getState().settleChoice("cancel"));
    await expect(pending).resolves.toEqual(paid);
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it("额度QueryFailed不会阻断原Submit", async () => {
    fixture.error = "offline";
    const { result } = renderHook(() => useStartPlanRecommendation(view));
    await expect(result.current(paid)).resolves.toEqual(paid);
    expect(useConfirmDialogStore.getState().pendingRequest).toBeUndefined();
  });
  it("偏OKReadFailedSkip推荐，Retain原付费Submit", async () => {
    fixture.readError = true;
    const { result } = renderHook(() => useStartPlanRecommendation(view));
    await expect(result.current(paid)).resolves.toEqual(paid);
    expect(useConfirmDialogStore.getState().pendingRequest).toBeUndefined();
  });
  it.each(["confirm", "cancel"] as const)(
    "Save偏OKFailed仍遵守本次 %s，并Notice没有Save成功",
    async (choice) => {
      fixture.update.mockRejectedValue(new Error("disk unavailable"));
      const { result } = renderHook(() => useStartPlanRecommendation(view));
      let pending!: ReturnType<typeof result.current>;
      await act(async () => {
        pending = result.current(paid);
      });
      act(() => {
        useConfirmDialogStore.getState().pendingRequest?.checkbox?.onCheckedChange(true);
        useConfirmDialogStore.getState().settleChoice(choice);
      });
      await expect(pending).resolves.toEqual(choice === "confirm" ? start : paid);
      expect(fixture.dismissed).toBe(false);
      expect(fixture.toast).toHaveBeenCalledExactlyOnceWith(
        "startPlan.recommendation.preferenceSaveFailed",
      );
    },
  );
  it("原Two元确认CompatibleClose行为", async () => {
    const pending = useConfirmDialogStore.getState().requestConfirmation({ title: "delete" });
    useConfirmDialogStore.getState().settleChoice("dismiss");
    await expect(pending).resolves.toBe(false);
  });
});
