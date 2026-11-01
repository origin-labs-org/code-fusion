import type { IBroadcastService } from "@origin-ai/cf-services";
import type { IPlatformService } from "@origin-ai/cf-shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildChangeSummaryDiffViewerSource,
  buildChangeSummaryFilePreviewSource,
  MessageChangeSummaryPanel,
  openChangeSummaryDiffViewer,
} from "@/MessageChangeSummaryPanel.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { StoreProvider } from "@/store/StoreProvider.js";

const localStorageState = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageState.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageState.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageState.delete(key);
    },
    clear: () => {
      localStorageState.clear();
    },
  },
});

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    documentElement: {
      classList: {
        contains: () => false,
        toggle: () => {},
      },
    },
  },
});

const mockBroadcastService: IBroadcastService = {
  send: async () => {},
  onMessage: () => ({ dispose: () => {} }),
};

const mockPlatform = {
  selectDirectory: async () => null,
  selectFile: async () => null,
  onRemoteConnectionLog: () => () => {},
  onRemoteSessionClosed: () => () => {},
  activateOrSetWorkspace: async () => ({ activated: false }),
  connectRemote: async () => ({ success: true }),
  startWebRemoteControl: async () => ({
    status: "running" as const,
    sessionId: "session-1",
    qrUrl: "qr://session-1",
    connectUrl: "https://example.com/connect",
    workspacePath: "/workspace",
  }),
  stopWebRemoteControl: async () => {},
  getWebRemoteControlStatus: async () => ({ status: "idle" as const }),
  disposeRemoteSession: async () => {},
  isDockerAvailable: async () => false,
  listWSLDistros: async () => [],
  listDockerContainers: async () => [],
  listSSHConfigAliases: async () => [],
  openExternal: () => {},
  openFeedback: async () => {},
  openCommunity: async () => {},
  canOpenCommunity: async () => false,
  openInFileManager: async () => ({ success: true }),
  openInEditor: async () => ({ success: true }),
  registerOAuthState: () => {},
  onOAuthCallback: () => () => {},
  notifyRendererReady: () => {},
  showTaskNotification: () => {},
  reportTelemetryEvent: async () => {},
  syncWindowTabs: () => {},
  syncWindowUnreadCount: () => {},
  onFocusTab: () => () => {},
  onNewTab: () => () => {},
  onNewTask: () => () => {},
  onOpenWorkspace: () => () => {},
  onWindowFullscreenChanged: () => () => {},
  onTaskNotificationClick: () => () => {},
  exportLogs: async () => ({ success: true }),
  onUpdateReady: () => () => {},
  onUpdateCheckResult: () => () => {},
  onPostUpdateReleaseNotes: () => () => {},
  acknowledgePostUpdateReleaseNotes: async () => {},
  quitAndInstallUpdate: async () => {},
  getInstalledEditors: async () => [],
  executeDesktopCommand: async () => {},
  setApplicationLocale: async () => {},
  setTitleBarTheme: async () => {},
} as unknown as IPlatformService;

type PanelProps = Parameters<typeof MessageChangeSummaryPanel>[0];

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const defaultProps: PanelProps = {
    summary: {
      fileCount: 1,
      added: 2,
      removed: 1,
      files: [
        {
          path: "/workspace/src/MessageChangeSummaryPanel.tsx",
          added: 2,
          removed: 1,
          writeCount: 1,
          lastTurnIndex: 0,
        },
      ],
    },
    workspacePath: "/workspace",
    changeDetails: {
      turnIndex: 0,
      snapshots: [
        {
          path: "/workspace/src/MessageChangeSummaryPanel.tsx",
          beforeContent: "const next = 1;\nconsole.log(next);\n",
          afterContent: "const next = 2;\nconsole.log(next);\n",
          writeCount: 1,
        },
      ],
    },
  };

  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform: mockPlatform },
        createElement(
          StoreProvider,
          { broadcastService: mockBroadcastService },
          createElement(MessageChangeSummaryPanel, {
            ...defaultProps,
            ...overrides,
          }),
        ),
      ),
    ),
  );
}

describe("MessageChangeSummaryPanel", () => {
  beforeEach(() => {
    localStorageState.clear();
  });

  it("Default闭合ChangesFilelist，并且先HideUndo按钮", () => {
    const html = renderPanel();

    expect(html).toContain("1 个File changed");
    expect(html).toContain("+1");
    expect(html).toContain("-1");
    expect(html).toContain('aria-label="展开已更改文件"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-state="closed"');
    expect(html).toContain('data-slot="collapsible-content"');
    expect(html).toContain('hidden=""');
    expect(html).not.toContain("src/MessageChangeSummaryPanel.tsx");
    expect(html).not.toContain("打开");
    expect(html).not.toContain("选择打开方式");
  });

  it("优先ShowCurrent轮次的Summary，不把整个 session 的Summary混进来", () => {
    const html = renderPanel({
      summary: {
        fileCount: 2,
        added: 8,
        removed: 3,
        files: [
          {
            path: "/workspace/src/MessageChangeSummaryPanel.tsx",
            added: 2,
            removed: 1,
            writeCount: 1,
            lastTurnIndex: 1,
          },
          {
            path: "/workspace/src/App.tsx",
            added: 6,
            removed: 2,
            writeCount: 3,
            lastTurnIndex: 0,
          },
        ],
      },
      changeDetails: {
        turnIndex: 1,
        snapshots: [
          {
            path: "/workspace/src/MessageChangeSummaryPanel.tsx",
            beforeContent: "const next = 1;\n",
            afterContent: "const next = 2;\n",
            writeCount: 1,
          },
        ],
      },
    });

    expect(html).toContain("1 个File changed");
    expect(html).toContain("+1");
    expect(html).not.toContain("2 个File changed");
    expect(html).not.toContain("src/App.tsx");
    expect(html).not.toContain("+8");
  });

  it("为打开按钮构建 MultiFileDiff code-viewer source", () => {
    expect(
      buildChangeSummaryDiffViewerSource({
        relativePath: "src/App.tsx",
        snapshot: {
          path: "/workspace/src/App.tsx",
          beforeContent: "const value = 1;\n",
          afterContent: "const value = 2;\n",
          writeCount: 1,
        },
      }),
    ).toEqual({
      type: "multi-file-diff",
      title: "src/App.tsx",
      path: "/workspace/src/App.tsx",
      beforeContent: "const value = 1;\n",
      afterContent: "const value = 2;\n",
    });
  });

  it("为打开按钮构建普通File preview source", () => {
    expect(
      buildChangeSummaryFilePreviewSource({
        path: "/workspace/src/App.tsx",
        relativePath: "src/App.tsx",
        workspacePath: "/workspace",
        workspaceIdentity: "remote:ssh:host-a:/workspace",
        workspaceRemoteSessionId: "session-a",
      }),
    ).toEqual({
      type: "file",
      title: "src/App.tsx",
      path: "/workspace/src/App.tsx",
      workspacePath: "/workspace",
      workspaceIdentity: "remote:ssh:host-a:/workspace",
      workspaceRemoteSessionId: "session-a",
    });
  });

  it("为Tools聚合的 readonly patch 构建 patch preview source", () => {
    expect(
      buildChangeSummaryDiffViewerSource({
        relativePath: "src/App.tsx",
        path: "/workspace/src/App.tsx",
        snapshot: undefined,
        patch: "--- a/App.tsx\n+++ b/App.tsx\n@@ -1 +1 @@\n-old\n+new",
      }),
    ).toEqual({
      type: "patch",
      title: "src/App.tsx",
      path: "/workspace/src/App.tsx",
      patch: "--- a/App.tsx\n+++ b/App.tsx\n@@ -1 +1 @@\n-old\n+new",
    });
  });

  it("有 source and打开回调时委托One次，Missing任One时不调用", () => {
    const source = buildChangeSummaryDiffViewerSource({
      relativePath: "src/App.tsx",
      path: "/workspace/src/App.tsx",
      snapshot: undefined,
      patch: "--- a/App.tsx\n+++ b/App.tsx\n@@ -1 +1 @@\n-old\n+new",
    });
    const onOpenCodeViewer = vi.fn();

    expect(openChangeSummaryDiffViewer(source, onOpenCodeViewer)).toBe(true);
    expect(onOpenCodeViewer).toHaveBeenCalledWith(source);

    onOpenCodeViewer.mockClear();
    expect(openChangeSummaryDiffViewer(undefined, onOpenCodeViewer)).toBe(false);
    expect(openChangeSummaryDiffViewer(source, undefined)).toBe(false);
    expect(onOpenCodeViewer).not.toHaveBeenCalled();
  });

  it("Tools聚合Summary没有真实 checkpoint 时不展示Undo入口", () => {
    const html = renderPanel({
      changeDetails: null,
      onToggleFiles: vi.fn(),
      readonlyDiffPatchesByPath: new Map([
        [
          "/workspace/src/MessageChangeSummaryPanel.tsx",
          "--- a/MessageChangeSummaryPanel.tsx\n+++ b/MessageChangeSummaryPanel.tsx\n@@ -1 +1 @@\n-old\n+new",
        ],
      ]),
    });

    expect(html).toContain("1 个File changed");
    expect(html).not.toContain("撤销");
  });
});
