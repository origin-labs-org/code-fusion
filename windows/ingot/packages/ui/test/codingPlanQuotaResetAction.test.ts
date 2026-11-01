// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodingPlanQuotaResetAction } from "@/components/coding-plan-quota-reset/CodingPlanQuotaResetAction.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";

function installAnimationFrameController() {
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    callbacks.set(frameId, callback);
    return frameId;
  });
  const cancelAnimationFrame = vi.fn((frameId: number) => {
    callbacks.delete(frameId);
  });
  vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

  return {
    cancelAnimationFrame,
    flush() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pendingCallbacks) {
        callback(performance.now());
      }
    },
  };
}

describe("CodingPlanQuotaResetAction", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
  });

  it("Page reset entry points only open the unified modal without directly redeeming", () => {
    const onOpenDialog = vi.fn();
    render(
      createElement(CodingPlanQuotaResetAction, {
        ariaLabel: "Reset 5-Hour Quota",
        completedAt: null,
        completedLabel: "已重置",
        processing: false,
        processingLabel: "正在重置",
        resetLabel: "重置",
        successLabel: "Reset Successful",
        onOpenDialog,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset 5-Hour Quota" }));
    expect(onOpenDialog).toHaveBeenCalledTimes(1);
  });

  it("Show a brief success checkmark with confetti after server reset succeeds, then enter the Reset state", async () => {
    vi.useFakeTimers();
    let resolveReset!: () => void;
    const onReset = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    );
    const celebrate = vi.fn();

    const view = render(
      createElement(CodingPlanQuotaResetAction, {
        ariaLabel: "Reset 5-Hour Quota",
        completedAt: null,
        completedLabel: "已重置",
        processing: false,
        processingLabel: "正在重置",
        resetLabel: "重置",
        successLabel: "Reset Successful",
        onReset,
        onCelebrate: celebrate,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset 5-Hour Quota" }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(celebrate).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "正在重置" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await act(async () => resolveReset());
    view.rerender(
      createElement(CodingPlanQuotaResetAction, {
        ariaLabel: "Reset 5-Hour Quota",
        completedAt: new Date("2026-08-07T19:08:01+08:00").getTime(),
        completedLabel: "已重置",
        processing: false,
        processingLabel: "正在重置",
        resetLabel: "重置",
        successLabel: "Reset Successful",
        onReset,
        onCelebrate: celebrate,
      }),
    );

    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reset Successful" })).toBeTruthy();
    expect(screen.queryByText("已重置")).toBeNull();

    act(() => vi.advanceTimersByTime(599));
    expect(screen.getByRole("button", { name: "Reset Successful" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText("已重置")).toBeTruthy();
  });

  it("Restore clickability after request failure without showing success state or confetti", async () => {
    const onReset = vi.fn(async () => {
      throw new Error("reset failed");
    });
    const celebrate = vi.fn();

    render(
      createElement(CodingPlanQuotaResetAction, {
        ariaLabel: "Reset 5-Hour Quota",
        completedAt: null,
        completedLabel: "已重置",
        processing: false,
        processingLabel: "正在重置",
        resetLabel: "重置",
        successLabel: "Reset Successful",
        onReset,
        onCelebrate: celebrate,
      }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reset 5-Hour Quota" }));
    });

    expect(
      (screen.getByRole("button", { name: "Reset 5-Hour Quota" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByRole("status")).toBeNull();
    expect(celebrate).not.toHaveBeenCalled();
  });

  it("Completed state will not provide the consume button again", () => {
    render(
      createElement(CodingPlanQuotaResetAction, {
        ariaLabel: "Reset 5-Hour Quota",
        completedAt: new Date("2026-08-07T19:08:00+08:00").getTime(),
        completedLabel: "已重置",
        processing: false,
        processingLabel: "正在重置",
        resetLabel: "重置",
        successLabel: "Reset Successful",
        onReset: vi.fn(async () => undefined),
      }),
    );

    expect(screen.queryByRole("button", { name: "Reset 5-Hour Quota" })).toBeNull();
    expect(screen.getByText("已重置")).toBeTruthy();
  });

  it("When a replay signal is received for auto/operational completion, wait one frame after overlay anchor mounts to replay confetti once without looping", () => {
    const animationFrame = installAnimationFrameController();
    const completedAt = new Date("2026-08-07T19:08:00+08:00").getTime();
    const celebrate = vi.fn();
    const onAutoCelebrated = vi.fn();
    const props = {
      ariaLabel: "Reset 5-Hour Quota",
      autoCelebrateCompletedAt: completedAt,
      completedAt,
      completedLabel: "已重置",
      processing: false,
      processingLabel: "正在重置",
      resetLabel: "重置",
      successLabel: "Reset Successful",
      onAutoCelebrated,
      onReset: vi.fn(async () => undefined),
      onCelebrate: celebrate,
    };

    const view = render(createElement(CodingPlanQuotaResetAction, props));

    expect(celebrate).not.toHaveBeenCalled();
    expect(onAutoCelebrated).not.toHaveBeenCalled();

    act(() => animationFrame.flush());
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate.mock.calls[0]?.[0]).toBeInstanceOf(HTMLElement);
    expect(onAutoCelebrated).toHaveBeenCalledTimes(1);
    expect(onAutoCelebrated).toHaveBeenCalledWith(completedAt);

    view.rerender(createElement(CodingPlanQuotaResetAction, props));
    expect(celebrate).toHaveBeenCalledTimes(1);
  });

  it("When Reset copy includes a time Tooltip, it must also wait for the anchor to mount before replaying confetti", () => {
    const animationFrame = installAnimationFrameController();
    const completedAt = new Date("2026-08-17T12:00:00+08:00").getTime();
    const celebrate = vi.fn();
    const onAutoCelebrated = vi.fn();

    render(
      createElement(
        TooltipProvider,
        null,
        createElement(CodingPlanQuotaResetAction, {
          ariaLabel: "Reset 5-Hour Quota",
          autoCelebrateCompletedAt: completedAt,
          completedAt,
          completedLabel: "已重置",
          completedTooltipLabel: "Reset time: 12:00",
          processing: false,
          processingLabel: "正在重置",
          resetLabel: "重置",
          successLabel: "Reset Successful",
          onAutoCelebrated,
          onReset: vi.fn(async () => undefined),
          onCelebrate: celebrate,
        }),
      ),
    );

    expect(celebrate).not.toHaveBeenCalled();
    expect(onAutoCelebrated).not.toHaveBeenCalled();

    act(() => animationFrame.flush());
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate.mock.calls[0]?.[0]).toBe(screen.getByText("已重置"));
    expect(onAutoCelebrated).toHaveBeenCalledWith(completedAt);
  });

  it("浮层在补播帧前关闭时不消费自动撒花机会", () => {
    const animationFrame = installAnimationFrameController();
    const completedAt = new Date("2026-08-17T12:00:00+08:00").getTime();
    const celebrate = vi.fn();
    const onAutoCelebrated = vi.fn();

    const view = render(
      createElement(CodingPlanQuotaResetAction, {
        ariaLabel: "Reset 5-Hour Quota",
        autoCelebrateCompletedAt: completedAt,
        completedAt,
        completedLabel: "已重置",
        processing: false,
        processingLabel: "正在重置",
        resetLabel: "重置",
        successLabel: "Reset Successful",
        onAutoCelebrated,
        onReset: vi.fn(async () => undefined),
        onCelebrate: celebrate,
      }),
    );

    view.unmount();
    act(() => animationFrame.flush());

    expect(animationFrame.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(celebrate).not.toHaveBeenCalled();
    expect(onAutoCelebrated).not.toHaveBeenCalled();
  });

  it("补播信号与当前 completedAt 不一致或未 arm 时不补播撒花", () => {
    const celebrate = vi.fn();
    const onAutoCelebrated = vi.fn();

    render(
      createElement(CodingPlanQuotaResetAction, {
        ariaLabel: "Reset 5-Hour Quota",
        autoCelebrateCompletedAt: 111,
        completedAt: 222,
        completedLabel: "已重置",
        processing: false,
        processingLabel: "正在重置",
        resetLabel: "重置",
        successLabel: "Reset Successful",
        onAutoCelebrated,
        onReset: vi.fn(async () => undefined),
        onCelebrate: celebrate,
      }),
    );

    expect(celebrate).not.toHaveBeenCalled();
    expect(onAutoCelebrated).not.toHaveBeenCalled();
  });
});
