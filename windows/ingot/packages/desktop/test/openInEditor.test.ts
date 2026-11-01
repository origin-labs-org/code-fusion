import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  accessMock,
  execFileMock,
  listWSLDistrosMock,
  openPathMock,
  showItemInFolderMock,
  loggerWarnMock,
} = vi.hoisted(() => ({
  accessMock: vi.fn(),
  execFileMock: vi.fn(),
  listWSLDistrosMock: vi.fn(),
  openPathMock: vi.fn(),
  showItemInFolderMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  access: accessMock,
}));

vi.mock("electron", () => ({
  shell: {
    openPath: openPathMock,
    showItemInFolder: showItemInFolderMock,
  },
}));

vi.mock("@origin-ai/cf-server/remote/wsl-detect.js", () => ({
  listWSLDistros: listWSLDistrosMock,
}));

vi.mock("../src/main/editors.js", () => ({
  getEditorDefsForCurrentPlatform: () => [
    {
      id: "explorer",
      name: "资源管理器",
      appPath: "C:/Windows/explorer.exe",
      command: null,
    },
    {
      id: "vscode",
      name: "VS Code",
      appPath: "C:/Users/demo/AppData/Local/Programs/Microsoft VS Code/Code.exe",
      command: "code",
    },
    {
      id: "qspace",
      name: "QSpace",
      appPath: "/Applications/QSpace.app",
      command: null,
    },
    {
      id: "qspace-pro",
      name: "QSpace Pro",
      appPath: "/Applications/QSpace Pro.app",
      command: null,
    },
  ],
  resolveEditorDefAppPath: (def: { appPath: string }) => def.appPath,
}));

vi.mock("../src/main/logger.js", () => ({
  logger: {
    warn: loggerWarnMock,
  },
}));

import { openInEditor } from "../src/main/openInEditor.js";

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

function setProcessPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform });
}

describe("openInEditor", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cf-open-in-editor-"));
    accessMock.mockReset();
    accessMock.mockResolvedValue(undefined);
    execFileMock.mockReset();
    listWSLDistrosMock.mockReset();
    openPathMock.mockReset();
    showItemInFolderMock.mockReset();
    loggerWarnMock.mockReset();
    listWSLDistrosMock.mockResolvedValue([{ name: "Ubuntu", isDefault: true }]);
    openPathMock.mockResolvedValue("");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
  });

  it("Windows directory paths should go directly through shell.openPath to avoid duplicate windows from explorer fallback", async () => {
    const result = await openInEditor("explorer", tempDir);

    expect(result).toEqual({ success: true });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(openPathMock).toHaveBeenCalledTimes(1);
    expect(openPathMock).toHaveBeenCalledWith(tempDir);
  });

  it("Windows local files call shell locate only once without launching Explorer subprocess", async () => {
    setProcessPlatform("win32");
    const filePath = join(tempDir, "Generate File.html");
    writeFileSync(filePath, "<html></html>");
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(Object.assign(new Error("Command failed: explorer.exe"), { code: 1 }));
      },
    );

    const result = await openInEditor("explorer", filePath);

    expect(result).toEqual({ success: true });
    expect(execFileMock).not.toHaveBeenCalled();
    expect(showItemInFolderMock).toHaveBeenCalledExactlyOnceWith(filePath);
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("Should fall back to editor exe to open directory when Windows CLI command is unavailable", async () => {
    setProcessPlatform("win32");
    execFileMock.mockImplementation(
      (file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(file === "code" ? new Error("missing code cli") : null);
      },
    );

    const result = await openInEditor("vscode", tempDir);

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenNthCalledWith(1, "code", [tempDir], expect.any(Function));
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "C:/Users/demo/AppData/Local/Programs/Microsoft VS Code/Code.exe",
      [tempDir],
      expect.any(Function),
    );
  });

  it("Should use Remote-SSH folder URI when opening SSH remote workspace with VS Code", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("vscode", "/root/demo-project", {
      remoteTarget: {
        kind: "ssh",
        host: "jumpserver.example.com",
        port: 2222,
        username: "asset01@root@192.168.100.166",
        sshConfigAlias: "cf",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledWith(
      "code",
      ["--folder-uri", "vscode-remote://ssh-remote+cf/root/demo-project"],
      expect.any(Function),
    );
  });

  it("Should use Remote-SSH file URI when opening SSH remote file with VS Code", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("vscode", "/root/demo-project/src/index.ts", {
      pathKind: "file",
      remoteTarget: {
        kind: "ssh",
        host: "jumpserver.example.com",
        port: 2222,
        username: "root",
        sshConfigAlias: "cf",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledWith(
      "code",
      ["--file-uri", "vscode-remote://ssh-remote+cf/root/demo-project/src/index.ts"],
      expect.any(Function),
    );
  });

  it("Should encode VS Code Remote-SSH authority when SSH remote workspace has no alias", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("vscode", "/root/demo-project", {
      remoteTarget: {
        kind: "ssh",
        host: "192.168.100.166",
        port: 2222,
        username: "asset01@root",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledWith(
      "code",
      [
        "--folder-uri",
        "vscode-remote://ssh-remote+asset01%40root%40192.168.100.166%3A2222/root/demo-project",
      ],
      expect.any(Function),
    );
  });

  it("Should use Remote-WSL folder URI when opening WSL remote workspace with VS Code", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("vscode", "/home/demo/My Repo", {
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu 22.04",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledWith(
      "code",
      ["--folder-uri", "vscode-remote://wsl+Ubuntu%2022.04/home/demo/My%20Repo"],
      expect.any(Function),
    );
  });

  it("Should use Remote-WSL file URI when opening WSL remote file with VS Code", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("vscode", "/home/demo/My Repo/src/index.ts", {
      pathKind: "file",
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu 22.04",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledWith(
      "code",
      ["--file-uri", "vscode-remote://wsl+Ubuntu%2022.04/home/demo/My%20Repo/src/index.ts"],
      expect.any(Function),
    );
  });

  it("Should open VS Code using default distro when WSL remote workspace lacks distro", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("vscode", "/home/demo/repo", {
      remoteTarget: {
        kind: "wsl",
      },
    });

    expect(result).toEqual({ success: true });
    expect(listWSLDistrosMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "code",
      ["--folder-uri", "vscode-remote://wsl+Ubuntu/home/demo/repo"],
      expect.any(Function),
    );
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("Should not pass raw Linux paths to VS Code when WSL remote workspace lacks distro and detection fails", async () => {
    listWSLDistrosMock.mockRejectedValueOnce(new Error("wsl unavailable"));

    const result = await openInEditor("vscode", "/home/demo/repo", {
      remoteTarget: {
        kind: "wsl",
      },
    });

    expect(result).toEqual({
      success: false,
      error: "missing WSL distro for VS Code Remote-WSL",
    });
    expect(listWSLDistrosMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).not.toHaveBeenCalled();
    expect(openPathMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith("[editors] 解析默认 WSL distro 失败", {
      error: "wsl unavailable",
    });
  });

  it("Should open wsl.localhost UNC via explorer.exe when opening WSL remote workspace in Explorer", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("explorer", "/home/demo/My Repo", {
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "C:/Windows/explorer.exe",
      ["\\\\wsl.localhost\\Ubuntu\\home\\demo\\My Repo"],
      expect.any(Function),
    );
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("Should select corresponding UNC file when locating WSL remote file with Explorer", async () => {
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("explorer", "/home/demo/src/index.ts", {
      pathKind: "file",
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledWith(
      "C:/Windows/explorer.exe",
      ["/select,", "\\\\wsl.localhost\\Ubuntu\\home\\demo\\src\\index.ts"],
      expect.any(Function),
    );
  });

  it("Should still treat as success when WSL Explorer is delegated to open but returns numeric exit code", async () => {
    setProcessPlatform("win32");
    const command =
      '"C:/Windows/explorer.exe" /select, "\\\\wsl.localhost\\Ubuntu\\home\\demo\\src\\index.ts"';
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(
          Object.assign(new Error(`Command failed: ${command}`), {
            code: 1,
            killed: false,
            signal: null,
            cmd: command,
            stderr: "",
          }),
        );
      },
    );

    const result = await openInEditor("explorer", "/home/demo/src/index.ts", {
      pathKind: "file",
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(loggerWarnMock).not.toHaveBeenCalled();
  });

  it("Should continue trying wsl$ when WSL Explorer numeric exit code contains path error", async () => {
    setProcessPlatform("win32");
    accessMock.mockRejectedValueOnce(new Error("network path not found"));
    execFileMock.mockImplementation(
      (_file: string, args: string[], callback: (error: Error | null) => void) => {
        const candidate = args.at(-1) ?? "";
        if (candidate.startsWith("\\\\wsl.localhost")) {
          const command = `"C:/Windows/explorer.exe" "${candidate}"`;
          callback(
            Object.assign(new Error(`Command failed: ${command}`), {
              code: 1,
              killed: false,
              signal: null,
              cmd: command,
              stderr: "",
            }),
          );
          return;
        }
        callback(null);
      },
    );

    const result = await openInEditor("explorer", "/workspace/demo", {
      pathKind: "directory",
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu",
      },
    });

    expect(result).toEqual({ success: true });
    expect(accessMock).toHaveBeenCalledWith("\\\\wsl.localhost\\Ubuntu\\workspace\\demo");
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "C:/Windows/explorer.exe",
      ["\\\\wsl$\\Ubuntu\\workspace\\demo"],
      expect.any(Function),
    );
  });

  it("WSL remote workspace Explorer should fall back to wsl$ UNC after wsl.localhost fails", async () => {
    execFileMock.mockImplementation(
      (_file: string, args: string[], callback: (error: Error | null) => void) => {
        callback(
          args[0]?.startsWith("\\\\wsl.localhost") ? new Error("cannot open wsl.localhost") : null,
        );
      },
    );

    const result = await openInEditor("explorer", "/workspace/demo", {
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu",
      },
    });

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "C:/Windows/explorer.exe",
      ["\\\\wsl.localhost\\Ubuntu\\workspace\\demo"],
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "C:/Windows/explorer.exe",
      ["\\\\wsl$\\Ubuntu\\workspace\\demo"],
      expect.any(Function),
    );
    expect(openPathMock).not.toHaveBeenCalled();
  });

  it("WSL remote workspace Explorer should return error and log when both UNC candidates fail", async () => {
    execFileMock.mockImplementation(
      (_file: string, args: string[], callback: (error: Error | null) => void) => {
        callback(new Error(`cannot open ${args[0] ?? "unknown"}`));
      },
    );

    const result = await openInEditor("explorer", "/workspace/demo", {
      remoteTarget: {
        kind: "wsl",
        distro: "Ubuntu",
      },
    });

    expect(result).toEqual({
      success: false,
      error: "cannot open \\\\wsl$\\Ubuntu\\workspace\\demo",
    });
    expect(execFileMock).toHaveBeenCalledTimes(2);
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      "C:/Windows/explorer.exe",
      ["\\\\wsl.localhost\\Ubuntu\\workspace\\demo"],
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      "C:/Windows/explorer.exe",
      ["\\\\wsl$\\Ubuntu\\workspace\\demo"],
      expect.any(Function),
    );
    expect(openPathMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith("[editors] Failed to open WSL workspace File Explorer", {
      path: "/workspace/demo",
      candidates: [
        "\\\\wsl.localhost\\Ubuntu\\workspace\\demo",
        "\\\\wsl$\\Ubuntu\\workspace\\demo",
      ],
      error: "cannot open \\\\wsl$\\Ubuntu\\workspace\\demo",
    });
  });

  it("macOS QSpace Pro should open directories via app bundle", async () => {
    setProcessPlatform("darwin");
    execFileMock.mockImplementation(
      (_file: string, _args: string[], callback: (error: Error | null) => void) => {
        callback(null);
      },
    );

    const result = await openInEditor("qspace-pro", tempDir);

    expect(result).toEqual({ success: true });
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith(
      "open",
      ["-a", "/Applications/QSpace Pro.app", tempDir],
      expect.any(Function),
    );
  });
});
