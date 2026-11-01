import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CfProvider } from "@origin-ai/cf-shared";
import {
  resolveProviderConfigOpenTargetPath,
  useTaskListItemContextActions,
} from "@/useTaskListItemContextActions.js";

const {
  mockUseWorkspaceProviderConfigFile,
  mockGetInstalledEditors,
  mockOpenInEditor,
  mockOpenInFileManager,
  mockReadLastSelectedEditorId,
  mockUseWorkspaceOpenInEditorTarget,
} = vi.hoisted(() => ({
  mockUseWorkspaceProviderConfigFile: vi.fn(),
  mockGetInstalledEditors: vi.fn(),
  mockOpenInEditor: vi.fn(),
  mockOpenInFileManager: vi.fn(),
  mockReadLastSelectedEditorId: vi.fn(),
  mockUseWorkspaceOpenInEditorTarget: vi.fn(),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    getInstalledEditors: mockGetInstalledEditors,
    openInEditor: mockOpenInEditor,
    openInFileManager: mockOpenInFileManager,
  }),
}));

vi.mock("@/hooks/useTaskSessionFilePath.js", () => ({
  useTaskSessionFilePath: () => ({
    path: null,
    exists: false,
    loading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useTaskNativeSessionLogFile.js", () => ({
  useTaskNativeSessionLogFile: () => ({
    provider: null,
    path: null,
    exists: false,
    loading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useWorkspaceProviderConfigFile.js", () => ({
  useWorkspaceProviderConfigFile: (...args: unknown[]) =>
    mockUseWorkspaceProviderConfigFile(...args),
}));

vi.mock("@/hooks/useWorkspaceOpenInEditorTarget.js", () => ({
  useWorkspaceOpenInEditorTarget: (...args: unknown[]) =>
    mockUseWorkspaceOpenInEditorTarget(...args),
}));

vi.mock("@/lib/editorPreference.js", () => ({
  readLastSelectedEditorId: mockReadLastSelectedEditorId,
}));

vi.mock("@/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let latestResult: ReturnType<typeof useTaskListItemContextActions> | null = null;

function HookProbe({
  workspacePath,
  remoteSessionId,
  workspaceIdentity,
  provider,
  loadProviderConfig,
}: {
  workspacePath: string;
  remoteSessionId?: string;
  workspaceIdentity?: string;
  provider?: CfProvider;
  loadProviderConfig?: boolean;
}) {
  latestResult = useTaskListItemContextActions({
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
    taskId: "task-1",
    provider,
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
    loadProviderConfig,
  });

  return createElement("div");
}

describe("useTaskListItemContextActions", () => {
  beforeEach(() => {
    latestResult = null;
    mockUseWorkspaceProviderConfigFile.mockReset();
    mockUseWorkspaceProviderConfigFile.mockReturnValue({
      path: "/tmp/provider-config.toml",
      exists: true,
      loading: false,
      error: null,
    });
    mockGetInstalledEditors.mockReset();
    mockGetInstalledEditors.mockResolvedValue([]);
    mockOpenInEditor.mockReset();
    mockOpenInEditor.mockResolvedValue({ success: true });
    mockOpenInFileManager.mockReset();
    mockOpenInFileManager.mockResolvedValue({ success: true });
    mockReadLastSelectedEditorId.mockReset();
    mockReadLastSelectedEditorId.mockReturnValue(null);
    mockUseWorkspaceOpenInEditorTarget.mockReset();
    mockUseWorkspaceOpenInEditorTarget.mockReturnValue({
      isRemoteWorkspace: false,
      remoteTarget: undefined,
    });
  });

  it("RemoteSession下 provider Configuration路径应走 base service Scope", () => {
    renderToStaticMarkup(
      createElement(HookProbe, {
        workspacePath: "/workspace/remote",
        remoteSessionId: "remote-session-1",
        workspaceIdentity: "remote:ssh:127.0.0.1:22:dev:/workspace/remote",
        provider: "codex",
      }),
    );

    expect(mockUseWorkspaceProviderConfigFile).toHaveBeenCalledWith(
      "/workspace/remote",
      "codex",
      "remote-session-1",
      "remote:ssh:127.0.0.1:22:dev:/workspace/remote",
      { serviceScope: "base", enabled: true },
    );
  });

  it("LocalSession下 provider Configuration路径Continue走 workspace Scope", () => {
    renderToStaticMarkup(
      createElement(HookProbe, {
        workspacePath: "/workspace/local",
        provider: "claude",
      }),
    );

    expect(mockUseWorkspaceProviderConfigFile).toHaveBeenCalledWith(
      "/workspace/local",
      "claude",
      undefined,
      undefined,
      { serviceScope: "workspace", enabled: true },
    );
  });

  it("未打开Task菜单时延迟Read provider Configuration路径", () => {
    renderToStaticMarkup(
      createElement(HookProbe, {
        workspacePath: "/workspace/remote",
        remoteSessionId: "remote-session-1",
        workspaceIdentity: "remote:ssh:127.0.0.1:22:dev:/workspace/remote",
        provider: "codex",
        loadProviderConfig: false,
      }),
    );

    expect(mockUseWorkspaceProviderConfigFile).toHaveBeenCalledWith(
      "/workspace/remote",
      "codex",
      "remote-session-1",
      "remote:ssh:127.0.0.1:22:dev:/workspace/remote",
      { serviceScope: "base", enabled: false },
    );
  });

  it("WSL ProjectRight键Passed Explorer 打开RemoteTable of Contents并透传Workspace身份", async () => {
    const remoteTarget = {
      kind: "wsl" as const,
      distro: "Ubuntu-24.04",
      user: "dev",
    };
    mockUseWorkspaceOpenInEditorTarget.mockReturnValue({
      isRemoteWorkspace: true,
      remoteTarget,
    });

    renderToStaticMarkup(
      createElement(HookProbe, {
        workspacePath: "/workspace/remote",
        remoteSessionId: "remote-session-wsl",
        workspaceIdentity: "remote:wsl:Ubuntu-24.04:dev:/workspace/remote",
      }),
    );

    await latestResult!.handleOpenTaskPathInFileManager();

    expect(mockOpenInEditor).toHaveBeenCalledWith(
      "explorer",
      "/workspace/remote",
      {
        pathKind: "directory",
        remoteTarget,
        workspaceIdentity: "remote:wsl:Ubuntu-24.04:dev:/workspace/remote",
      },
    );
    expect(mockOpenInFileManager).not.toHaveBeenCalled();
  });

  it("SSH ProjectRight键不把Remote Linux 路径交ToLocal machineFileManage器", async () => {
    mockUseWorkspaceOpenInEditorTarget.mockReturnValue({
      isRemoteWorkspace: true,
      remoteTarget: {
        kind: "ssh",
        host: "dev.example.com",
        port: 22,
        username: "dev",
      },
    });

    renderToStaticMarkup(
      createElement(HookProbe, {
        workspacePath: "/workspace/remote",
        remoteSessionId: "remote-session-ssh",
        workspaceIdentity: "remote:ssh:dev.example.com:22:dev:/workspace/remote",
      }),
    );

    await latestResult!.handleOpenTaskPathInFileManager();

    expect(mockOpenInEditor).not.toHaveBeenCalled();
    expect(mockOpenInFileManager).not.toHaveBeenCalled();
  });

  it("LocalProjectRight键Continue走既有FileManage器Implementation", async () => {
    renderToStaticMarkup(
      createElement(HookProbe, {
        workspacePath: "/workspace/local",
      }),
    );

    await latestResult!.handleOpenTaskPathInFileManager();

    expect(mockOpenInFileManager).toHaveBeenCalledWith("/workspace/local");
  });

  it("ConfigurationFile不存在时会回退打开父级Table of Contents", async () => {
    mockUseWorkspaceProviderConfigFile.mockReturnValue({
      path: "/tmp/providers/demo/config.toml",
      exists: false,
      loading: false,
      error: null,
    });
    mockReadLastSelectedEditorId.mockReturnValue("vscode");
    mockGetInstalledEditors.mockResolvedValue([
      {
        id: "vscode",
        name: "VS Code",
        iconDataUrl: "",
      },
    ]);

    renderToStaticMarkup(
      createElement(HookProbe, {
        workspacePath: "/workspace/local",
        provider: "codex",
      }),
    );

    expect(latestResult).not.toBeNull();
    await latestResult!.handleOpenProviderConfig();

    expect(mockOpenInEditor).toHaveBeenCalledWith(
      "vscode",
      "/tmp/providers/demo",
    );
    expect(mockOpenInFileManager).not.toHaveBeenCalled();
  });

  it("resolveProviderConfigOpenTargetPath 会CompatibleFile与不同平台路径", () => {
    expect(
      resolveProviderConfigOpenTargetPath(
        "/tmp/providers/demo/config.toml",
        true,
      ),
    ).toBe("/tmp/providers/demo/config.toml");
    expect(
      resolveProviderConfigOpenTargetPath(
        "/tmp/providers/demo/config.toml",
        false,
      ),
    ).toBe("/tmp/providers/demo");
    expect(
      resolveProviderConfigOpenTargetPath(
        "C:\\Users\\dev\\.codex\\config.toml",
        false,
      ),
    ).toBe("C:\\Users\\dev\\.codex");
  });
});
