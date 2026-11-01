// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WebRemoteControlDeviceListPage,
  WebRemoteControlFailureScreen,
} from "#src/web-remote-control/views.js";

afterEach(cleanup);

describe.each(["zh-CN", "en-US"] as const)("%s 手动切换账Number确认", (locale) => {
  it.each(["devices", "failure"])("%s CancelRetain登录，只有确认才调用Exit", async (source) => {
    const onSwitch = vi.fn();
    const label = locale === "zh-CN" ? "切换账Number" : "切换账号";
    render(
      source === "devices"
        ? createElement(WebRemoteControlDeviceListPage, {
            locale,
            view: { kind: "devices", devices: [], loading: false, error: false },
            onSwitchAccount: onSwitch,
            onRefresh: vi.fn(),
            onSelect: vi.fn(),
          })
        : createElement(WebRemoteControlFailureScreen, {
            locale,
            failure: { reason: "device-not-owned" },
            primaryActionLabel: label,
            onReload: onSwitch,
          }),
    );
    const trigger = screen.getByRole("button", { name: label, exact: true });
    fireEvent.click(trigger);
    expect(onSwitch).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain(
      locale === "zh-CN" ? "电脑端仍保持登录" : "Your computer will stay signed in",
    );
    const cancel = screen.getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(onSwitch).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSwitch).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "zh-CN" ? "Exit并切换" : "Sign out & switch",
      }),
    );
    expect(onSwitch).toHaveBeenCalledOnce();
  });
});

it("非账Number归属Failed的Retry不弹出确认", () => {
  const onReload = vi.fn();
  render(
    createElement(WebRemoteControlFailureScreen, {
      locale: "zh-CN",
      failure: { reason: "desktop-disconnected" },
      onReload,
    }),
  );
  fireEvent.click(screen.getByRole("button"));
  expect(onReload).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
});
