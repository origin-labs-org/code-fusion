import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRemoteWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
  HostMessageTypes,
  HostResponseTypes,
  InternalChannels,
  PlatformChannels,
  type RemoteTarget,
} from "@origin-ai/cf-shared";
import { resolveBotRemoteWorkspace } from "../src/host/botRemoteWorkspaceResolver.js";
import { createRemoteWorkspaceSessionManager } from "../src/main/desktopRemoteSessions.js";

const { browserWindowMock, channels } = vi.hoisted(() => {
  const windows: Array<unknown> = [];
  return {
    channels: [] as Array<{ port1: { close: ReturnType<typeof vi.fn> }; port2: object }>,
    browserWindowMock: {
      windows,
      fromId: vi.fn(
        (id: number) =>
          windows.find((candidate) => (candidate as { id: number }).id === id) ?? null,
      ),
      getAllWindows: vi.fn(() => windows),
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: browserWindowMock,
  MessageChannelMain: vi.fn(function MessageChannelMainMock() {
    const channel = {
      port1: {
        close: vi.fn(),
        start: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        postMessage: vi.fn(),
      },
      port2: {
        close: vi.fn(),
        start: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        off: vi.fn(),
        postMessage: vi.fn(),
      },
    };
    channels.push(channel);
    return channel;
  }),
}));

class MockUtilityProcess extends EventEmitter {
  pid: number;
  postMessage: ReturnType<typeof vi.fn>;
  provisioningResult: {
    status: "applied" | "already-applied" | "unsupported" | "failed" | "rollback_failed";
    error?: string;
    errorCode?: string;
  } = { status: "applied" };

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.postMessage = vi.fn((message: unknown) => {
      const candidate = message as {
        type?: string;
        requestId?: string;
        environmentKey?: string;
      };
      if (candidate.type !== HostMessageTypes.ProviderProvisioningExecute) return;
      queueMicrotask(() => {
        this.emit("message", {
          type: HostResponseTypes.ProviderProvisioningExecutionResult,
          requestId: candidate.requestId,
          environmentKey: candidate.environmentKey,
          ...this.provisioningResult,
        });
      });
    });
  }
}

function createWindow(id: number, webContentsId: number) {
  const win = {
    id,
    isDestroyed: () => false,
    webContents: {
      id: webContentsId,
      isDestroyed: () => false,
      send: vi.fn(),
      postMessage: vi.fn(),
    },
  };
  browserWindowMock.windows.push(win);
  return win;
}

const sshTarget: RemoteTarget = {
  kind: "ssh",
  host: "dev.internal",
  username: "developer",
};

function createManager(
  windowHostProcessMap: Map<number, MockUtilityProcess>,
  options?: {
    rendererAttachmentReadyTimeoutMs?: number;
    workspaceBindReadyTimeoutMs?: number;
    reportRemoteConnectionStateChanged?: (params: {
      rendererId: number;
      remoteKind: RemoteTarget["kind"];
      transition:
        | "connected"
        | "connection-closed"
        | "disposed"
        | "window-closed"
        | "host-exit"
        | "app-shutdown";
    }) => void;
    reportRemoteDisconnect?: (params: {
      rendererId: number;
      remoteKind: RemoteTarget["kind"];
      disconnectReason:
        | "connection-closed"
        | "disposed"
        | "window-closed"
        | "host-exit"
        | "app-shutdown";
      durationMs: number;
    }) => void;
    monotonicNowMs?: () => number;
    resolveWslTarget?: (
      target: Extract<RemoteTarget, { kind: "wsl" }>,
    ) => Promise<Extract<RemoteTarget, { kind: "wsl" }>>;
    webRemoteControlManager?: {
      failRemoteSession: ReturnType<typeof vi.fn>;
      replaceRemoteSession: ReturnType<typeof vi.fn>;
    };
    logger?: {
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
  },
) {
  return createRemoteWorkspaceSessionManager({
    logger: options?.logger ?? { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    windowHostProcessMap: windowHostProcessMap as never,
    resolveRemoteAssetDirs: () => ({}),
    resolveWslTarget: options?.resolveWslTarget,
    rendererAttachmentReadyTimeoutMs: options?.rendererAttachmentReadyTimeoutMs,
    workspaceBindReadyTimeoutMs: options?.workspaceBindReadyTimeoutMs,
    reportRemoteConnectionStateChanged: options?.reportRemoteConnectionStateChanged,
    reportRemoteDisconnect: options?.reportRemoteDisconnect,
    monotonicNowMs: options?.monotonicNowMs,
    webRemoteControlManagerRef: { current: options?.webRemoteControlManager ?? null },
  });
}

async function emitConnected(params: {
  child: MockUtilityProcess;
  requestId: string;
  remoteSessionId: string;
  sourceServerId?: string;
  reusedConnectionTarget?: RemoteTarget;
  target?: RemoteTarget;
  workspacePath?: string;
  workspaceIdentity?: string;
  workspacePurpose?: "project" | "conversation";
}) {
  const target = params.target ?? sshTarget;
  const workspacePath = params.workspacePath ?? "/";
  params.child.emit("message", {
    type: HostResponseTypes.RemoteWorkspaceConnected,
    requestId: params.requestId,
    descriptor: {
      ...(params.sourceServerId ? { sourceServerId: params.sourceServerId } : {}),
      ...(params.reusedConnectionTarget
        ? { reusedConnectionTarget: params.reusedConnectionTarget }
        : {}),
      remoteSessionId: params.remoteSessionId,
      target,
      workspacePath,
      workspaceIdentity:
        params.workspaceIdentity ?? buildRemoteWorkspaceIdentity(workspacePath, target),
      ...(params.workspacePurpose ? { workspacePurpose: params.workspacePurpose } : {}),
      generation: 1,
    },
  });
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function getLatestScopedAttachment(win: ReturnType<typeof createWindow>): {
  attachmentId: string;
  sessionId: string;
} {
  const call = win.webContents.postMessage.mock.calls.findLast(
    ([channel]) => channel === InternalChannels.ScopedServicePort,
  );
  expect(call).toBeDefined();
  return call?.[1] as { attachmentId: string; sessionId: string };
}

function confirmLatestScopedAttachment(
  manager: ReturnType<typeof createManager>,
  win: ReturnType<typeof createWindow>,
): void {
  const payload = getLatestScopedAttachment(win);
  manager.confirmRendererAttachmentReady(win.webContents.id, payload);
}

beforeEach(() => {
  browserWindowMock.windows.length = 0;
  channels.length = 0;
  browserWindowMock.fromId.mockClear();
  browserWindowMock.getAllWindows.mockClear();
});

describe("desktopRemoteSessions R1 window Host forwarding", () => {
  it("Forward remote connection progress of window Host to initiating renderer by requestId", () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    void manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    win.webContents.send.mockClear();

    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceConnectionLog,
      requestId: "connect-1",
      level: "info",
      message: "detecting remote env...",
    });

    expect(win.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.RemoteConnectionLog,
      expect.objectContaining({
        requestId: "connect-1",
        level: "info",
        message: "detecting remote env...",
        timestamp: expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/u),
      }),
    );
  });

  it("Return online reuse info by current request, notify only after desktop-continuous attachment is ready", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const onConnected = vi.fn();
    const connecting = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "reuse",
      undefined,
      { onConnected },
    );
    await emitConnected({
      child,
      requestId: "reuse",
      remoteSessionId: "session-reused",
      reusedConnectionTarget: sshTarget,
    });
    expect(onConnected).not.toHaveBeenCalled();
    confirmLatestScopedAttachment(manager, win);
    await expect(connecting).resolves.toBe("session-reused");
    expect(onConnected).toHaveBeenCalledWith(
      expect.objectContaining({ reusedConnectionTarget: sshTarget }),
    );
  });

  it.each(["source-server-upgrade-required", "source-server-install-required"])(
    "%s after WSL parameter completion preserves actual Profile and installation target",
    async (reasonCode) => {
      const child = new MockUtilityProcess(1001);
      const win = createWindow(1, 101);
      const resolvedTarget = { kind: "wsl", distro: "Ubuntu", user: "dev" } as const;
      const manager = createManager(new Map([[101, child]]), {
        resolveWslTarget: async () => resolvedTarget,
      });
      const connecting = manager.createRemoteWorkspaceSession(
        win as never,
        { kind: "wsl" },
        "wsl-upgrade",
      );
      const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
      const resolved = { resolvedWslTarget: resolvedTarget };
      const assertion = expect(connecting).rejects.toMatchObject({
        code: reasonCode,
        retryable: false,
        profileId,
        ...resolved,
      });
      await vi.waitFor(() =>
        expect(child.postMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: HostMessageTypes.ConnectRemoteWorkspace,
            target: resolvedTarget,
          }),
        ),
      );
      child.emit("message", {
        type: HostResponseTypes.RemoteWorkspaceConnectFailed,
        requestId: "wsl-upgrade",
        error: "upgrade required",
        reasonCode,
        retryable: false,
        profileId,
        ...resolved,
      });
      await assertion;
      manager.disposeRemoteWorkspaceSessionsForWindow(101);
    },
  );

  it("Connection request is sent to window's unique Local Host, exposing remote-scoped port from the same process upon success", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));

    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.ConnectRemoteWorkspace,
        requestId: "connect-1",
        target: sshTarget,
      }),
    );

    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });

    let connectionSettled = false;
    void connecting.then(() => {
      connectionSettled = true;
    });
    await Promise.resolve();
    expect(connectionSettled).toBe(false);
    confirmLatestScopedAttachment(manager, win);
    await expect(connecting).resolves.toBe("remote-session-1");
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.AttachServicePort,
        clientMode: "desktop-continuous",
        scope: expect.objectContaining({
          kind: "remote",
          remoteSessionId: "remote-session-1",
          workspaceIdentity: buildRemoteWorkspaceIdentity("/", sshTarget),
        }),
      }),
      expect.any(Array),
    );
    expect(win.webContents.postMessage).toHaveBeenCalledWith(
      InternalChannels.ScopedServicePort,
      expect.objectContaining({
        attachmentId: expect.any(String),
        sessionId: "remote-session-1",
        target: sshTarget,
        workspacePath: "/",
        workspaceIdentity: buildRemoteWorkspaceIdentity("/", sshTarget),
      }),
      expect.any(Array),
    );
  });

  it.each(["failed", "rollback_failed", "unsupported"] as const)(
    "首次 Provisioning 返回 %s 时拒绝连接且不发布 Renderer port",
    async (status) => {
      const child = new MockUtilityProcess(1001);
      child.provisioningResult = { status, error: "sync unavailable" };
      const win = createWindow(1, 101);
      const manager = createManager(new Map([[101, child]]));

      const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
      await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });

      await expect(connecting).rejects.toThrow(/Provider Provisioning/u);
      expect(win.webContents.postMessage).not.toHaveBeenCalledWith(
        InternalChannels.ScopedServicePort,
        expect.anything(),
        expect.anything(),
      );
    },
  );

  it("Provisioning failure after connection only logs structured warning without tearing down Workspace", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = createManager(new Map([[101, child]]), { logger });
    const connecting = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "connect-1",
      undefined,
      { remoteUsageTelemetryEligible: true },
    );
    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
    confirmLatestScopedAttachment(manager, win);
    await connecting;

    child.provisioningResult = { status: "failed", error: "token=secret-value" };
    child.emit("message", {
      type: HostResponseTypes.ProviderProvisioningSourceChanged,
      trigger: "personal-config",
    });
    for (let index = 0; index < 6; index += 1) await Promise.resolve();

    expect(logger.warn).toHaveBeenCalledWith(
      "[provider-provisioning] Environment sync did not apply",
      expect.objectContaining({
        environmentKey: expect.any(String),
        trigger: "personal-config",
        status: "failed",
      }),
    );
    expect(logger.warn.mock.calls.at(-1)?.[1]).not.toHaveProperty("errorSummary");
    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 1,
      activeTargetCount: 1,
    });
  });

  it.each([undefined, "source-read-failed"])(
    "首次同步失败把安全错误码 %s 写入日志和连接面板，不泄漏自由文本",
    async (errorCode) => {
      const child = new MockUtilityProcess(1001);
      child.provisioningResult = { status: "failed", error: "token=fixture-secret", errorCode };
      const win = createWindow(1, 101);
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const manager = createManager(new Map([[101, child]]), { logger });
      const connecting = manager.createRemoteWorkspaceSession(
        win as never,
        sshTarget,
        "connect-diagnostic",
      );
      const outcome = connecting.catch((error: Error) => error.message);
      await emitConnected({
        child,
        requestId: "connect-diagnostic",
        remoteSessionId: "remote-diagnostic",
      });
      const code = errorCode ?? "target-apply-failed";
      expect(logger.warn).toHaveBeenCalledWith(
        "[provider-provisioning] Environment sync did not apply",
        expect.objectContaining({
          trigger: "environment-online",
          status: "failed",
          errorCode: code,
        }),
      );
      expect(await outcome).toContain(code);
      expect(win.webContents.send).toHaveBeenCalledWith(
        PlatformChannels.RemoteConnectionLog,
        expect.objectContaining({
          requestId: "connect-diagnostic",
          level: "error",
          message: expect.stringContaining(code),
        }),
      );
      expect(
        JSON.stringify([logger.warn.mock.calls, win.webContents.send.mock.calls, await outcome]),
      ).not.toContain("fixture-secret");
      expect(win.webContents.postMessage).not.toHaveBeenCalled();
      expect(child.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: HostMessageTypes.DisposeRemoteWorkspaceSession }),
      );
    },
  );

  it("Count towards concurrency and report connected gauge only after eligible connection completes renderer ACK", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const reportRemoteConnectionStateChanged = vi.fn();
    const reportRemoteDisconnect = vi.fn();
    const manager = createManager(new Map([[101, child]]), {
      reportRemoteConnectionStateChanged,
      reportRemoteDisconnect,
    });

    const eligible = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "connect-eligible",
      undefined,
      { remoteUsageTelemetryEligible: true },
    );
    await emitConnected({
      child,
      requestId: "connect-eligible",
      remoteSessionId: "remote-eligible",
    });
    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 0,
      activeTargetCount: 0,
    });
    confirmLatestScopedAttachment(manager, win);
    await eligible;

    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 1,
      activeTargetCount: 1,
    });
    expect(reportRemoteConnectionStateChanged).toHaveBeenCalledWith({
      rendererId: 101,
      remoteKind: "ssh",
      transition: "connected",
    });

    const internal = manager.createRemoteWorkspaceSession(
      win as never,
      { kind: "docker", container: "internal-only" },
      "connect-internal",
    );
    await emitConnected({
      child,
      requestId: "connect-internal",
      remoteSessionId: "remote-internal",
      target: { kind: "docker", container: "internal-only" },
    });
    confirmLatestScopedAttachment(manager, win);
    await internal;

    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 1,
      activeTargetCount: 1,
    });
    manager.disposeRemoteWorkspaceSession("remote-internal", "internal-finished");
    expect(reportRemoteConnectionStateChanged).toHaveBeenCalledOnce();
    expect(reportRemoteDisconnect).not.toHaveBeenCalled();
  });

  it("Report after-state gauge and duration once after abnormal connection close, without repeating on subsequent dispose", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    let now = 100;
    const reportRemoteConnectionStateChanged = vi.fn();
    const reportRemoteDisconnect = vi.fn();
    const manager = createManager(new Map([[101, child]]), {
      monotonicNowMs: () => now,
      reportRemoteConnectionStateChanged,
      reportRemoteDisconnect,
    });
    const connecting = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "connect-1",
      undefined,
      { remoteUsageTelemetryEligible: true },
    );
    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
    confirmLatestScopedAttachment(manager, win);
    await connecting;

    now = 600;
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceClosed,
      remoteSessionId: "remote-session-1",
      reason: "connection-closed",
      exitCode: 255,
      signal: null,
    });

    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 0,
      activeTargetCount: 0,
    });
    expect(reportRemoteConnectionStateChanged).toHaveBeenNthCalledWith(2, {
      rendererId: 101,
      remoteKind: "ssh",
      transition: "connection-closed",
    });
    expect(reportRemoteDisconnect).toHaveBeenCalledWith({
      rendererId: 101,
      remoteKind: "ssh",
      disconnectReason: "connection-closed",
      durationMs: 500,
    });

    manager.disposeRemoteWorkspaceSession("remote-session-1", "tab-closed");
    expect(reportRemoteConnectionStateChanged).toHaveBeenCalledTimes(2);
    expect(reportRemoteDisconnect).toHaveBeenCalledOnce();
  });

  it.each([
    ["window-closed", "window"],
    ["host-exit", "host"],
    ["app-shutdown", "app"],
  ] as const)("Report corresponding final state when %s exits eligible route", async (reason, owner) => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    let now = 10;
    const reportRemoteConnectionStateChanged = vi.fn();
    const reportRemoteDisconnect = vi.fn();
    const manager = createManager(new Map([[101, child]]), {
      monotonicNowMs: () => now,
      reportRemoteConnectionStateChanged,
      reportRemoteDisconnect,
    });
    const connecting = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "connect-1",
      undefined,
      { remoteUsageTelemetryEligible: true },
    );
    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    now = 210;

    if (owner === "window") manager.disposeRemoteWorkspaceSessionsForWindow(101);
    else if (owner === "host") child.emit("exit");
    else await manager.disposeAllAndWaitForAppShutdown("app-quit");

    expect(reportRemoteConnectionStateChanged).toHaveBeenLastCalledWith({
      rendererId: 101,
      remoteKind: "ssh",
      transition: reason,
    });
    expect(reportRemoteDisconnect).toHaveBeenCalledWith({
      rendererId: 101,
      remoteKind: "ssh",
      disconnectReason: reason,
      durationMs: 200,
    });
    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 0,
      activeTargetCount: 0,
    });
  });

  it("Deduplicate diagnostic counts by sanitized target identity while retaining each logical session", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const targets: RemoteTarget[] = [
      sshTarget,
      sshTarget,
      { kind: "server", url: "ws://studio.example.com/ws" },
      { kind: "server", url: "http://studio.example.com" },
      { kind: "server", url: "wss://studio.example.com/ws" },
      { kind: "server", url: "https://studio.example.com" },
    ];

    for (const [index, target] of targets.entries()) {
      const requestId = `connect-${index}`;
      const remoteSessionId = `remote-${index}`;
      const connecting = manager.createRemoteWorkspaceSession(
        win as never,
        target,
        requestId,
        undefined,
        { remoteUsageTelemetryEligible: true },
      );
      await emitConnected({ child, requestId, remoteSessionId, target });
      confirmLatestScopedAttachment(manager, win);
      await connecting;
    }

    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 6,
      activeTargetCount: 3,
    });
  });

  it("telemetry callback 抛错不改变连接成功或 dispose 结果", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const reportRemoteConnectionStateChanged = vi.fn(() => {
      throw new Error("gauge reporter unavailable");
    });
    const reportRemoteDisconnect = vi.fn(() => {
      throw new Error("disconnect reporter unavailable");
    });
    const manager = createManager(new Map([[101, child]]), {
      reportRemoteConnectionStateChanged,
      reportRemoteDisconnect,
    });
    const connecting = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "connect-1",
      undefined,
      { remoteUsageTelemetryEligible: true },
    );
    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });

    expect(() => confirmLatestScopedAttachment(manager, win)).not.toThrow();
    await expect(connecting).resolves.toBe("remote-session-1");
    expect(() =>
      manager.disposeRemoteWorkspaceSession("remote-session-1", "tab-closed"),
    ).not.toThrow();
    expect(reportRemoteConnectionStateChanged).toHaveBeenCalledTimes(2);
    expect(reportRemoteDisconnect).toHaveBeenCalledOnce();
  });

  it("Do not send late connections if app enters shutdown during WSL target resolution", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    let resolveWslTarget!: (target: Extract<RemoteTarget, { kind: "wsl" }>) => void;
    const manager = createManager(new Map([[101, child]]), {
      resolveWslTarget: () =>
        new Promise((resolve) => {
          resolveWslTarget = resolve;
        }),
    });
    const target = { kind: "wsl", distro: "Ubuntu" } as const;
    const connecting = manager.createRemoteWorkspaceSession(win as never, target, "connect-wsl");
    await vi.waitFor(() => expect(resolveWslTarget).toBeTypeOf("function"));

    await manager.disposeAllAndWaitForAppShutdown("app-quit");
    const settled = connecting.catch((error: unknown) => error);
    resolveWslTarget(target);
    await Promise.resolve();

    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: HostMessageTypes.ConnectRemoteWorkspace }),
    );
    await expect(settled).resolves.toMatchObject({
      message: expect.stringContaining("应用正在退出"),
    });
  });

  it("两个窗口的连接、descriptor 和 attachment 都发往各自 Local Host", async () => {
    const firstChild = new MockUtilityProcess(1001);
    const secondChild = new MockUtilityProcess(1002);
    const firstWindow = createWindow(1, 101);
    const secondWindow = createWindow(2, 202);
    const manager = createManager(
      new Map([
        [101, firstChild],
        [202, secondChild],
      ]),
    );

    const first = manager.createRemoteWorkspaceSession(
      firstWindow as never,
      sshTarget,
      "connect-first",
    );
    const second = manager.createRemoteWorkspaceSession(
      secondWindow as never,
      sshTarget,
      "connect-second",
    );
    await emitConnected({
      child: firstChild,
      requestId: "connect-first",
      remoteSessionId: "remote-first",
    });
    await emitConnected({
      child: secondChild,
      requestId: "connect-second",
      remoteSessionId: "remote-second",
    });
    confirmLatestScopedAttachment(manager, firstWindow);
    confirmLatestScopedAttachment(manager, secondWindow);

    await expect(first).resolves.toBe("remote-first");
    await expect(second).resolves.toBe("remote-second");
    expect(firstChild.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ remoteSessionId: "remote-second" }),
      }),
      expect.anything(),
    );
    expect(secondChild.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ remoteSessionId: "remote-first" }),
      }),
      expect.anything(),
    );
    const provisioningExecutions = [
      ...firstChild.postMessage.mock.calls,
      ...secondChild.postMessage.mock.calls,
    ].filter(
      ([message]) =>
        (message as { type?: string }).type === HostMessageTypes.ProviderProvisioningExecute,
    );
    expect(provisioningExecutions).toHaveLength(1);
  });

  it("Canceling pending connection only sends control message without exiting window Host", () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    void manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-cancel");

    manager.cancelPendingRemoteWorkspaceSessionsForWindow(101, "user-cancel", "connect-cancel");

    expect(child.postMessage).toHaveBeenCalledWith({
      type: HostMessageTypes.CancelRemoteWorkspaceConnect,
      requestId: "connect-cancel",
    });
  });

  it("Update Host before rebuilding identity-validated renderer port after binding canonical context", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    const sourceServerId = "3cd4f9da-cd79-426c-9d70-75f36e9f6a87";
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      sourceServerId,
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    const firstAttachmentId = getLatestScopedAttachment(win).attachmentId;
    child.postMessage.mockClear();

    const binding = manager.bindRemoteWorkspaceSessionContext(
      "remote-session-1",
      {
        workspacePath: "/work/demo",
        workspaceIdentity: "remote:ssh:dev.internal:22:developer:/work/demo",
      },
      101,
    );

    expect(child.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: HostMessageTypes.BindRemoteWorkspaceContext,
      remoteSessionId: "remote-session-1",
      workspacePath: "/work/demo",
      workspaceIdentity: `remote:server:${sourceServerId}:/work/demo`,
      legacyRouteHint: "remote:ssh:dev.internal:22:developer:/work/demo",
    });
    const bindRequest = child.postMessage.mock.calls[0]?.[0] as { requestId: string };
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceContextBound,
      requestId: bindRequest.requestId,
      previousWorkspaceIdentity: "remote:ssh:dev.internal:22:developer:/work/demo",
    });
    await Promise.resolve();
    expect(child.postMessage.mock.calls[1]?.[0]).toMatchObject({
      type: HostMessageTypes.AttachServicePort,
      scope: {
        kind: "remote",
        remoteSessionId: "remote-session-1",
        workspacePath: "/work/demo",
        workspaceIdentity: `remote:server:${sourceServerId}:/work/demo`,
      },
    });
    expect(child.postMessage).not.toHaveBeenCalledWith({
      type: HostMessageTypes.DetachServicePort,
      attachmentId: firstAttachmentId,
    });
    confirmLatestScopedAttachment(manager, win);
    await expect(binding).resolves.toEqual({
      sourceServerId,
      remoteSessionId: "remote-session-1",
      workspacePath: "/work/demo",
      workspaceIdentity: `remote:server:${sourceServerId}:/work/demo`,
      previousWorkspaceIdentity: "remote:ssh:dev.internal:22:developer:/work/demo",
    });
    expect(child.postMessage).toHaveBeenCalledWith({
      type: HostMessageTypes.DetachServicePort,
      attachmentId: firstAttachmentId,
    });
  });

  it("rejects bind before attaching a renderer port when Host workspace preparation fails", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.postMessage.mockClear();

    const binding = manager.bindRemoteWorkspaceSessionContext(
      "remote-session-1",
      { workspacePath: "/work/demo" },
      101,
    );
    const request = child.postMessage.mock.calls[0]?.[0] as { requestId: string };
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceContextBindFailed,
      requestId: request.requestId,
      error: "workspace migration conflict",
      reasonCode: "workspace-task-identity-conflict",
      retryable: false,
    });

    await expect(binding).rejects.toMatchObject({
      message: "workspace migration conflict",
      code: "workspace-task-identity-conflict",
      retryable: false,
    });
    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: HostMessageTypes.AttachServicePort }),
      expect.anything(),
    );
  });

  it("rejects a pending workspace bind when its Window Host exits", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.postMessage.mockClear();

    const binding = manager.bindRemoteWorkspaceSessionContext(
      "remote-session-1",
      { workspacePath: "/work/demo" },
      101,
    );
    child.emit("exit", 1);

    await expect(binding).rejects.toThrow("Window Local Host exited");
  });

  it("times out a workspace bind that receives no Host ACK", async () => {
    vi.useFakeTimers();
    try {
      const child = new MockUtilityProcess(1001);
      const win = createWindow(1, 101);
      const manager = createManager(new Map([[101, child]]), {
        workspaceBindReadyTimeoutMs: 10,
      });
      const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
      await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
      confirmLatestScopedAttachment(manager, win);
      await connecting;
      child.postMessage.mockClear();

      const binding = manager.bindRemoteWorkspaceSessionContext(
        "remote-session-1",
        { workspacePath: "/work/demo" },
        101,
      );
      const rejection = expect(binding).rejects.toMatchObject({
        message: expect.stringContaining("workspace bind ACK timed out"),
        code: "remote-bind-canceled",
        retryable: true,
      });
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
      const bindMessage = child.postMessage.mock.calls.find(
        ([message]) => message.type === HostMessageTypes.BindRemoteWorkspaceContext,
      )?.[0];
      expect(child.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: HostMessageTypes.CancelRemoteWorkspaceBind,
          requestId: bindMessage.requestId,
          remoteSessionId: "remote-session-1",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("joins a duplicate connected response to the existing pending bind without orphaning its attachment", async () => {
    vi.useFakeTimers();
    try {
      const child = new MockUtilityProcess(1001);
      const win = createWindow(1, 101);
      const manager = createManager(new Map([[101, child]]), {
        rendererAttachmentReadyTimeoutMs: 10,
      });
      const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
      await emitConnected({
        child,
        requestId: "connect-1",
        remoteSessionId: "remote-session-1",
        sourceServerId: "source-1",
      });
      confirmLatestScopedAttachment(manager, win);
      await connecting;

      const workspacePath = "/work/conversation";
      const workspaceIdentity = "remote:server:source-1:/work/conversation";
      const binding = manager.bindRemoteWorkspaceSessionContext(
        "remote-session-1",
        {
          workspacePath,
          workspaceIdentity,
          workspacePurpose: "conversation",
        },
        101,
      );
      const bindRequest = child.postMessage.mock.calls.find(
        ([message]) => message.type === HostMessageTypes.BindRemoteWorkspaceContext,
      )?.[0] as { requestId: string };
      child.emit("message", {
        type: HostResponseTypes.RemoteWorkspaceContextBound,
        requestId: bindRequest.requestId,
      });
      await Promise.resolve();
      const bindingAttachment = getLatestScopedAttachment(win);

      const joined = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-2", {
        workspacePath,
        workspaceIdentity,
      });
      await emitConnected({
        child,
        requestId: "connect-2",
        remoteSessionId: "remote-session-1",
        sourceServerId: "source-1",
        workspacePath,
        workspaceIdentity,
        workspacePurpose: "conversation",
      });

      expect(
        win.webContents.postMessage.mock.calls.filter(
          ([channel]) => channel === InternalChannels.ScopedServicePort,
        ),
      ).toHaveLength(2);
      manager.confirmRendererAttachmentReady(win.webContents.id, bindingAttachment);
      await expect(binding).resolves.toMatchObject({
        remoteSessionId: "remote-session-1",
        workspaceIdentity,
      });
      await expect(joined).resolves.toBe("remote-session-1");

      await vi.advanceTimersByTimeAsync(10);
      expect(child.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: HostMessageTypes.DisposeRemoteWorkspaceSession,
          remoteSessionId: "remote-session-1",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a joined connect pending until the matching context bind becomes renderer-ready", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      sourceServerId: "source-1",
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;

    const workspacePath = "/work/conversation";
    const workspaceIdentity = "remote:server:source-1:/work/conversation";
    const binding = manager.bindRemoteWorkspaceSessionContext(
      "remote-session-1",
      {
        workspacePath,
        workspaceIdentity,
        workspacePurpose: "conversation",
      },
      101,
    );
    const joined = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-2", {
      workspacePath,
      workspaceIdentity,
    });
    await emitConnected({
      child,
      requestId: "connect-2",
      remoteSessionId: "remote-session-1",
      sourceServerId: "source-1",
      workspacePath,
      workspaceIdentity,
      workspacePurpose: "conversation",
    });
    const joinedBeforeBindReady = await Promise.race([
      joined.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
    ]);
    expect(joinedBeforeBindReady).toBe("pending");

    const bindRequest = child.postMessage.mock.calls.find(
      ([message]) => message.type === HostMessageTypes.BindRemoteWorkspaceContext,
    )?.[0] as { requestId: string };
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceContextBound,
      requestId: bindRequest.requestId,
    });
    await Promise.resolve();
    confirmLatestScopedAttachment(manager, win);
    await expect(binding).resolves.toMatchObject({ workspaceIdentity });
    await expect(joined).resolves.toBe("remote-session-1");
  });

  it("shares one workspace bind flight for the same session context", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      sourceServerId: "source-1",
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.postMessage.mockClear();

    const context = {
      workspacePath: "/work/conversation",
      workspaceIdentity: "remote:server:source-1:/work/conversation",
      workspacePurpose: "conversation" as const,
    };
    const first = manager.bindRemoteWorkspaceSessionContext("remote-session-1", context, 101);
    const second = manager.bindRemoteWorkspaceSessionContext("remote-session-1", context, 101);
    const bindMessages = child.postMessage.mock.calls.filter(
      ([message]) => message.type === HostMessageTypes.BindRemoteWorkspaceContext,
    );

    expect(bindMessages).toHaveLength(1);
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceContextBound,
      requestId: bindMessages[0]?.[0].requestId,
      previousWorkspaceIdentity: "remote:ssh:legacy:/work/conversation",
    });
    await Promise.resolve();
    confirmLatestScopedAttachment(manager, win);
    await expect(first).resolves.toMatchObject({
      workspaceIdentity: context.workspaceIdentity,
      previousWorkspaceIdentity: "remote:ssh:legacy:/work/conversation",
    });
    await expect(second).resolves.toEqual(await first);
  });

  it("returns an already-ready identical workspace context without rotating the attachment", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      sourceServerId: "source-1",
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;

    const context = {
      workspacePath: "/work/conversation",
      workspaceIdentity: "remote:server:source-1:/work/conversation",
      workspacePurpose: "conversation" as const,
    };
    const first = manager.bindRemoteWorkspaceSessionContext("remote-session-1", context, 101);
    const bindRequest = child.postMessage.mock.calls.find(
      ([message]) => message.type === HostMessageTypes.BindRemoteWorkspaceContext,
    )?.[0] as { requestId: string };
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceContextBound,
      requestId: bindRequest.requestId,
    });
    await Promise.resolve();
    const attachment = getLatestScopedAttachment(win);
    manager.confirmRendererAttachmentReady(win.webContents.id, attachment);
    await first;
    child.postMessage.mockClear();
    win.webContents.postMessage.mockClear();

    const repeated = manager.bindRemoteWorkspaceSessionContext("remote-session-1", context, 101);

    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.BindRemoteWorkspaceContext,
      }),
    );
    expect(win.webContents.postMessage).not.toHaveBeenCalledWith(
      InternalChannels.ScopedServicePort,
      expect.anything(),
      expect.anything(),
    );
    await expect(repeated).resolves.toMatchObject({
      remoteSessionId: "remote-session-1",
      workspacePath: context.workspacePath,
      workspaceIdentity: context.workspaceIdentity,
      workspacePurpose: "conversation",
    });
  });

  it("promotes telemetry eligibility once when an eligible request joins a ready route", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const reportRemoteConnectionStateChanged = vi.fn();
    const manager = createManager(new Map([[101, child]]), {
      reportRemoteConnectionStateChanged,
    });
    const background = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "connect-background",
    );
    await emitConnected({
      child,
      requestId: "connect-background",
      remoteSessionId: "remote-session-1",
    });
    confirmLatestScopedAttachment(manager, win);
    await background;
    expect(reportRemoteConnectionStateChanged).not.toHaveBeenCalled();

    const eligible = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "connect-eligible",
      undefined,
      { remoteUsageTelemetryEligible: true },
    );
    await emitConnected({
      child,
      requestId: "connect-eligible",
      remoteSessionId: "remote-session-1",
    });

    await expect(eligible).resolves.toBe("remote-session-1");
    expect(reportRemoteConnectionStateChanged).toHaveBeenCalledTimes(1);
    expect(reportRemoteConnectionStateChanged).toHaveBeenCalledWith({
      rendererId: 101,
      remoteKind: "ssh",
      transition: "connected",
    });
    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 1,
      activeTargetCount: 1,
    });
  });

  it("rejects a concurrent different context without disturbing the owning bind", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      sourceServerId: "source-1",
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.postMessage.mockClear();

    const owningContext = {
      workspacePath: "/work/conversation",
      workspaceIdentity: "remote:server:source-1:/work/conversation",
      workspacePurpose: "conversation" as const,
    };
    const owningBind = manager.bindRemoteWorkspaceSessionContext(
      "remote-session-1",
      owningContext,
      101,
    );
    await expect(
      manager.bindRemoteWorkspaceSessionContext(
        "remote-session-1",
        {
          workspacePath: "/work/project",
          workspaceIdentity: "remote:server:source-1:/work/project",
          workspacePurpose: "project",
        },
        101,
      ),
    ).rejects.toThrow("正在绑定Other context");

    const bindMessages = child.postMessage.mock.calls.filter(
      ([message]) => message.type === HostMessageTypes.BindRemoteWorkspaceContext,
    );
    expect(bindMessages).toHaveLength(1);
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceContextBound,
      requestId: bindMessages[0]?.[0].requestId,
    });
    await Promise.resolve();
    confirmLatestScopedAttachment(manager, win);
    await expect(owningBind).resolves.toMatchObject({
      workspacePath: owningContext.workspacePath,
      workspaceIdentity: owningContext.workspaceIdentity,
    });
    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.DisposeRemoteWorkspaceSession,
        remoteSessionId: "remote-session-1",
      }),
    );
  });

  it("rejects a same-session join from a mismatched target without replacing the owner route", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const owner = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-owner");
    await emitConnected({
      child,
      requestId: "connect-owner",
      remoteSessionId: "remote-session-1",
    });
    confirmLatestScopedAttachment(manager, win);
    await owner;
    win.webContents.postMessage.mockClear();
    child.postMessage.mockClear();

    const otherTarget: RemoteTarget = {
      kind: "docker",
      container: "other-runtime",
    };
    const conflicting = manager.createRemoteWorkspaceSession(
      win as never,
      otherTarget,
      "connect-conflict",
    );
    await emitConnected({
      child,
      requestId: "connect-conflict",
      remoteSessionId: "remote-session-1",
      target: otherTarget,
    });

    await expect(conflicting).rejects.toThrow("join does not match existing route");
    expect(win.webContents.postMessage).not.toHaveBeenCalledWith(
      InternalChannels.ScopedServicePort,
      expect.anything(),
      expect.anything(),
    );
    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.DisposeRemoteWorkspaceSession,
        remoteSessionId: "remote-session-1",
      }),
    );
    expect(manager.getRemoteConnectionStats()).toEqual({
      activeSessionCount: 0,
      activeTargetCount: 0,
    });
    expect(manager.hasRemoteWorkspaceSessionForTarget(win as never, sshTarget)).toBe(true);
  });

  it("joins a different Profile request when Host returns the canonical Source owner target", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const owner = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-owner");
    await emitConnected({
      child,
      requestId: "connect-owner",
      remoteSessionId: "remote-session-1",
      sourceServerId: "source-1",
    });
    confirmLatestScopedAttachment(manager, win);
    await owner;
    win.webContents.postMessage.mockClear();
    child.postMessage.mockClear();

    const alternateProfileTarget: RemoteTarget = {
      kind: "ssh",
      host: "route-b.internal",
      username: "developer",
    };
    const joined = manager.createRemoteWorkspaceSession(
      win as never,
      alternateProfileTarget,
      "connect-alternate-profile",
    );
    await emitConnected({
      child,
      requestId: "connect-alternate-profile",
      remoteSessionId: "remote-session-1",
      sourceServerId: "source-1",
      target: sshTarget,
    });

    await expect(joined).resolves.toBe("remote-session-1");
    expect(win.webContents.postMessage).not.toHaveBeenCalledWith(
      InternalChannels.ScopedServicePort,
      expect.anything(),
      expect.anything(),
    );
    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.DisposeRemoteWorkspaceSession,
        remoteSessionId: "remote-session-1",
      }),
    );
    expect(manager.hasRemoteWorkspaceSessionForTarget(win as never, sshTarget)).toBe(true);
    expect(manager.hasRemoteWorkspaceSessionForTarget(win as never, alternateProfileTarget)).toBe(
      false,
    );
  });

  it("Ignore stale ready ACK; timeout only reclaims and does not promote candidate attachment", async () => {
    vi.useFakeTimers();
    try {
      const child = new MockUtilityProcess(1001);
      const win = createWindow(1, 101);
      const manager = createManager(new Map([[101, child]]), {
        rendererAttachmentReadyTimeoutMs: 10,
      });
      const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
      await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
      const firstAttachment = getLatestScopedAttachment(win);
      confirmLatestScopedAttachment(manager, win);
      await connecting;
      child.postMessage.mockClear();

      const binding = manager.bindRemoteWorkspaceSessionContext(
        "remote-session-1",
        { workspacePath: "/work/demo" },
        101,
      );
      const bindRequest = child.postMessage.mock.calls[0]?.[0] as { requestId: string };
      child.emit("message", {
        type: HostResponseTypes.RemoteWorkspaceContextBound,
        requestId: bindRequest.requestId,
      });
      await Promise.resolve();
      const candidateAttachment = getLatestScopedAttachment(win);
      manager.confirmRendererAttachmentReady(101, firstAttachment);
      const bindingRejection = expect(binding).rejects.toThrow("renderer attachment ready timed out");
      await vi.advanceTimersByTimeAsync(10);

      await bindingRejection;
      expect(child.postMessage).toHaveBeenCalledWith({
        type: HostMessageTypes.DetachServicePort,
        attachmentId: candidateAttachment.attachmentId,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("Attach mobile runtime to existing window Local Host", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const workspaceIdentity = "remote:ssh:dev.internal:22:developer:/work/demo";
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1", {
      workspacePath: "/work/demo",
      workspaceIdentity,
    });
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      workspacePath: "/work/demo",
      workspaceIdentity,
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.postMessage.mockClear();

    const mobile = manager.attachRemoteWorkspaceSessionHost({
      windowId: 1,
      remoteSessionId: "remote-session-1",
      workspacePath: "/work/demo",
      workspaceIdentity,
      workspaceKey: workspaceIdentity,
      clientMode: "web-remote-replayable",
    });
    expect(mobile.process).toBe(child);
    expect(child.postMessage).toHaveBeenCalledTimes(1);
    for (const [message] of child.postMessage.mock.calls) {
      expect(message).toMatchObject({
        type: HostMessageTypes.AttachServicePort,
        clientMode: "web-remote-replayable",
        scope: { kind: "remote", remoteSessionId: "remote-session-1" },
      });
    }
  });

  it("renderer reload only rebuilds attachment, reusing session and Host PID", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1");
    await emitConnected({ child, requestId: "connect-1", remoteSessionId: "remote-session-1" });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.postMessage.mockClear();

    manager.reattachRemoteWorkspaceSessionsForWindow(win as never, "renderer-reload");

    expect(child.pid).toBe(1001);
    expect(child.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: HostMessageTypes.AttachServicePort,
      scope: { kind: "remote", remoteSessionId: "remote-session-1" },
    });
    expect(
      child.postMessage.mock.calls.some(
        ([message]) => message.type === HostMessageTypes.ConnectRemoteWorkspace,
      ),
    ).toBe(false);
    confirmLatestScopedAttachment(manager, win);
  });

  it("Retain offline route for tab dispose after disconnect, but forbid reload, mobile, and Bot re-attachment", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const workspacePath = "/work/demo";
    const workspaceIdentity = "remote:ssh:dev.internal:22:developer:/work/demo";
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1", {
      workspacePath,
      workspaceIdentity,
    });
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      workspacePath,
      workspaceIdentity,
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.postMessage.mockClear();

    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceClosed,
      remoteSessionId: "remote-session-1",
      reason: "connection-closed",
      exitCode: 255,
      signal: null,
      recoverable: true,
      recoveryAttempt: 2,
      recoveryLimit: 3,
    });
    manager.reattachRemoteWorkspaceSessionsForWindow(win as never, "renderer-reload");

    expect(child.postMessage).toHaveBeenCalledWith({
      type: HostMessageTypes.DetachServicePort,
      attachmentId: expect.any(String),
    });
    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: HostMessageTypes.AttachServicePort }),
      expect.anything(),
    );
    expect(() =>
      manager.attachRemoteWorkspaceSessionHost({
        windowId: 1,
        remoteSessionId: "remote-session-1",
        workspacePath,
        workspaceIdentity,
        workspaceKey: workspaceIdentity,
        clientMode: "web-remote-replayable",
      }),
    ).toThrow("远程 workspace source 当前离线");
    manager.disposeRemoteWorkspaceSession("remote-session-1", "tab-closed");
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.DisposeRemoteWorkspaceSession,
        remoteSessionId: "remote-session-1",
      }),
    );
  });

  it("Restore Desktop first after Source auto-reconnect; mobile bridge failure does not roll back new session", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const webRemoteControlManager = {
      failRemoteSession: vi.fn(),
      replaceRemoteSession: vi.fn(async () => {
        throw new Error("mobile bridge unavailable");
      }),
    };
    const manager = createManager(new Map([[101, child]]), { webRemoteControlManager });
    const workspacePath = "/work/demo";
    const workspaceIdentity = "remote:ssh:dev.internal:22:developer:/work/demo";
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1", {
      workspacePath,
      workspaceIdentity,
    });
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      workspacePath,
      workspaceIdentity,
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceClosed,
      remoteSessionId: "remote-session-1",
      reason: "connection-closed",
      exitCode: 255,
      signal: null,
      recoverable: true,
      recoveryAttempt: 2,
      recoveryLimit: 3,
    });
    expect(webRemoteControlManager.failRemoteSession).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.RemoteSessionClosed, {
      sessionId: "remote-session-1",
      reason: "host-exit",
      exitCode: 255,
      signal: null,
      recoverable: true,
      recoveryAttempt: 2,
      recoveryLimit: 3,
    });
    win.webContents.send.mockClear();

    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceReconnected,
      previousRemoteSessionId: "remote-session-1",
      descriptor: {
        remoteSessionId: "remote-session-2",
        target: sshTarget,
        workspacePath,
        workspaceIdentity,
        generation: 2,
      },
    });
    expect(getLatestScopedAttachment(win).sessionId).toBe("remote-session-2");
    confirmLatestScopedAttachment(manager, win);
    await vi.waitFor(() =>
      expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.RemoteSessionReconnected, {
        previousSessionId: "remote-session-1",
        sessionId: "remote-session-2",
        workspacePath,
        workspaceIdentity,
      }),
    );
    expect(webRemoteControlManager.replaceRemoteSession).toHaveBeenCalledWith({
      previousSessionId: "remote-session-1",
      sessionId: "remote-session-2",
      workspacePath,
      workspaceIdentity,
    });
    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.DisposeRemoteWorkspaceSession,
        remoteSessionId: "remote-session-2",
      }),
    );

    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceClosed,
      remoteSessionId: "remote-session-2",
      reason: "connection-closed",
      exitCode: 255,
      signal: null,
      recoverable: false,
    });
    expect(webRemoteControlManager.failRemoteSession).toHaveBeenCalledWith(
      "remote-session-2",
      "window-host:connection-offline",
      expect.objectContaining({ reason: "workspace-closed" }),
    );
  });

  async function reconnectSourceSession(params: {
    child: MockUtilityProcess;
    win: ReturnType<typeof createWindow>;
    manager: ReturnType<typeof createManager>;
    workspacePath: string;
    workspaceIdentity: string;
  }) {
    params.child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceClosed,
      remoteSessionId: "remote-session-1",
      reason: "connection-closed",
      exitCode: 255,
      signal: null,
      recoverable: true,
      recoveryAttempt: 1,
      recoveryLimit: 3,
    });
    params.child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceReconnected,
      previousRemoteSessionId: "remote-session-1",
      descriptor: {
        remoteSessionId: "remote-session-2",
        target: sshTarget,
        workspacePath: params.workspacePath,
        workspaceIdentity: params.workspaceIdentity,
        generation: 2,
      },
    });
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    confirmLatestScopedAttachment(params.manager, params.win);
    await vi.waitFor(() =>
      expect(params.win.webContents.send).toHaveBeenCalledWith(
        PlatformChannels.RemoteSessionReconnected,
        expect.objectContaining({ sessionId: "remote-session-2" }),
      ),
    );
  }

  it("Re-register Provisioning lane with new sessionId and re-dispatch after Source auto-reconnect", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const workspacePath = "/work/demo";
    const workspaceIdentity = "remote:ssh:dev.internal:22:developer:/work/demo";
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1", {
      workspacePath,
      workspaceIdentity,
    });
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      workspacePath,
      workspaceIdentity,
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.ProviderProvisioningExecute,
        remoteSessionId: "remote-session-1",
        trigger: "environment-online",
      }),
    );
    child.postMessage.mockClear();

    await reconnectSourceSession({ child, win, manager, workspacePath, workspaceIdentity });

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.ProviderProvisioningExecute,
        remoteSessionId: "remote-session-2",
        trigger: "environment-online",
      }),
    );
    child.postMessage.mockClear();

    child.emit("message", {
      type: HostResponseTypes.ProviderProvisioningSourceChanged,
      trigger: "personal-config",
    });
    for (let index = 0; index < 6; index += 1) await Promise.resolve();

    const provisioningExecutions = child.postMessage.mock.calls
      .map(([message]) => message as { type?: string; remoteSessionId?: string; trigger?: string })
      .filter((message) => message.type === HostMessageTypes.ProviderProvisioningExecute);
    expect(provisioningExecutions).toEqual([
      expect.objectContaining({ remoteSessionId: "remote-session-2", trigger: "personal-config" }),
    ]);
  });

  it("Provisioning failure triggered by reconnect only logs warning without tearing down reconnected Workspace", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const manager = createManager(new Map([[101, child]]), { logger });
    const workspacePath = "/work/demo";
    const workspaceIdentity = "remote:ssh:dev.internal:22:developer:/work/demo";
    const connecting = manager.createRemoteWorkspaceSession(win as never, sshTarget, "connect-1", {
      workspacePath,
      workspaceIdentity,
    });
    await emitConnected({
      child,
      requestId: "connect-1",
      remoteSessionId: "remote-session-1",
      workspacePath,
      workspaceIdentity,
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;

    child.provisioningResult = { status: "failed", error: "token=secret-value" };
    await reconnectSourceSession({ child, win, manager, workspacePath, workspaceIdentity });

    expect(getLatestScopedAttachment(win).sessionId).toBe("remote-session-2");
    expect(logger.warn).toHaveBeenCalledWith(
      "[provider-provisioning] Environment resync after reconnect did not apply",
      expect.objectContaining({ remoteSessionId: "remote-session-2" }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-value");
    expect(child.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: HostMessageTypes.DisposeRemoteWorkspaceSession,
        remoteSessionId: "remote-session-2",
      }),
    );
  });
  it("Mobile project preparation only hands over Host descriptor without creating desktop tab/continuous attachment", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const remoteControl = {
      failRemoteSession: vi.fn(),
      replaceRemoteSession: vi.fn(async () => undefined),
    };
    const manager = createManager(new Map([[101, child]]), {
      webRemoteControlManager: remoteControl,
    });
    const pending = manager.prepareProjectWorkspace(
      win as never,
      { projectId: "p", hostId: "remote:server:s" },
      "mobile-project",
    );
    expect(child.postMessage).toHaveBeenCalledWith({
      type: HostMessageTypes.PrepareProjectWorkspace,
      requestId: "mobile-project",
      projectId: "p",
      hostId: "remote:server:s",
      clientMode: "web-remote-replayable",
    });
    const remote = {
      sourceServerId: "s",
      remoteSessionId: "mobile-scope",
      workspacePath: "/new",
      workspaceIdentity: "remote:server:s:/new",
      generation: 1,
      target: sshTarget,
    };
    child.emit("message", {
      type: HostResponseTypes.ProjectWorkspacePrepared,
      requestId: "mobile-project",
      result: {
        ok: true,
        value: {
          projectId: "p",
          hostId: "remote:server:s",
          workspacePath: "/new",
          workspaceIdentity: remote.workspaceIdentity,
          additionalDirectories: [],
          remote,
        },
      },
    });
    expect((await pending).remote?.remoteSessionId).toBe("mobile-scope");
    manager.reattachRemoteWorkspaceSessionsForWindow(win as never, "renderer-reload");
    expect(win.webContents.postMessage).not.toHaveBeenCalled();
    const mobile = manager.attachRemoteWorkspaceSessionHost({
      windowId: 1,
      remoteSessionId: "mobile-scope",
      workspacePath: "/new",
      workspaceIdentity: remote.workspaceIdentity,
      workspaceKey: remote.workspaceIdentity,
      clientMode: "web-remote-replayable",
    });
    expect(mobile.process).toBe(child);
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceReconnected,
      previousRemoteSessionId: "mobile-scope",
      descriptor: { ...remote, remoteSessionId: "mobile-reconnected", generation: 2 },
    });
    await vi.waitFor(() =>
      expect(remoteControl.replaceRemoteSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: "mobile-reconnected" }),
      ),
    );
    expect(win.webContents.postMessage).not.toHaveBeenCalled();
    manager.disposeRemoteWorkspaceSessionsForWindow(101);
  });

  it("Host exit fails pending project navigation without leaving orphaned requests", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const pending = manager.prepareProjectWorkspace(
      win as never,
      { projectId: null },
      "mobile-project",
    );
    const rejected = expect(pending).rejects.toThrow("Host");
    child.emit("exit", 1);
    await rejected;
  });
  it("Exiting after Host returns directory but before initial config sync completes must also terminate navigation request", async () => {
    const child = new MockUtilityProcess(1001);
    child.postMessage.mockImplementation(() => undefined);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const rejected = vi.fn();
    void manager
      .prepareProjectWorkspace(
        win as never,
        { projectId: "p", hostId: "remote:server:s" },
        "mobile-project",
      )
      .catch(rejected);
    child.emit("message", {
      type: HostResponseTypes.ProjectWorkspacePrepared,
      requestId: "mobile-project",
      result: {
        ok: true,
        value: {
          projectId: "p",
          hostId: "remote:server:s",
          workspacePath: "/new",
          workspaceIdentity: "remote:server:s:/new",
          additionalDirectories: [],
          remote: {
            sourceServerId: "s",
            remoteSessionId: "mobile-scope",
            workspacePath: "/new",
            workspaceIdentity: "remote:server:s:/new",
            generation: 1,
            target: sshTarget,
          },
        },
      },
    });
    child.emit("exit", 1);
    await vi.waitFor(() =>
      expect(rejected).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("Host") }),
      ),
    );
  });

  it("Do not return late config success result as navigation success after window closes", async () => {
    const child = new MockUtilityProcess(1001);
    child.postMessage.mockImplementation(() => undefined);
    const win = createWindow(1, 101);
    const manager = createManager(new Map([[101, child]]));
    const settled = vi.fn();
    void manager
      .prepareProjectWorkspace(
        win as never,
        { projectId: "p", hostId: "remote:server:s" },
        "mobile-project",
      )
      .then(
        () => settled("success"),
        () => settled("rejected"),
      );
    child.emit("message", {
      type: HostResponseTypes.ProjectWorkspacePrepared,
      requestId: "mobile-project",
      result: {
        ok: true,
        value: {
          projectId: "p",
          hostId: "remote:server:s",
          workspacePath: "/new",
          workspaceIdentity: "remote:server:s:/new",
          additionalDirectories: [],
          remote: {
            sourceServerId: "s",
            remoteSessionId: "mobile-scope",
            workspacePath: "/new",
            workspaceIdentity: "remote:server:s:/new",
            generation: 1,
            target: sshTarget,
          },
        },
      },
    });
    await vi.waitFor(() =>
      expect(child.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: HostMessageTypes.ProviderProvisioningExecute }),
      ),
    );
    const command = child.postMessage.mock.calls.find(
      ([message]) => message.type === HostMessageTypes.ProviderProvisioningExecute,
    )![0];
    manager.disposeRemoteWorkspaceSessionsForWindow(101);
    child.emit("message", {
      type: HostResponseTypes.ProviderProvisioningExecutionResult,
      requestId: command.requestId,
      environmentKey: command.environmentKey,
      status: "applied",
    });
    await vi.waitFor(() => expect(settled).toHaveBeenCalled());
    expect(settled).toHaveBeenCalledWith("rejected");
  });
});

describe("mobile scope admission joins", () => {
  function setup() {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const reportRemoteConnectionStateChanged = vi.fn();
    const manager = createManager(new Map([[101, child]]), { reportRemoteConnectionStateChanged });
    const value = {
      projectId: "p",
      hostId: "remote:server:s",
      workspacePath: "/new",
      workspaceIdentity: "remote:server:s:/new",
      additionalDirectories: [],
      remote: {
        sourceServerId: "s",
        remoteSessionId: "mobile-scope",
        workspacePath: "/new",
        workspaceIdentity: "remote:server:s:/new",
        generation: 1,
        target: sshTarget,
      },
    };
    const prepare = (requestId: string) => {
      const result = manager.prepareProjectWorkspace(
        win as never,
        { projectId: "p", hostId: value.hostId },
        requestId,
      );
      child.emit("message", {
        type: HostResponseTypes.ProjectWorkspacePrepared,
        requestId,
        result: { ok: true, value },
      });
      return result;
    };
    return { child, win, manager, prepare, reportRemoteConnectionStateChanged };
  }
  it("a second navigation waits for the shared scope's initial provisioning", async () => {
    const { child, manager, prepare } = setup();
    child.postMessage.mockImplementation(() => undefined);
    const first = prepare("first");
    await vi.waitFor(() =>
      expect(child.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: HostMessageTypes.ProviderProvisioningExecute }),
      ),
    );
    const settled = vi.fn();
    const second = prepare("second").then(settled);
    await Promise.resolve();
    await Promise.resolve();
    const completedBeforeProvisioning = settled.mock.calls.length;
    const command = child.postMessage.mock.calls.find(
      ([message]) => message.type === HostMessageTypes.ProviderProvisioningExecute,
    )![0];
    child.emit("message", {
      type: HostResponseTypes.ProviderProvisioningExecutionResult,
      requestId: command.requestId,
      environmentKey: command.environmentKey,
      status: "applied",
    });
    await Promise.all([first, second]);
    manager.disposeRemoteWorkspaceSessionsForWindow(101);
    expect(completedBeforeProvisioning).toBe(0);
  });
  it("desktop adoption of a mobile scope reports connection only after renderer readiness", async () => {
    const { child, win, manager, prepare, reportRemoteConnectionStateChanged } = setup();
    await prepare("mobile");
    const desktop = manager.createRemoteWorkspaceSession(
      win as never,
      sshTarget,
      "desktop",
      undefined,
      { remoteUsageTelemetryEligible: true },
    );
    await emitConnected({ child, requestId: "desktop", remoteSessionId: "mobile-scope" });
    expect(reportRemoteConnectionStateChanged).not.toHaveBeenCalled();
    confirmLatestScopedAttachment(manager, win);
    await desktop;
    expect(reportRemoteConnectionStateChanged).toHaveBeenCalledWith({
      rendererId: 101,
      remoteKind: "ssh",
      transition: "connected",
    });
    manager.disposeRemoteWorkspaceSessionsForWindow(101);
  });

  it("When new connection lacks context, mobile bridge must wait until UI binds selected directory before passing identity validation", async () => {
    const child = new MockUtilityProcess(1001);
    const win = createWindow(1, 101);
    const resolvedWslTarget = { kind: "wsl", distro: "Ubuntu", user: "dev" } as const;
    const manager = createManager(new Map([[101, child]]), {
      resolveWslTarget: async () => resolvedWslTarget,
    });
    const connecting = manager.createRemoteWorkspaceSession(
      win as never,
      { kind: "wsl" },
      "connect-wsl",
    );
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    await emitConnected({
      child,
      requestId: "connect-wsl",
      remoteSessionId: "remote-session-1",
      target: resolvedWslTarget,
    });
    confirmLatestScopedAttachment(manager, win);
    await connecting;

    const tabIdentity = "remote:wsl:default:/home/dev";
    const attachMobile = () =>
      manager.attachRemoteWorkspaceSessionHost({
        windowId: 1,
        remoteSessionId: "remote-session-1",
        workspacePath: "/home/dev",
        workspaceIdentity: tabIdentity,
        workspaceKey: tabIdentity,
        clientMode: "web-remote-replayable",
      });
    expect(attachMobile).toThrow("远程 workspaceKey 与 logical session 不匹配。");

    child.postMessage.mockClear();
    const previousAttachmentId = getLatestScopedAttachment(win).attachmentId;
    const binding = manager.bindRemoteWorkspaceSessionContext(
      "remote-session-1",
      { workspacePath: "/home/dev", workspaceIdentity: tabIdentity },
      101,
    );
    const bindRequest = child.postMessage.mock.calls.find(
      ([message]) => message.type === HostMessageTypes.BindRemoteWorkspaceContext,
    )?.[0] as { requestId: string };
    expect(bindRequest).toBeDefined();
    child.emit("message", {
      type: HostResponseTypes.RemoteWorkspaceContextBound,
      requestId: bindRequest.requestId,
    });
    await vi.waitFor(() =>
      expect(getLatestScopedAttachment(win).attachmentId).not.toBe(previousAttachmentId),
    );
    confirmLatestScopedAttachment(manager, win);
    await binding;
    child.postMessage.mockClear();

    expect(attachMobile().remoteKind).toBe("wsl");
    expect(child.postMessage.mock.calls[0]?.[0]).toMatchObject({
      type: HostMessageTypes.AttachServicePort,
      clientMode: "web-remote-replayable",
      scope: {
        kind: "remote",
        remoteSessionId: "remote-session-1",
        workspacePath: "/home/dev",
        workspaceIdentity: tabIdentity,
      },
    });
  });
});
