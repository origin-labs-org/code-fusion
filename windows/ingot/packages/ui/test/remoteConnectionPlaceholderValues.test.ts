import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import zhCN from "@/i18n/locales/zh-CN.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) => {
        let message = (zhCN as Record<string, string>)[id] ?? id;
        if (values) {
          for (const [key, value] of Object.entries(values)) {
            message = message.replaceAll(`{${key}}`, String(value));
          }
        }
        return message;
      },
    },
    locale: "zh-CN",
  }),
}));

vi.mock("@/DirectoryBrowser.js", () => ({
  DirectoryBrowser: () => createElement("div", { "data-testid": "directory-browser" }),
}));

vi.mock("@/RemoteConnectionFields.js", () => ({
  RemoteConnectionFields: () => createElement("div", { "data-testid": "remote-connection-fields" }),
}));

vi.mock("@/settings/RemoteSyncActions.js", () => ({
  RemoteSyncDialogs: () => createElement("div", { "data-testid": "remote-sync-dialogs" }),
  RemoteSyncDropdownButton: () => createElement("button", { type: "button" }, "sync"),
  shouldShowRemoteSyncActions: () => false,
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({}),
}));

vi.mock("@/feedback/feedbackStore.js", () => ({
  useFeedbackStore: (selector: (state: unknown) => unknown) => selector({ openSubmit: vi.fn() }),
}));

import { RemoteConnectionDirectoryStep } from "@/RemoteConnectionDialogContent.js";
import { RemoteConnectionConnectingStep } from "@/remote-connection/RemoteConnectionConnectingStep.js";

describe("remote connection dialog placeholder values", () => {
  it("shows connection and version in the banner without repeating the device", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteConnectionDirectoryStep, {
        services: {} as never,
        remoteTarget: { kind: "ssh", host: "example.com", username: "dev" },
        deviceName: "dev",
        profileName: "home-lab",
        deviceVersion: "3.8.1",
        onSelect: vi.fn(),
        onBack: vi.fn(),
        onCancel: vi.fn(),
      }),
    );

    expect(html).toContain("已连接");
    expect(html).toContain("home-lab");
    expect(html).toContain("v3.8.1");
    expect(html).not.toContain("已连接 dev");
    expect(html).not.toMatch(/\{(?:device|profile|version)\}/u);
  });

  it("interpolates the recognized device card title and profile body", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteConnectionConnectingStep, {
        kind: "ssh",
        logs: [],
        errorMessage: "",
        loading: false,
        recognizedDeviceName: "dev",
        profileName: "home-lab",
        onBack: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(html).toContain("已连接设备 dev");
    expect(html).not.toContain("remote.recognizedDeviceBody");
    expect(html).not.toMatch(/\{(?:device|profile)\}/u);
  });

  it("Replace invalid retries with in-place update when versions are incompatible", () => {
    const html = renderToStaticMarkup(
      createElement(RemoteConnectionConnectingStep, {
        kind: "ssh",
        logs: [],
        errorMessage: "Remote device version is incompatible",
        loading: false,
        upgradeRequired: true,
        onUpgrade: vi.fn(),
        onBack: vi.fn(),
        onRetry: vi.fn(),
      }),
    );

    expect(html).toContain("Update Remote");
    expect(html).not.toMatch(/>Retry<\/button>/u);
  });
});
