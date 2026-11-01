// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type EmbeddedBrowserPermissionPromptEvent } from "@origin-ai/cf-shared";
import {
  TID_BROWSER_PERMISSION_ALLOW_ALWAYS,
  TID_BROWSER_PERMISSION_ALLOW_ONCE,
  TID_BROWSER_PERMISSION_DENY,
  TID_BROWSER_PERMISSION_DISMISS,
  TID_BROWSER_PERMISSION_PROMPTS,
} from "@origin-ai/cf-shared/test-ids";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { useEmbeddedBrowserPermissionStore } from "@/store/embeddedBrowserPermissionStore.js";

function pushDeviceListUpdate(requestId: string, devices: Array<{ deviceId: string; name?: string }>) {
  useEmbeddedBrowserPermissionStore
    .getState()
    .receivePrompt({
      requestId,
      kind: "device",
      origin: "https://example.com",
      permission: "select-bluetooth-device",
      devices,
    });
}

const resolveEmbeddedBrowserPermissionPrompt = vi.fn();

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    onEmbeddedBrowserPermissionPrompt: () => () => undefined,
    resolveEmbeddedBrowserPermissionPrompt,
  }),
}));

const { EmbeddedBrowserPermissionPrompts } = await import(
  "@/browser-use/EmbeddedBrowserPermissionPrompts.js"
);

function renderWithPrompts(
  prompts: EmbeddedBrowserPermissionPromptEvent[],
  guestWebContentsId?: number,
) {
  useEmbeddedBrowserPermissionStore.setState({ prompts });
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(EmbeddedBrowserPermissionPrompts, { guestWebContentsId }),
    ),
  );
}

const permissionPrompt: EmbeddedBrowserPermissionPromptEvent = {
  requestId: "req-1",
  kind: "permission",
  origin: "https://example.com",
  permission: "media",
  mediaTypes: ["video"],
};

beforeEach(() => {
  useEmbeddedBrowserPermissionStore.setState({ prompts: [] });
  resolveEmbeddedBrowserPermissionPrompt.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("EmbeddedBrowserPermissionPrompts Chrome 式权限气泡", () => {
  it("无请求时不渲染气泡", () => {
    renderWithPrompts([]);
    expect(screen.queryByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeNull();
  });

  it("渲染 origin、按 mediaTypes 细分的权限名与 阻止/允许/✕ 按钮", () => {
    renderWithPrompts([permissionPrompt]);
    expect(screen.getByText("https://example.com")).toBeTruthy();
    expect(screen.getByText("摄像头")).toBeTruthy();
    expect(screen.queryByText("摄像头和麦克风")).toBeNull();
    expect(screen.getByRole("button", { name: "不允许" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "仅本次允许" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "访问此网站时允许" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "阻止" })).toBeNull();
    expect(screen.getByTestId(TID_BROWSER_PERMISSION_DISMISS)).toBeTruthy();
  });

  it("clipboard-read 显示「读取剪贴板」", () => {
    renderWithPrompts([
      { ...permissionPrompt, permission: "clipboard-read", mediaTypes: undefined },
    ]);
    expect(screen.getByText("读取剪贴板")).toBeTruthy();
  });

  it("「仅本次允许」回传 allow-session 并出队", () => {
    renderWithPrompts([permissionPrompt]);
    fireEvent.click(screen.getByTestId(TID_BROWSER_PERMISSION_ALLOW_ONCE));
    expect(resolveEmbeddedBrowserPermissionPrompt).toHaveBeenCalledWith({
      requestId: "req-1",
      resolution: { action: "allow-session" },
    });
    expect(screen.queryByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeNull();
  });

  it("「访问此网站时允许」回传 allow-always", () => {
    renderWithPrompts([permissionPrompt]);
    fireEvent.click(screen.getByTestId(TID_BROWSER_PERMISSION_ALLOW_ALWAYS));
    expect(resolveEmbeddedBrowserPermissionPrompt).toHaveBeenCalledWith({
      requestId: "req-1",
      resolution: { action: "allow-always" },
    });
  });

  it("「不允许」回传 dismiss（本次拒绝，不记忆）", () => {
    renderWithPrompts([permissionPrompt]);
    fireEvent.click(screen.getByTestId(TID_BROWSER_PERMISSION_DENY));
    expect(resolveEmbeddedBrowserPermissionPrompt).toHaveBeenCalledWith({
      requestId: "req-1",
      resolution: { action: "dismiss" },
    });
    expect(screen.queryByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeNull();
  });

  it("permission 请求按 guest 归属过滤：后台 tab 的请求不在当前 tab 渲染", () => {
    renderWithPrompts(
      [{ ...permissionPrompt, guestWebContentsId: 99 }],
      42,
    );
    expect(screen.queryByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeNull();

    cleanup();
    renderWithPrompts(
      [{ ...permissionPrompt, guestWebContentsId: 42 }],
      42,
    );
    expect(screen.getByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeTruthy();
    expect(screen.getByText("https://example.com")).toBeTruthy();

    cleanup();
    renderWithPrompts([permissionPrompt], 42);
    expect(screen.getByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeTruthy();

    cleanup();
    renderWithPrompts([{ ...permissionPrompt, guestWebContentsId: 99 }], undefined);
    expect(screen.queryByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeNull();
  });

  it("✕ 关闭回传 dismiss（本次拒绝，不记忆）", () => {
    renderWithPrompts([permissionPrompt]);
    fireEvent.click(screen.getByTestId(TID_BROWSER_PERMISSION_DISMISS));
    expect(resolveEmbeddedBrowserPermissionPrompt).toHaveBeenCalledWith({
      requestId: "req-1",
      resolution: { action: "dismiss" },
    });
    expect(screen.queryByTestId(TID_BROWSER_PERMISSION_PROMPTS)).toBeNull();
  });

  it("media 同时申请摄像头与麦克风时能力列表列两行", () => {
    renderWithPrompts([{ ...permissionPrompt, mediaTypes: ["video", "audio"] }]);
    expect(screen.getByText("摄像头")).toBeTruthy();
    expect(screen.getByText("麦克风")).toBeTruthy();
    expect(screen.queryByText("摄像头和麦克风")).toBeNull();
  });

  it("不同请求可并存渲染", () => {
    renderWithPrompts([
      permissionPrompt,
      { ...permissionPrompt, requestId: "req-2", permission: "geolocation" },
    ]);
    expect(screen.getByText("摄像头")).toBeTruthy();
    expect(screen.getByText("位置信息")).toBeTruthy();
  });
});

describe("EmbeddedBrowserPermissionPrompts 选择器弹窗", () => {
  it("屏幕共享弹窗按「整个屏幕 / 窗口」分组列出源", () => {
    renderWithPrompts([
      {
        requestId: "req-share",
        kind: "screen-share",
        origin: "https://meet.example.com",
        screens: [
          {
            sourceId: "screen:1",
            name: "Entire Screen",
            kind: "screen",
            thumbnailDataUrl: "data:image/jpeg;base64,AAAA",
          },
          { sourceId: "window:2", name: "Doc — Preview", kind: "window" },
          { sourceId: "window:3", name: "Terminal", kind: "window" },
        ],
      },
    ]);
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent?.includes("https://meet.example.com") ?? false,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("整个屏幕")).toBeTruthy();
    expect(screen.getByText("窗口")).toBeTruthy();
    expect(screen.getByText("Doc — Preview")).toBeTruthy();
    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.getByRole("button", { name: "共享" })).toBeTruthy();
  });

  it("同 requestId 的推送热更新设备列表（蓝牙扫描渐进出设备）", async () => {
    renderWithPrompts([
      {
        requestId: "req-bt",
        kind: "device",
        origin: "https://example.com",
        permission: "select-bluetooth-device",
        devices: [],
      },
    ]);
    expect(screen.queryByText("Headphones")).toBeNull();

    pushDeviceListUpdate("req-bt", [{ deviceId: "bt-1", name: "Headphones" }]);
    await waitFor(() => expect(screen.getByText("Headphones")).toBeTruthy());
  });

  it("设备选择弹窗列出设备名与厂商/序列号元信息，未选中时连接按钮禁用", () => {
    renderWithPrompts([
      {
        requestId: "req-device",
        kind: "device",
        origin: "https://example.com",
        permission: "select-hid-device",
        devices: [
          {
            deviceId: "dev-1",
            name: "Ledger Nano",
            vendorId: 0x2c97,
            productId: 0x0001,
            serialNumber: "SN123",
          },
        ],
      },
    ]);
    expect(screen.getByText("Ledger Nano")).toBeTruthy();
    expect(screen.getByText("2c97:0001 · SN123")).toBeTruthy();

    const connectButton = screen.getByRole("button", { name: "连接" });
    expect((connectButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Ledger Nano"));
    expect((connectButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(connectButton);
    expect(resolveEmbeddedBrowserPermissionPrompt).toHaveBeenCalledWith({
      requestId: "req-device",
      resolution: { action: "select-device", deviceId: "dev-1" },
    });
  });
});
