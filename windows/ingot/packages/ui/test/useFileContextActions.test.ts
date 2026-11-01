import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenInEditorRemoteTarget } from "@origin-ai/cf-shared";
import { useFileContextActions } from "@/hooks/useFileContextActions.js";

const { mockOpenInEditor, mockOpenInFileManager } = vi.hoisted(() => ({
  mockOpenInEditor: vi.fn(),
  mockOpenInFileManager: vi.fn(),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    openInEditor: mockOpenInEditor,
    openInFileManager: mockOpenInFileManager,
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: vi.fn(),
}));

let latestResult: ReturnType<typeof useFileContextActions> | null = null;

function HookProbe({
  isRemoteWorkspace,
  remoteTarget,
  workspaceIdentity,
}: {
  isRemoteWorkspace: boolean;
  remoteTarget?: OpenInEditorRemoteTarget;
  workspaceIdentity?: string;
}) {
  latestResult = useFileContextActions({
    canOpenLocalFileManager: true,
    isRemoteWorkspace,
    remoteTarget,
    workspaceIdentity,
  });
  return createElement("div");
}

describe("useFileContextActions", () => {
  beforeEach(() => {
    latestResult = null;
    mockOpenInEditor.mockReset();
    mockOpenInEditor.mockResolvedValue({ success: true });
    mockOpenInFileManager.mockReset();
    mockOpenInFileManager.mockResolvedValue({ success: true });
  });

  it("Review区的 WSL File动作Passed Explorer 打开所在Table of Contents", async () => {
    const remoteTarget = {
      kind: "wsl" as const,
      distro: "Ubuntu-24.04",
      user: "dev",
    };
    renderToStaticMarkup(
      createElement(HookProbe, {
        isRemoteWorkspace: true,
        remoteTarget,
        workspaceIdentity: "remote:wsl:Ubuntu-24.04:dev:/workspace/repo",
      }),
    );
    const target = {
      path: "/workspace/repo/src/index.ts",
      kind: "file" as const,
    };

    expect(latestResult!.canRevealInFileManager(target)).toBe(true);
    await latestResult!.revealInFileManager(target);

    expect(mockOpenInEditor).toHaveBeenCalledWith(
      "explorer",
      "/workspace/repo/src",
      {
        pathKind: "directory",
        remoteTarget,
        workspaceIdentity: "remote:wsl:Ubuntu-24.04:dev:/workspace/repo",
      },
    );
    expect(mockOpenInFileManager).not.toHaveBeenCalled();
  });

  it.each([
    [
      "SSH",
      {
        kind: "ssh" as const,
        host: "dev.example.com",
        port: 22,
        username: "dev",
      },
    ],
    ["Docker", { kind: "docker" as const, container: "dev-container" }],
  ])("Review区不为 %s 开放Local machineFileManage器", (_label, remoteTarget) => {
    renderToStaticMarkup(
      createElement(HookProbe, {
        isRemoteWorkspace: true,
        remoteTarget,
      }),
    );

    expect(
      latestResult!.canRevealInFileManager({
        path: "/workspace/repo/src/index.ts",
        kind: "file",
      }),
    ).toBe(false);
  });

  it("LocalReview区Continue使用原有FileManage器入口", async () => {
    renderToStaticMarkup(
      createElement(HookProbe, {
        isRemoteWorkspace: false,
      }),
    );
    const target = {
      path: "/workspace/repo/src/index.ts",
      kind: "file" as const,
    };

    expect(latestResult!.canRevealInFileManager(target)).toBe(true);
    await latestResult!.revealInFileManager(target);

    expect(mockOpenInFileManager).toHaveBeenCalledWith("/workspace/repo/src");
    expect(mockOpenInEditor).not.toHaveBeenCalled();
  });
});
