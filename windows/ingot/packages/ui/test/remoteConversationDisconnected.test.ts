// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import zhCN from "@/i18n/locales/zh-CN.js";
const ports = vi.hoisted(() => ({ reconnect: vi.fn(), details: vi.fn() }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: { formatMessage: ({ id }: { id: keyof typeof zhCN }) => zhCN[id] ?? id },
  }),
}));
vi.mock("@/project-sidebar/useRemoteProjectConnectionPresentation.js", () => ({
  useRemoteProjectConnectionPresentation: () => ({
    presentation: {
      status: "offline",
      icon: "cloud-off",
      tone: "neutral",
      messageId: "remote.status.offline",
      surface: "bg-surface",
      foreground: "text-foreground-subtle",
      primaryAction: "connect",
      actionMessageId: "remote.action.connect",
    },
    reconnect: ports.reconnect,
    tab: null,
    deviceName: "dev",
    error: undefined,
  }),
}));
import { RemoteConversationDisconnected } from "@/project-sidebar/RemoteConversationDisconnected.js";
import { persistV4ComposerDraft, readV4ComposerDraft } from "@/v4/composer/composerDraftStore.js";
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
describe("断线会话占位", () => {
  it("Shows reason, read-only draft, and reconnect entry; Enter does not submit, reconnecting preserves draft", () => {
    const identity = "remote:server:dev:/repo";
    persistV4ComposerDraft("/repo", identity, "task-a", { text: "保留这份草稿" });
    render(
      createElement(RemoteConversationDisconnected, {
        workspacePath: "/repo",
        workspaceIdentity: identity,
        sessionId: "task-a",
      }),
    );
    expect(screen.getByText("Device not connected. Connect to continue this session")).toBeTruthy();
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value).toBe("保留这份草稿");
    expect(input.readOnly).toBe(true);
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(ports.reconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    expect(ports.reconnect).toHaveBeenCalledOnce();
    expect(readV4ComposerDraft("/repo", identity, "task-a")?.text).toBe("保留这份草稿");
  });
});

it("Offline project placeholder has only a one-line connect entry and does not render stale tasks", async () => {
  const { OfflineRemoteProjectRows } =
    await import("@/project-sidebar/OfflineRemoteProjectRows.js");
  const reconnect = vi.fn();
  render(
    createElement(OfflineRemoteProjectRows, {
      workspaceTabs: [
        {
          id: "remote",
          kind: "workspace",
          label: "项目",
          workspacePath: "/repo",
          workspaceIdentity: "remote:server:dev:/repo",
        },
      ],
      onReconnect: reconnect,
    }),
  );
  fireEvent.click(screen.getByRole("button"));
  expect(reconnect).toHaveBeenCalledWith("remote:server:dev:/repo");
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
