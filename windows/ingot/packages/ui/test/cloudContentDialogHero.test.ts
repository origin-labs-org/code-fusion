// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOUD_HERO_MESSAGE_CHANNEL,
  CloudDialogHero,
  isTrustedCloudHeroMessage,
} from "@/components/cloud-content-dialog/CloudDialogHero.js";
import { createWeekendPlanResultDialogMock } from "./helpers/weekendPlanDialogFixture.js";

const mockInput = {
  locale: "zh-CN" as const,
  planName: "Weekend Plan",
  amountLabel: "300,000,000 Tokens",
  benefits: ["GLM-5.3-Flash daily quota"],
  endsAtLabel: "Sep 4, 2026, 23:59",
  title: "Weekend Plan 领取成功",
  description: "GLM-5.3-Flash is ready to use.",
  replayLabel: "重新播放票券动画",
  confirmLabel: "模型设置",
  shareLabel: "Copy and share",
  shareText: "Weekend Plan share content",
};

afterEach(() => cleanup());

describe("CloudDialogHero", () => {
  it("drops undeclared actions and falls back when ready times out", () => {
    vi.useFakeTimers();
    try {
      const payload = createWeekendPlanResultDialogMock(mockInput);
      const onAction = vi.fn();
      render(
        createElement(CloudDialogHero, {
          hero: payload.dialog.hero,
          locale: "en-US",
          title: "Timeout hero",
          onAction,
        }),
      );
      const frame = screen.getByTitle("Timeout hero") as HTMLIFrameElement;
      act(() =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: {
              channel: CLOUD_HERO_MESSAGE_CHANNEL,
              instanceId: frame.dataset.instanceId,
              type: "action",
              id: "claim-plan",
            },
          }),
        ),
      );
      expect(onAction).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(5_001));
      expect(screen.queryByTestId("cloud-dialog-interactive-hero")).toBeNull();
      expect(screen.getByTestId("cloud-dialog-hero-error")).toBeTruthy();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });
  it("Load interactive resources using iframe without same-origin permissions and send initialization data", () => {
    const payload = createWeekendPlanResultDialogMock(mockInput);
    render(
      createElement(CloudDialogHero, {
        hero: payload.dialog.hero,
        locale: "zh-CN",
        title: "Weekend Hero",
      }),
    );

    const frame = screen.getByTitle("Weekend Hero") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.dataset.heroType).toBe("interactive_bundle");
    expect(frame.dataset.status).toBe("loading");

    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.load(frame);

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: CLOUD_HERO_MESSAGE_CHANNEL,
        type: "init",
        locale: "zh-CN",
        data: expect.objectContaining({ planName: "Weekend Plan" }),
      }),
      "*",
    );
  });

  it("Only accept ready message matching current iframe and instanceId", async () => {
    const payload = createWeekendPlanResultDialogMock(mockInput);
    render(
      createElement(CloudDialogHero, {
        hero: payload.dialog.hero,
        locale: "zh-CN",
        title: "Weekend Hero",
      }),
    );
    const frame = screen.getByTitle("Weekend Hero") as HTMLIFrameElement;
    const instanceId = frame.dataset.instanceId!;

    expect(
      isTrustedCloudHeroMessage(
        {
          source: frame.contentWindow,
          data: {
            channel: CLOUD_HERO_MESSAGE_CHANNEL,
            type: "ready",
            instanceId: "stale-instance",
          },
        },
        frame.contentWindow,
        instanceId,
      ),
    ).toBe(false);
    expect(
      isTrustedCloudHeroMessage(
        {
          source: frame.contentWindow,
          data: {
            channel: CLOUD_HERO_MESSAGE_CHANNEL,
            type: "ready",
            instanceId,
          },
        },
        frame.contentWindow,
        instanceId,
      ),
    ).toBe(true);

    window.dispatchEvent(
      new MessageEvent("message", {
        source: frame.contentWindow,
        data: {
          channel: CLOUD_HERO_MESSAGE_CHANNEL,
          type: "ready",
          instanceId,
        },
      }),
    );
    await waitFor(() => expect(frame.dataset.status).toBe("ready"));
  });
});
