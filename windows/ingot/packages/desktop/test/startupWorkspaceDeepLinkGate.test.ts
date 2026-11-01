import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  appShow: vi.fn(),
  showMessageBoxSync: vi.fn(() => 0),
  setAsDefaultProtocolClient: vi.fn(() => true),
}));
const fsMocks = vi.hoisted(() => ({
  statSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  fsMocks.statSync.mockImplementation(actual.statSync);
  return {
    ...actual,
    statSync: fsMocks.statSync,
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
    get isPackaged() {
      return false;
    },
    setAsDefaultProtocolClient: electronMocks.setAsDefaultProtocolClient,
    show: electronMocks.appShow,
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
  dialog: {
    showMessageBoxSync: electronMocks.showMessageBoxSync,
  },
}));

const tempDirs: string[] = [];

beforeEach(() => {
  vi.resetModules();
  electronMocks.showMessageBoxSync.mockReset();
  electronMocks.showMessageBoxSync.mockReturnValue(0);
  fsMocks.statSync.mockClear();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("startup workspace deep link gate", () => {
  it("Generate workspace bootstrap after user confirms cold start deep link", async () => {
    const workspacePath = createTempWorkspace();
    const logger = { info: vi.fn(), warn: vi.fn() };

    const { createStartupDeepLinkConsumptionGate, resolveExplicitStartupWorkspaceBootstrap } =
      await import("../src/main/startupWorkspaceDeepLinkGate.js");
    const protocolUrl = buildWorkspaceOpenUrl(workspacePath);
    const consumptionGate = createStartupDeepLinkConsumptionGate(protocolUrl);
    const request = { path: workspacePath, source: "deep-link" } as const;

    consumptionGate.markStartupRequestConsumed(request);
    const bootstrap = resolveExplicitStartupWorkspaceBootstrap(request, { logger });

    expect(bootstrap).toEqual({
      initialWorkspacePath: workspacePath,
      initialWorkspacePurpose: "project",
      agentWarmupTargets: [{ workspacePath }],
    });
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalled();
    expect(consumptionGate.shouldHandleReadyProtocolUrl(protocolUrl)).toBe(false);
    expect(
      consumptionGate.shouldHandleReadyProtocolUrl(buildWorkspaceOpenUrl(createTempWorkspace())),
    ).toBe(true);
  });

  it("Do not generate workspace bootstrap after user cancels cold start deep link", async () => {
    const workspacePath = createTempWorkspace();
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.showMessageBoxSync.mockReturnValue(1);

    const { createStartupDeepLinkConsumptionGate, resolveExplicitStartupWorkspaceBootstrap } =
      await import("../src/main/startupWorkspaceDeepLinkGate.js");
    const protocolUrl = buildWorkspaceOpenUrl(workspacePath);
    const consumptionGate = createStartupDeepLinkConsumptionGate(protocolUrl);
    const request = { path: workspacePath, source: "deep-link" } as const;

    consumptionGate.markStartupRequestConsumed(request);
    const bootstrap = resolveExplicitStartupWorkspaceBootstrap(request, { logger });

    expect(bootstrap).toBeNull();
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("[deep-link] 用户取消打开外部链接工作区", {
      path: workspacePath,
    });
    expect(consumptionGate.shouldHandleReadyProtocolUrl(protocolUrl)).toBe(false);
  });

  it("Cold start deep link UNC path is rejected before directory probe", async () => {
    const logger = { info: vi.fn(), warn: vi.fn() };

    const { resolveExplicitStartupWorkspaceBootstrap } =
      await import("../src/main/startupWorkspaceDeepLinkGate.js");

    const bootstrap = resolveExplicitStartupWorkspaceBootstrap(
      { path: "\\\\attacker\\share", source: "deep-link" },
      { logger },
    );

    expect(bootstrap).toBeNull();
    expect(fsMocks.statSync).not.toHaveBeenCalled();
    expect(electronMocks.showMessageBoxSync).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("[deep-link] 网络工作区路径Rejected", {
      path: "\\\\attacker\\share",
    });
  });

  it("--open-workspace cold start argument preserves original trusted entry behavior", async () => {
    const workspacePath = createTempWorkspace();
    const logger = { info: vi.fn(), warn: vi.fn() };

    const { resolveExplicitStartupWorkspaceBootstrap } =
      await import("../src/main/startupWorkspaceDeepLinkGate.js");

    const bootstrap = resolveExplicitStartupWorkspaceBootstrap(
      { path: workspacePath, source: "open-workspace-arg" },
      { logger },
    );

    expect(bootstrap).toEqual({
      initialWorkspacePath: workspacePath,
      initialWorkspacePurpose: "project",
      agentWarmupTargets: [{ workspacePath }],
    });
    expect(electronMocks.showMessageBoxSync).not.toHaveBeenCalled();
  });
});

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-startup-deep-link-"));
  tempDirs.push(dir);
  return dir;
}

function buildWorkspaceOpenUrl(workspacePath: string): string {
  return `cf://workspace/open?path=${encodeURIComponent(workspacePath)}`;
}
