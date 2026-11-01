// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingSettingsSyncPatch } from "@origin-ai/cf-services";
import { useOnboardingTrigger } from "@/onboarding/useOnboardingTrigger.js";
import type { IOnboardingRecordService } from "@origin-ai/cf-services";

function createRecordService(
  overrides: Partial<IOnboardingRecordService> = {},
): IOnboardingRecordService {
  return {
    appendRecord: async () => {},
    dismissOnboarding: async () => {},
    claimAnonymousRecord: async () => {},
    shouldOnboard: async () => true,
    getLatestEntry: async () => null,
    syncSettingsFromRecord: async () => null,
    updateRecordPreferences: async () => {},
    getRecords: async () => null,
    clearRecords: async () => {},
    ...overrides,
  };
}

type TriggerProps = {
  service: IOnboardingRecordService | null;
  userId?: string | null;
};

function renderTrigger(options: TriggerProps) {
  const update = vi.fn(async () => {});
  const loadDeviceMid = () => "device-a";
  const utils = renderHook(
    ({ userId }: { userId: string | null }) =>
      useOnboardingTrigger({
        onboardingRecord: options.service,
        userId,
        loadDeviceMid,
        update,
      }),
    {
      initialProps: { userId: options.userId ?? null },
    },
  );
  return { ...utils, update };
}

describe("useOnboardingTrigger", () => {
  it("挂载不抛 hook 规则Error，并按 shouldOnboard=false OutputTriage", async () => {
    const service = createRecordService({ shouldOnboard: async () => false });
    const { result } = renderTrigger({ service });
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it("shouldOnboard=true 时Output需要Onboarding；markOnboarded 置回 false", async () => {
    const service = createRecordService({ shouldOnboard: async () => true });
    const { result } = renderTrigger({ service });
    await waitFor(() => expect(result.current[0]).toBe(true));
    act(() => {
      result.current[1]();
    });
    expect(result.current[0]).toBe(false);
  });

  it("ServiceUnavailable保守判不Onboarding，不依赖 settings", async () => {
    const { result } = renderTrigger({ service: null });
    await act(async () => {});
    expect(result.current[0]).toBe(false);
  });

  it("挂载首Run不回填 settings；userId Run时变化才按 record 回填", async () => {
    const patch: OnboardingSettingsSyncPatch = { onboardingOccupation: "finance" };
    const sync = vi.fn(async () => patch);
    const service = createRecordService({
      shouldOnboard: async () => false,
      syncSettingsFromRecord: sync,
    });
    const { result, rerender, update } = renderTrigger({ service, userId: null });

    rerender({ userId: "u1" });
    await waitFor(() => expect(result.current[0]).toBe(false));
    expect(sync).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();

    rerender({ userId: "u2" });
    await waitFor(() => expect(sync).toHaveBeenCalled());
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ onboardingOccupation: "finance" }),
      ),
    );
  });

  it("Sign Out（id→null）也按 null User的 record 回填", async () => {
    const patch: OnboardingSettingsSyncPatch = { onboardingOccupation: "other" };
    const sync = vi.fn(async () => patch);
    const service = createRecordService({
      shouldOnboard: async () => false,
      syncSettingsFromRecord: sync,
    });
    const { result, rerender, update } = renderTrigger({ service, userId: "u1" });
    await waitFor(() => expect(result.current[0]).toBe(false));
    rerender({ userId: null });
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining(patch)));
  });

  it("登录后先认领再Triage：认领使Triage不触发（同One人不重复Onboarding）", async () => {
    const calls: string[] = [];
    const service = createRecordService({
      claimAnonymousRecord: async () => {
        calls.push("claim");
      },
      shouldOnboard: async () => {
        calls.push("shouldOnboard");
        return true;
      },
    });
    const { result } = renderTrigger({ service, userId: "u1" });
    await waitFor(() => expect(result.current[0]).toBe(true));
    expect(calls.indexOf("claim")).toBeLessThan(calls.indexOf("shouldOnboard"));
  });

  it("shouldOnboard RPC 挂From时 3 秒超时保守判为不Onboarding", { timeout: 8000 }, async () => {
    const service = createRecordService({
      shouldOnboard: () => new Promise<boolean>(() => {}),
    });
    const { result } = renderTrigger({ service });
    await waitFor(() => expect(result.current[0]).toBe(false), { timeout: 5000 });
  });

  it(
    "超时保守Triage后真实Result到达会覆盖：真NewUser的Onboarding只Yes晚几秒出现",
    { timeout: 8000 },
    async () => {
      let resolveShouldOnboard: ((value: boolean) => void) | undefined;
      const service = createRecordService({
        shouldOnboard: () =>
          new Promise<boolean>((resolve) => {
            resolveShouldOnboard = resolve;
          }),
      });
      const { result } = renderTrigger({ service });
      await waitFor(() => expect(result.current[0]).toBe(false), { timeout: 5000 });
      await act(async () => {
        resolveShouldOnboard?.(true);
      });
      await waitFor(() => expect(result.current[0]).toBe(true));
    },
  );

  it("shouldOnboard Failed保守判不Onboarding，不Returned settings Triage", async () => {
    const service = createRecordService({
      shouldOnboard: () => Promise.reject(new Error("rpc failed")),
    });
    const { result } = renderTrigger({ service });
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it(
    "userId 变化Rerun不Reset放行Budget：主Boundary面总Waiting不超过首个Triage轮的 3 秒",
    { timeout: 8000 },
    async () => {
      vi.useFakeTimers();
      try {
        const service = createRecordService({
          claimAnonymousRecord: () => new Promise<void>(() => {}),
          shouldOnboard: () => new Promise<boolean>(() => {}),
        });
        const { result, rerender } = renderTrigger({ service });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2900);
        });
        rerender({ userId: "u2" });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(200);
        });
        expect(result.current[0]).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it(
    "已有TriageResult时后续轮次的超时兜底不再生效，不翻掉In progress的Onboarding",
    { timeout: 8000 },
    async () => {
      vi.useFakeTimers();
      try {
        let calls = 0;
        const service = createRecordService({
          shouldOnboard: () => {
            calls += 1;
            return calls === 1 ? Promise.resolve(true) : new Promise<boolean>(() => {});
          },
        });
        const { result, rerender } = renderTrigger({ service });
        await act(async () => {});
        expect(result.current[0]).toBe(true);
        rerender({ userId: "u2" });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3500);
        });
        expect(result.current[0]).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("userId 变化会RerunTriage（幂等Round 2）", async () => {
    let calls = 0;
    const service = createRecordService({
      shouldOnboard: async () => {
        calls += 1;
        return calls > 1;
      },
    });
    const { result, rerender } = renderTrigger({ service, userId: "u1" });
    await waitFor(() => expect(result.current[0]).toBe(false));
    rerender({ userId: "u2" });
    await waitFor(() => expect(result.current[0]).toBe(true));
    expect(calls).toBe(2);
  });
});
