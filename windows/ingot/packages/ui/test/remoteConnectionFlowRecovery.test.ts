// @vitest-environment jsdom
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  SourceServerManagementSnapshot,
  SSHConfigAliasOption,
  DockerContainerInfo,
  WSLDistro,
} from "@origin-ai/cf-shared";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";
import { createCanonicalWslTargetResolver } from "@desktop/main/desktopWslTargetResolver.js";

const ports = vi.hoisted(() => ({
  trace: { complete: vi.fn(), fail: vi.fn(), cancel: vi.fn() },
  locale: "zh-CN",
  snapshot: {} as SourceServerManagementSnapshot,
  credentialService: { load: vi.fn(async (): Promise<string | null> => null), save: vi.fn() },
  settingService: {
    get: vi.fn<
      () => Promise<{
        remoteBoundaryOnboardingVersion?: number;
        remoteBoundaryIntroAcknowledgedVersion?: number;
      }>
    >(async () => ({ remoteBoundaryIntroAcknowledgedVersion: 1 })),
    update: vi.fn(async () => undefined),
  },
  management: {
    getSnapshot: vi.fn(),
    onDidChangeState: () => ({ dispose() {} }),
    onDidChangeDirectory: () => ({ dispose() {} }),
    updateSource: vi.fn(),
    confirmIdentityChange: vi.fn(),
  },
  platform: {
    isLocalDevelopmentRuntime: true,
    isDockerAvailable: vi.fn(async () => true),
    listSSHConfigAliases: vi.fn(async (): Promise<SSHConfigAliasOption[]> => []),
    listWSLDistros: vi.fn(async (): Promise<WSLDistro[]> => []),
    listDockerContainers: vi.fn(async (): Promise<DockerContainerInfo[]> => []),
    onRemoteConnectionLog: vi.fn(() => () => undefined),
    cancelPendingRemoteConnection: vi.fn(async () => undefined),
  },
  confirm: vi.fn(async () => true),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: ports.locale,
    intl: {
      formatMessage: ({ id }: { id: string }, values: Record<string, string> = {}) => {
        const messages: Record<string, string> = ports.locale === "zh-CN" ? zhCN : enUS;
        return (messages[id] ?? id).replace(/\{(\w+)\}/gu, (_, key) => values[key] ?? `{${key}}`);
      },
    },
  }),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => ({ ...ports, sourceServerManagementService: ports.management }),
  useOptionalBaseWorkspaceServices: () => ({
    ...ports,
    sourceServerManagementService: ports.management,
  }),
}));
vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ports.platform,
  useOptionalPlatform: () => ports.platform,
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => ports.confirm }));

import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";

beforeEach(() => {
  vi.clearAllMocks();
  useConfirmDialogStore.setState({ pendingRequest: undefined });
  ports.settingService.update.mockReset().mockResolvedValue(undefined);
  ports.settingService.get
    .mockReset()
    .mockResolvedValue({ remoteBoundaryIntroAcknowledgedVersion: 1 });
  ports.confirm.mockReset().mockResolvedValue(true);
  ports.credentialService.load.mockResolvedValue(null);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.unstubAllEnvs();
  ports.platform.isLocalDevelopmentRuntime = true;
  ports.platform.isDockerAvailable.mockResolvedValue(true);
  ports.locale = "zh-CN";
  ports.platform.listSSHConfigAliases.mockResolvedValue([]);
  ports.platform.listWSLDistros.mockResolvedValue([]);
  ports.platform.listDockerContainers.mockResolvedValue([]);
  ports.snapshot = {
    generation: 1,
    servers: [],
    profiles: [],
    states: [],
    workspaceHistory: [],
    failedPathCount: 0,
    abandonedPathCount: 0,
    migrationCounts: [],
  };
  ports.management.getSnapshot.mockImplementation(async () => ports.snapshot);
  ports.management.confirmIdentityChange.mockImplementation(async () => ports.snapshot);
  useRemoteWorkspaceSessionStore.setState({ sessionsById: {} });
});
afterEach(cleanup);

vi.mock("@/lib/userActionTelemetry.js", () => ({ startUserAction: () => ports.trace }));
import {
  useRemoteConnectionFlow,
  type RemoteConnectionFlowOptions,
} from "@/remote-connection-flow/index.js";
import { RemoteConnectionSettingsStep } from "@/RemoteConnectionDialogContent.js";
import { RemoteConnectionConnectingStep } from "@/remote-connection/RemoteConnectionConnectingStep.js";
import { requestRemoteProjectConnection } from "@/remote-connection-flow/contract.js";
import { requestRetainedRemoteProjectConnection } from "@/project-sidebar/remote-project-connection.js";
import { resolveRemoteConnectionPresentation } from "@/lib/remoteConnectionPresentation.js";

const targetA = { kind: "docker" as const, container: "a" };
function defaults(extra: Partial<RemoteConnectionFlowOptions> = {}): RemoteConnectionFlowOptions {
  return {
    open: true,
    onConnect: vi.fn(async () => "session-a"),
    onSelectProject: vi.fn(async () => undefined),
    onCancelSession: vi.fn(async () => undefined),
    ...extra,
  };
}
async function drain() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

const upgradeFailure = {
  code: "source-server-upgrade-required",
  message: "Source Server 3.14.0 must be upgraded to at least 3.15.0",
};

const wslInputs = [
  { kind: "wsl" },
  { kind: "wsl", distro: "Ubuntu" },
  { kind: "wsl", user: "dev" },
  { kind: "wsl", distro: "Ubuntu", user: "dev" },
] as const;
const resolvedWslTarget = { kind: "wsl", distro: "Ubuntu", user: "dev" } as const;
const wslProfileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
const wslInstallPreview = {
  version: "3.15.1",
  sizeBytes: 1048576,
  installPath: "/home/dev/.cf/server",
};
const wslInstallFailure = {
  code: "source-server-install-required",
  message: "install required",
  profileId: wslProfileId,
  resolvedWslTarget,
};

function prepareWslInstall() {
  ports.snapshot.profiles = [
    { profileId: wslProfileId, transport: "wsl", target: resolvedWslTarget, createdAt: 1 },
  ];
  ports.snapshot.states = [
    {
      profileId: wslProfileId,
      state: "needs-install",
      installPreview: wslInstallPreview,
      updatedAt: 1,
    },
  ];
}

it.each(
  wslInputs.flatMap((target) => ["connection", "handoff"].map((entry) => ({ target, entry }))),
)("WSL installation bound to actual identity: $entry $target", async ({ target, entry }) => {
  prepareWslInstall();
  let now = 0;
  let systemIdentity = { distro: "Ubuntu", user: "dev" };
  const resolve = createCanonicalWslTargetResolver({
    now: () => now,
    createBackend: (input) => ({
      resolveIdentity: async () => ({
        distro: input.distro ?? systemIdentity.distro,
        user: input.user ?? systemIdentity.user,
      }),
      dispose() {},
    }),
  });
  const resolved: unknown[] = [];
  const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async (input, _id, context) => {
    resolved.push(await resolve(input as typeof target));
    if (!context?.confirmSourceServerInstall)
      throw Object.assign(new Error(wslInstallFailure.message), wslInstallFailure);
    return "session-a";
  });
  const props = defaults({
    isWindowsDesktop: true,
    onConnect,
    preferredDirectoryPath: "/repo",
    ...(entry === "handoff" ? { preferredTarget: target, initialFailure: wslInstallFailure } : {}),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  if (entry === "connection") act(() => result.current.selectionStep.onSelectTarget(target));
  await waitFor(() => expect(result.current.connectingStep.installConfirmation).toBeDefined());
  expect(result.current.connectingStep.installConfirmation?.target).toEqual(resolvedWslTarget);
  await waitFor(() =>
    expect(result.current.connectingStep.installConfirmation?.preview).toEqual(wslInstallPreview),
  );
  render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
  expect(screen.getByText("WSL · Ubuntu · dev")).toBeTruthy();
  now = 6000;
  systemIdentity = { distro: "Debian", user: "other" };
  await act(async () => result.current.connectingStep.installConfirmation!.onConfirm());
  if (entry === "handoff")
    await waitFor(() =>
      expect(props.onSelectProject).toHaveBeenCalledWith("session-a", "/repo", undefined),
    );
  expect(onConnect.mock.lastCall?.[0]).toEqual(resolvedWslTarget);
  expect(onConnect.mock.lastCall?.[2]).toEqual({ confirmSourceServerInstall: true });
  expect(resolved.at(-1)).toEqual(resolvedWslTarget);
});

it.each(wslInputs)("WSL install preview failure still confirms the same actual target: %j", async (target) => {
  const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
    ports.management.getSnapshot.mockRejectedValue(new Error("preview unavailable"));
    throw Object.assign(new Error(wslInstallFailure.message), wslInstallFailure);
  });
  const { result } = renderHook(() =>
    useRemoteConnectionFlow(defaults({ isWindowsDesktop: true, onConnect })),
  );
  act(() => result.current.selectionStep.onSelectTarget(target));
  await waitFor(() => expect(result.current.connectingStep.installConfirmation).toBeDefined());
  expect(result.current.connectingStep.installConfirmation?.target).toEqual(resolvedWslTarget);
  expect(result.current.connectingStep.installConfirmation?.preview).toBeUndefined();
  await act(async () => result.current.connectingStep.installConfirmation!.onConfirm());
  expect(onConnect.mock.lastCall?.[0]).toEqual(resolvedWslTarget);
});

it.each(wslInputs)("Saved WSL return configuration preserves parameters and clears previous route: %j", async (target) => {
  const profile = { profileId: wslProfileId, transport: "wsl" as const, target, createdAt: 1 };
  const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
    throw new Error("offline");
  });
  const { result } = renderHook(() =>
    useRemoteConnectionFlow(defaults({ isWindowsDesktop: true, onConnect })),
  );
  act(() => {
    result.current.settingsStep.onWslDistroChange("Previous");
    result.current.settingsStep.onWslUserChange?.("root");
    result.current.selectionStep.onSelectProfile(profile);
  });
  await waitFor(() => expect(result.current.connectingStep.rawError).toBe("offline"));
  await act(async () => result.current.connectingStep.onBack());
  expect(result.current.settingsStep.wslDistro).toBe("distro" in target ? target.distro : "");
  expect(result.current.settingsStep.wslUser).toBe("user" in target ? target.user : "");
  await act(async () => result.current.settingsStep.onConnect());
  expect(onConnect.mock.calls).toHaveLength(2);
  expect(onConnect.mock.lastCall?.[0]).toEqual({
    ...target,
    distro: "distro" in target ? target.distro : undefined,
  });
});

it("Cancellation on delayed WSL install snapshot does not revive old target", async () => {
  prepareWslInstall();
  const snapshot = Promise.withResolvers<SourceServerManagementSnapshot>();
  const read = vi.fn(() => snapshot.promise);
  const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
    throw Object.assign(new Error(wslInstallFailure.message), wslInstallFailure);
  });
  const props = defaults({ isWindowsDesktop: true, openIntentId: 1, onConnect });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  ports.management.getSnapshot.mockImplementation((options?: unknown) =>
    options === undefined ? read() : Promise.resolve(ports.snapshot),
  );
  act(() => result.current.selectionStep.onSelectTarget({ kind: "wsl" }));
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  act(() => result.current.connectingStep.onCancelConnection?.());
  await act(async () => snapshot.resolve(ports.snapshot));
  expect(result.current.connectingStep.installConfirmation).toBeUndefined();
  expect(result.current.connectingStep.target).not.toEqual(resolvedWslTarget);
  expect(onConnect).toHaveBeenCalledOnce();
});

it.each(wslInputs)("Previous confirmation invalidated after WSL install waits for return configuration: %j", async (target) => {
  prepareWslInstall();
  const onConnect = vi
    .fn<RemoteConnectionFlowOptions["onConnect"]>()
    .mockRejectedValueOnce(Object.assign(new Error(wslInstallFailure.message), wslInstallFailure))
    .mockRejectedValue(new Error("new target offline"));
  const { result } = renderHook(() =>
    useRemoteConnectionFlow(defaults({ isWindowsDesktop: true, onConnect })),
  );
  act(() => result.current.selectionStep.onSelectTarget(target));
  await waitFor(() => expect(result.current.connectingStep.installConfirmation).toBeDefined());
  const oldConfirmation = result.current.connectingStep.installConfirmation!;
  await act(async () => result.current.connectingStep.onBack());
  expect(result.current.connectingStep.installConfirmation).toBeUndefined();
  expect(result.current.settingsStep.wslDistro).toBe("Ubuntu");
  expect(result.current.settingsStep.wslUser).toBe("dev");
  await act(async () => oldConfirmation.onConfirm());
  expect(onConnect).toHaveBeenCalledOnce();
  act(() => {
    result.current.settingsStep.onWslDistroChange("Debian");
    result.current.settingsStep.onWslUserChange?.("other");
  });
  await act(async () => result.current.settingsStep.onConnect());
  expect(onConnect.mock.lastCall?.[0]).toEqual({ kind: "wsl", distro: "Debian", user: "other" });
  expect(result.current.connectingStep.installConfirmation).toBeUndefined();
});

it.each([undefined, "Ubuntu"])(
  "WSL omitted user (distro %s) auto-updates by Host Profile with retryable button",
  async (distro) => {
    const target = { kind: "wsl" as const, ...(distro ? { distro } : {}) };
    const actual = { kind: "wsl" as const, distro: "Ubuntu", user: "dev" };
    const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
    ports.snapshot.profiles = [
      { profileId, transport: "wsl", target: actual, createdAt: 1 },
      {
        profileId: "other-user",
        transport: "wsl",
        target: { ...actual, user: "root" },
        createdAt: 2,
      },
    ];
    ports.snapshot.states = ports.snapshot.profiles.map((profile, index) => ({
      profileId: profile.profileId,
      state: "needs-upgrade",
      updateAvailability: "required",
      upgradeTarget: "server",
      updatedAt: index + 1,
    }));
    ports.management.updateSource.mockResolvedValue(ports.snapshot);
    const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
      throw Object.assign(new Error(upgradeFailure.message), upgradeFailure, {
        profileId,
        resolvedWslTarget: { kind: "wsl", distro: "Ubuntu", user: "dev" },
      });
    });
    const { result } = renderHook(() => useRemoteConnectionFlow(defaults({ onConnect })));
    act(() => result.current.selectionStep.onSelectTarget(target));
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.connectingStep.loading).toBe(false));
    expect(ports.management.updateSource.mock.calls).toEqual([
      [{ profileId, expectedTarget: actual, force: false }],
    ]);
    expect(onConnect.mock.calls[1]?.[0]).toEqual(actual);
    render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Update Remote" })));
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(3));
    expect(ports.management.updateSource.mock.calls).toEqual([
      [{ profileId, expectedTarget: actual, force: false }],
      [{ profileId, expectedTarget: actual, force: false }],
    ]);
  },
);

it.each(["removed", "controller", "canceled"])(
  "Does not update other routes when WSL upgrades Profile %s",
  async (scenario) => {
    const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
    const target = { kind: "wsl" as const, distro: "Ubuntu" };
    ports.snapshot.profiles = [
      { profileId, transport: "wsl", target: { ...target, user: "dev" }, createdAt: 1 },
    ];
    ports.snapshot.states = [
      {
        profileId,
        state: "needs-upgrade",
        updateAvailability: "required",
        upgradeTarget: "controller",
        updatedAt: 1,
      },
    ];
    if (scenario === "removed") ports.snapshot.profiles = [];
    let release!: () => void;
    ports.management.getSnapshot.mockImplementation(async (options?: unknown) => {
      if (scenario === "canceled" && options === undefined)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return ports.snapshot;
    });
    const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
      throw Object.assign(new Error(upgradeFailure.message), upgradeFailure, {
        profileId,
        resolvedWslTarget: { kind: "wsl", distro: "Ubuntu", user: "dev" },
      });
    });
    const { result } = renderHook(() => useRemoteConnectionFlow(defaults({ onConnect })));
    act(() => result.current.selectionStep.onSelectTarget(target));
    if (scenario === "canceled") {
      await waitFor(() => expect(release).toBeDefined());
      act(() => result.current.connectingStep.onCancelConnection?.());
      await act(async () => release());
      expect(result.current.connectingStep.cancelled).toBe(true);
    } else {
      await waitFor(() => expect(result.current.connectingStep.loading).toBe(false));
      render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
      expect(screen.queryByRole("button", { name: "Update Remote" })).toBeNull();
      if (scenario === "controller")
        expect(result.current.connectingStep.upgradeTarget).toBe("controller");
      else expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    }
    expect(ports.management.updateSource).not.toHaveBeenCalled();
  },
);
function prepareProjectUpgrade() {
  const target = { kind: "ssh" as const, host: "example.com", username: "dev", port: 22 };
  ports.snapshot.profiles = [
    {
      profileId: "project-profile",
      transport: "ssh",
      target: { ...target, passwordCredentialKey: "project-password" },
      createdAt: 1,
    },
  ];
  ports.snapshot.states = [
    {
      profileId: "project-profile",
      state: "needs-upgrade",
      updateAvailability: "required",
      upgradeTarget: "server",
      errorCode: upgradeFailure.code,
      updatedAt: 1,
    },
  ];
  ports.credentialService.load.mockResolvedValue("fixture-password");
  ports.management.updateSource.mockImplementation(async () => ports.snapshot);
  return defaults({
    preferredProfileId: "project-profile",
    preferredDirectoryPath: "/repo-b",
    initialFailure: upgradeFailure,
  });
}

it.each(["fresh", "pending"])("Original project %s upgrade handover auto-updates once and restores original directory", async (entry) => {
  const props = prepareProjectUpgrade();
  const openWizard = vi.fn();
  await requestRemoteProjectConnection({
    preference: {
      preferredProfileId: props.preferredProfileId,
      preferredDirectoryPath: props.preferredDirectoryPath,
    },
    presentation: resolveRemoteConnectionPresentation(
      entry === "pending" ? ports.snapshot.states[0]! : {},
    ),
    failure: upgradeFailure,
    reconnect: async () => {
      throw Object.assign(new Error(upgradeFailure.message), upgradeFailure);
    },
    openWizard,
  });
  renderHook(() => useRemoteConnectionFlow({ ...props, ...openWizard.mock.calls[0]![0] }));
  await waitFor(() =>
    expect(props.onSelectProject).toHaveBeenCalledWith("session-a", "/repo-b", undefined),
  );
  expect(ports.management.updateSource.mock.calls).toEqual([
    [
      {
        profileId: "project-profile",
        expectedTarget: { kind: "ssh", host: "example.com", username: "dev", port: 22 },
        force: false,
      },
    ],
  ]);
  expect(props.onConnect).toHaveBeenCalledTimes(1);
});

it.each(["handoff", "connection"])("%s can explicitly retry and restore original directory after upgrade snapshot fails", async (entry) => {
  const props = prepareProjectUpgrade();
  if (entry === "connection") props.initialFailure = undefined;
  props.onConnect = vi.fn(async () => {
    if (!ports.management.updateSource.mock.calls.length) {
      throw Object.assign(new Error(upgradeFailure.message), upgradeFailure);
    }
    return "session-a";
  });
  let failSnapshot = true;
  ports.management.getSnapshot.mockImplementation(async (options?: unknown) => {
    if (options === undefined && failSnapshot) {
      failSnapshot = false;
      throw new Error("snapshot temporarily unavailable");
    }
    return ports.snapshot;
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() =>
    expect(result.current.connectingStep.rawError).toBe("snapshot temporarily unavailable"),
  );
  expect(result.current.connectingStep.loading).toBe(false);
  expect(ports.management.updateSource).not.toHaveBeenCalled();
  expect(props.onSelectProject).not.toHaveBeenCalled();
  render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
  expect(screen.queryByRole("button", { name: "Update Remote" })).toBeNull();
  const retry = screen.getByRole("button", { name: "重试" });
  expect(retry.hasAttribute("disabled")).toBe(false);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(props.onSelectProject).toHaveBeenCalledWith("session-a", "/repo-b", undefined),
  );
  expect(ports.management.updateSource.mock.calls).toEqual([
    [
      {
        profileId: "project-profile",
        expectedTarget: { kind: "ssh", host: "example.com", username: "dev", port: 22 },
        force: false,
      },
    ],
  ]);
});

it("Late-arriving upgrade snapshot error after cancellation does not overwrite cancellation status", async () => {
  const props = prepareProjectUpgrade();
  let rejectSnapshot: ((error: Error) => void) | undefined;
  ports.management.getSnapshot.mockImplementation(async (options?: unknown) => {
    if (options !== undefined) return ports.snapshot;
    return new Promise<SourceServerManagementSnapshot>((_, reject) => {
      rejectSnapshot = reject;
    });
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() => expect(rejectSnapshot).toBeDefined());
  act(() => result.current.connectingStep.onCancelConnection());
  await act(async () => rejectSnapshot!(new Error("late snapshot failure")));
  expect(result.current.connectingStep.cancelled).toBe(true);
  expect(result.current.connectingStep.rawError).toBeUndefined();
  expect(result.current.connectingStep.errorMessage).toBe("");
  expect(result.current.connectingStep.loading).toBe(false);
  expect(ports.management.updateSource).not.toHaveBeenCalled();
  expect(props.onConnect).not.toHaveBeenCalled();
});

it.each(["cancel", "confirm"])("Wait %s after original project auto-update encounters running tasks", async (decision) => {
  const props = prepareProjectUpgrade();
  ports.management.updateSource.mockRejectedValueOnce(
    Object.assign(new Error("tasks active"), { code: "source-server-update-running-tasks" }),
  );
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() => expect(result.current.connectingStep.forceUpdate).toBeDefined());
  expect(ports.management.updateSource.mock.calls).toEqual([
    [
      {
        profileId: "project-profile",
        expectedTarget: { kind: "ssh", host: "example.com", username: "dev", port: 22 },
        force: false,
      },
    ],
  ]);
  expect(props.onConnect).not.toHaveBeenCalled();
  act(() => {
    if (decision === "cancel") result.current.connectingStep.forceUpdate!.onCancel();
    else result.current.connectingStep.forceUpdate!.onConfirm();
  });
  await drain();
  if (decision === "cancel") {
    expect(ports.management.updateSource).toHaveBeenCalledTimes(1);
    expect(props.onConnect).not.toHaveBeenCalled();
  } else {
    await waitFor(() => expect(props.onSelectProject).toHaveBeenCalledTimes(1));
    expect(ports.management.updateSource.mock.calls[1]).toEqual([
      {
        profileId: "project-profile",
        expectedTarget: { kind: "ssh", host: "example.com", username: "dev", port: 22 },
        force: true,
      },
    ]);
  }
});

it("Late success result after canceling original project update does not restore old project", async () => {
  const props = prepareProjectUpgrade();
  let finish!: (snapshot: SourceServerManagementSnapshot) => void;
  ports.management.updateSource.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() => expect(ports.management.updateSource).toHaveBeenCalledTimes(1));
  act(() => result.current.connectingStep.onCancelConnection());
  await act(async () => finish(ports.snapshot));
  expect(props.onConnect).not.toHaveBeenCalled();
  expect(props.onSelectProject).not.toHaveBeenCalled();
  expect(result.current.connectingStep.cancelled).toBe(true);
  expect(result.current.connectingStep.loading).toBe(false);
});

it("No loop if original project remains incompatible after update; collapse/restore does not re-update", async () => {
  const props = prepareProjectUpgrade();
  props.onConnect = vi.fn(async () => {
    throw Object.assign(new Error(upgradeFailure.message), upgradeFailure);
  });
  const { result, rerender } = renderHook((p) => useRemoteConnectionFlow(p), {
    initialProps: props,
  });
  await waitFor(() => expect(props.onConnect).toHaveBeenCalledTimes(1));
  await drain();
  expect(result.current.connectingStep.upgradeRequired).toBe(true);
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  rerender({ ...props, open: true });
  await drain();
  expect(ports.management.updateSource).toHaveBeenCalledTimes(1);
  expect(props.onConnect).toHaveBeenCalledTimes(1);
});

it("Failed original project update retains reason and update entry without continuing directory binding", async () => {
  const props = prepareProjectUpgrade();
  ports.management.updateSource.mockRejectedValue(new Error("archive unavailable"));
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() => expect(result.current.connectingStep.rawError).toBe("archive unavailable"));
  expect(result.current.connectingStep.upgradeRequired).toBe(true);
  expect(ports.management.updateSource).toHaveBeenCalledTimes(1);
  expect(props.onConnect).not.toHaveBeenCalled();
});

it.each(["controller", "ordinary-failure"])("%s handover does not auto-update or redial", async (reason) => {
  const props = prepareProjectUpgrade();
  if (reason === "controller") ports.snapshot.states[0]!.upgradeTarget = "controller";
  else props.initialFailure = { code: "remote-host-unreachable", message: "offline" };
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() =>
    expect(result.current.connectingStep.rawError).toBe(props.initialFailure!.message),
  );
  await drain();
  expect(result.current.connectingStep.upgradeRequired).toBe(false);
  expect(ports.management.updateSource).not.toHaveBeenCalled();
  expect(props.onConnect).not.toHaveBeenCalled();
});
it("Collapsing on failure retains background action gate; restoring still preserves error", async () => {
  const active = vi.fn();
  let reject!: (error: Error) => void;
  const props = defaults({
    onFlowActiveChange: active,
    onConnect: vi.fn(
      () =>
        new Promise<string>((_, r) => {
          reject = r;
        }),
    ),
  });
  const { result, rerender } = renderHook((p) => useRemoteConnectionFlow(p), {
    initialProps: props,
  });
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => {
    reject(new Error("intent A failed"));
  });
  expect(result.current.connectingStep.errorMessage).not.toBe("");
  expect(active.mock.lastCall?.[0]).toBe(true);
  rerender({ ...props, open: true });
  await drain();
  expect(result.current.connectingStep.rawError).toBe("intent A failed");
});
it("新的入口标识重新消费同一已编辑 Profile", async () => {
  ports.snapshot.profiles = [
    { profileId: "a", transport: "docker", displayName: "A", target: targetA, createdAt: 1 },
  ];
  const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
    throw new Error("target failed");
  });
  const props = defaults({ onConnect, preferredProfileId: "a", openIntentId: 1 });
  const { result, rerender } = renderHook((p) => useRemoteConnectionFlow(p), {
    initialProps: props,
  });
  await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1));
  await drain();
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  await drain();
  ports.snapshot = {
    ...ports.snapshot,
    generation: 2,
    profiles: [
      { ...ports.snapshot.profiles[0]!, target: { kind: "docker", container: "edited-a" } },
    ],
  };
  rerender({ ...props, open: true, openIntentId: 2 });
  await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(2));
  expect(onConnect.mock.calls[1]?.[0]).toMatchObject({ container: "edited-a" });
});
it("Idle flow accepts new entry with no preferences and clears old failures", async () => {
  const props = defaults({
    onConnect: vi.fn(async () => {
      throw new Error("target failed");
    }),
    openIntentId: 1,
  });
  const { result, rerender } = renderHook((p) => useRemoteConnectionFlow(p), {
    initialProps: props,
  });
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await drain();
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  await drain();
  rerender({ ...props, open: true, openIntentId: 2 });
  await drain();
  expect(result.current.currentStep).toBe("device");
  expect(result.current.error).toBe("");
});
it("Repeated entry still applies the same distribution after WSL successfully completes", async () => {
  const props = defaults({
    preferredKind: "wsl",
    preferredWslDistro: "Ubuntu",
    isWindowsDesktop: true,
  });
  const { result, rerender } = renderHook((p) => useRemoteConnectionFlow(p), {
    initialProps: props,
  });
  await drain();
  expect(result.current.currentStep).toBe("settings");
  act(() => result.current.settingsStep.onConnect());
  await drain();
  expect(result.current.currentStep).toBe("directory");
  await act(async () => {
    await result.current.directoryStep.onSelect("/srv/test");
  });
  rerender({ ...props, open: false });
  await drain();
  rerender({ ...props, open: true });
  await drain();
  expect(result.current.currentStep).toBe("settings");
  expect(result.current.settingsStep.wslDistro).toBe("Ubuntu");
});
it("Active cancellation settles trace immediately; late rejections do not re-settle", async () => {
  let reject!: (error: Error) => void;
  const props = defaults({
    onConnect: vi.fn(
      () =>
        new Promise<string>((_, r) => {
          reject = r;
        }),
    ),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.connectingStep.onCancelConnection());
  expect(ports.trace.cancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(Object.assign(new Error("cancelled"), { code: "remote-connection-canceled" }));
  });
  expect(ports.trace.cancel).toHaveBeenCalledTimes(1);
  expect(ports.trace.complete).not.toHaveBeenCalled();
  expect(ports.trace.fail).not.toHaveBeenCalled();
});
it("Failure footer provides close and back-to-list without rewriting failure as cancel", async () => {
  const onOpenChange = vi.fn();
  const props = defaults({
    onOpenChange,
    onConnect: vi.fn(async () => {
      throw new Error("target failed");
    }),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await drain();
  render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
  expect(screen.queryByRole("button", { name: "取消连接" })).toBeNull();
  expect(screen.getByRole("button", { name: "Back to list" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await drain();
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(result.current.connectingStep.cancelled).toBe(false);
});
it("Install confirmation retained even if install preview snapshot fails", async () => {
  const props = defaults({
    onConnect: vi.fn(async () => {
      ports.management.getSnapshot.mockRejectedValue(new Error("snapshot unavailable"));
      throw Object.assign(new Error("install required"), {
        code: "source-server-install-required",
      });
    }),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await drain();
  expect(result.current.connectingStep.installConfirmation?.target).toMatchObject(targetA);
  expect(result.current.connectingStep.installConfirmation?.preview).toBeUndefined();
  expect(result.current.error).toBe("");
});
it("Explicit confirmation still required when reading force update task list fails", async () => {
  ports.snapshot.profiles = [
    { profileId: "a", transport: "docker", target: targetA, createdAt: 1 },
  ];
  ports.snapshot.states = [
    {
      profileId: "a",
      state: "needs-upgrade",
      updateAvailability: "required",
      updatedAt: 1,
      errorCode: "source-server-upgrade-required",
      upgradeTarget: "server",
    },
  ];
  ports.management.updateSource.mockImplementation(async () => {
    ports.management.getSnapshot.mockRejectedValue(new Error("task snapshot unavailable"));
    throw Object.assign(new Error("tasks active"), { code: "source-server-update-running-tasks" });
  });
  const props = defaults({
    preferredProfileId: "a",
    onConnect: vi.fn(async () => {
      throw Object.assign(new Error("upgrade required"), {
        code: "source-server-upgrade-required",
      });
    }),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() => expect(result.current.connectingStep.forceUpdate).toBeDefined());
  expect(result.current.connectingStep.forceUpdate?.tasks).toBeUndefined();
  expect(ports.management.updateSource).toHaveBeenCalledTimes(1);
  expect(ports.management.updateSource).toHaveBeenCalledWith({
    profileId: "a",
    expectedTarget: targetA,
    force: false,
  });
  act(() => result.current.connectingStep.forceUpdate?.onCancel());
  await drain();
  expect(ports.management.updateSource).toHaveBeenCalledTimes(1);
});
it("New target replaces old install wait; cannot confirm install on old device upon failure", async () => {
  const onConnect = vi
    .fn<RemoteConnectionFlowOptions["onConnect"]>()
    .mockRejectedValueOnce(
      Object.assign(new Error("A needs install"), { code: "source-server-install-required" }),
    )
    .mockRejectedValue(new Error("B failed"));
  const props = defaults({ onConnect, openIntentId: 1 });
  const { result, rerender } = renderHook((p) => useRemoteConnectionFlow(p), {
    initialProps: props,
  });
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await drain();
  expect(result.current.connectingStep.installConfirmation?.target).toMatchObject(targetA);
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  await drain();
  rerender({
    ...props,
    open: true,
    openIntentId: 2,
    preferredTarget: { kind: "docker", container: "b" },
  });
  await drain();
  act(() => result.current.settingsStep.onConnect());
  await drain();
  expect(result.current.connectingStep.target).toMatchObject({ container: "b" });
  expect(result.current.connectingStep.installConfirmation).toBeUndefined();
});

it("New WSL entry revokes late credential read from old Profile", async () => {
  let resolveCredential!: (value: string) => void;
  ports.credentialService.load.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveCredential = resolve;
      }),
  );
  ports.snapshot.profiles = [
    {
      profileId: "a",
      transport: "ssh",
      target: { kind: "ssh", host: "a", username: "dev", passwordCredentialKey: "secret-ref" },
      createdAt: 1,
    },
  ];
  const props = defaults({ preferredProfileId: "a", isWindowsDesktop: true, openIntentId: 1 });
  const { result, rerender } = renderHook((options) => useRemoteConnectionFlow(options), {
    initialProps: props,
  });
  await waitFor(() => expect(ports.credentialService.load).toHaveBeenCalled());
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  await drain();
  rerender({
    ...props,
    preferredProfileId: undefined,
    preferredKind: "wsl",
    preferredWslDistro: "Ubuntu",
    open: true,
    openIntentId: 2,
  });
  await drain();
  await act(async () => resolveCredential("late-secret"));
  expect(props.onConnect).not.toHaveBeenCalled();
  expect(result.current.currentStep).toBe("settings");
  expect(result.current.settingsStep.kind).toBe("wsl");
});
it("Reuse hint flag for new intent continues passing after install confirmation and does not enter Host context", async () => {
  const onConnect = vi
    .fn<RemoteConnectionFlowOptions["onConnect"]>()
    .mockRejectedValueOnce(
      Object.assign(new Error("install"), { code: "source-server-install-required" }),
    )
    .mockResolvedValue("session-a");
  const { result } = renderHook(() => useRemoteConnectionFlow(defaults({ onConnect })));
  await drain();
  act(() => result.current.selectionStep.onNewConnection("docker"));
  act(() => result.current.settingsStep.onManualDockerContainerChange("manual-container"));
  act(() => result.current.settingsStep.onConnect());
  await drain();
  expect(onConnect).toHaveBeenLastCalledWith(
    { kind: "docker", container: "manual-container" },
    expect.any(String),
    undefined,
    { announceReusedConnection: true },
  );
  act(() => result.current.connectingStep.installConfirmation?.onConfirm());
  await drain();
  expect(onConnect).toHaveBeenLastCalledWith(
    { kind: "docker", container: "manual-container" },
    expect.any(String),
    { confirmSourceServerInstall: true },
    { announceReusedConnection: true },
  );
});

it("Original project clears old errors after install handover confirmation and continues original directory with install authorization", async () => {
  const props = prepareProjectUpgrade();
  props.initialFailure = { code: "source-server-install-required", message: "install required" };
  ports.snapshot.states = [
    {
      profileId: "project-profile",
      state: "needs-install",
      errorCode: "source-server-install-required",
      updatedAt: 1,
    },
  ];
  const connecting = Promise.withResolvers<string>();
  props.onConnect = vi.fn(() => connecting.promise);
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() => expect(result.current.connectingStep.installConfirmation).toBeDefined());
  act(() => result.current.connectingStep.installConfirmation!.onConfirm());
  await drain();
  expect(props.onConnect).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "ssh" }),
    expect.any(String),
    { confirmSourceServerInstall: true },
  );
  expect(result.current.error).toBe("");
  await act(async () => {
    connecting.resolve("session-a");
  });
  await waitFor(() =>
    expect(props.onSelectProject).toHaveBeenCalledWith("session-a", "/repo-b", undefined),
  );
});

it("Saved project only hands over exact Profile, continuing original directory after install confirmation instead of device directory selection", async () => {
  const props = prepareProjectUpgrade();
  const profile = ports.snapshot.profiles[0]!;
  ports.snapshot.profiles = [{ ...profile, sourceServerId: "source-1" }];
  ports.snapshot.servers = [
    {
      sourceServerId: "source-1",
      displayName: "dev",
      declaredWorkspaces: [],
      preferredProfileId: profile.profileId,
    },
  ];
  ports.snapshot.states = [
    {
      profileId: profile.profileId,
      sourceServerId: "source-1",
      state: "needs-install",
      errorCode: "source-server-install-required",
      updatedAt: 1,
    },
  ];
  const openWizard = vi.fn();
  await requestRetainedRemoteProjectConnection({
    workspaceKey: "remote:server:source-1:/repo-b",
    service: {
      readDirectory: async () => ({
        hosts: [{ id: "remote:server:source-1", membershipId: "m", target: profile.target }],
        entries: [{ id: "p", hostId: "remote:server:source-1", roots: [{ rootPath: "/repo-b" }] }],
      }),
      connectHost: vi.fn(),
    } as never,
    getSnapshot: async () => ports.snapshot,
    openWizard,
  });
  const preference = openWizard.mock.calls[0]![0];
  expect(preference).not.toHaveProperty("preferredSourceServerId");
  const { result } = renderHook(() => useRemoteConnectionFlow({ ...props, ...preference }));
  await waitFor(() => expect(result.current.connectingStep.installConfirmation).toBeDefined());
  expect(props.onConnect).not.toHaveBeenCalled();
  act(() => result.current.connectingStep.installConfirmation!.onConfirm());
  await waitFor(() =>
    expect(props.onSelectProject).toHaveBeenCalledWith("session-a", "/repo-b", undefined),
  );
  expect(props.onConnect).toHaveBeenCalledOnce();
  expect(props.onConnect).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "ssh" }),
    expect.any(String),
    { confirmSourceServerInstall: true },
  );
});

it.each([false, true])(
  "Do not enter directory selection when original project completion is canceled; only release new attachment (reuse=%s)",
  async (reused) => {
    const props = prepareProjectUpgrade();
    props.initialFailure = undefined;
    props.onProjectIntentCleared = vi.fn();
    props.onSelectProject = vi.fn(async () => {
      throw Object.assign(new Error("project.navigation-cancelled"), {
        code: "remote-connection-canceled",
      });
    });
    if (reused)
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { "session-a": { sessionId: "session-a" } as never },
      });
    const { result } = renderHook(() => useRemoteConnectionFlow(props));
    await waitFor(() => expect(result.current.connectingStep.cancelled).toBe(true));
    expect(result.current.currentStep).not.toBe("directory");
    expect(props.onProjectIntentCleared).toHaveBeenCalledOnce();
    if (reused) expect(props.onCancelSession).not.toHaveBeenCalled();
    else expect(props.onCancelSession).toHaveBeenCalledWith("session-a");
  },
);

it.each([false, true])(
  "Close wizard after device management completes, skip directory selection and only release this attachment (reuse=%s)",
  async (reused) => {
    if (reused)
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: {
          "session-a": { sessionId: "session-a", sourceServerId: "source-1" } as never,
        },
      });
    const onDeviceConnected = vi.fn();
    const props = defaults({
      completion: "device-management",
      onDeviceConnected,
      onOpenChange: vi.fn(),
    });
    props.onConnect = vi.fn(async () => {
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: {
          "session-a": { sessionId: "session-a", sourceServerId: "source-1" } as never,
        },
      });
      return "session-a";
    });
    const { result } = renderHook(() => useRemoteConnectionFlow(props));
    await drain();
    act(() => result.current.selectionStep.onSelectTarget(targetA));
    await waitFor(() =>
      expect(onDeviceConnected).toHaveBeenCalledWith("source-1", expect.any(Function)),
    );
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(result.current.currentStep).not.toBe("directory");
    if (reused) expect(props.onCancelSession).not.toHaveBeenCalled();
    else expect(props.onCancelSession).toHaveBeenCalledWith("session-a");
  },
);

it("设备管理取消后的迟到连接不能完成导航或关闭新界面", async () => {
  const connection = Promise.withResolvers<string>();
  const onDeviceConnected = vi.fn();
  const props = defaults({
    completion: "device-management",
    onDeviceConnected,
    onConnect: vi.fn(() => connection.promise),
    onOpenChange: vi.fn(),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await waitFor(() => expect(props.onConnect).toHaveBeenCalled());
  await act(async () => result.current.connectingStep.onClose());
  await act(async () => connection.resolve("session-a"));
  expect(onDeviceConnected).not.toHaveBeenCalled();
  expect(props.onSelectProject).not.toHaveBeenCalled();
  expect(props.onOpenChange).toHaveBeenCalledWith(false);
  expect(props.onCancelSession).toHaveBeenCalledWith("session-a");
});

it("After canceling device addition, invalidated install confirmation cannot reconnect", async () => {
  const props = defaults({
    completion: "device-management",
    onDeviceConnected: vi.fn(),
    onConnect: vi.fn(async () => {
      throw Object.assign(new Error("install required"), {
        code: "source-server-install-required",
      });
    }),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await waitFor(() => expect(result.current.connectingStep.installConfirmation).toBeDefined());
  const confirmation = result.current.connectingStep.installConfirmation!;
  act(() => confirmation.onCancel());
  await act(async () => confirmation.onConfirm());
  expect(props.onConnect).toHaveBeenCalledOnce();
  expect(result.current.connectingStep.cancelled).toBe(true);
});

it("New setup directly opens SSH categorized form; switching and candidates only prepare config, dialing only upon submit", async () => {
  const props = defaults({ completion: "device-management" });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  expect(result.current.currentStep).toBe("settings");
  expect(result.current.settingsStep.kind).toBe("ssh");
  expect(result.current.connectingStep.backToDevicesLabel).toBe("新建连接");
  expect(result.current.settingsStep.availableKinds).not.toContain("wsl");
  act(() => {
    result.current.settingsStep.onHostChange("first.example.com");
    result.current.settingsStep.onPasswordChange("first-secret");
  });
  act(() => result.current.settingsStep.onKindChange?.("ssh"));
  expect(result.current.settingsStep.password).toBe("first-secret");
  act(() => result.current.settingsStep.onKindChange?.("docker"));
  act(() => result.current.settingsStep.onDockerContainerChange("dev-container"));
  expect(props.onConnect).not.toHaveBeenCalled();
  expect(result.current.settingsStep.password).toBe("");
  act(() => result.current.settingsStep.onConnect());
  await drain();
  expect(props.onConnect).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "docker", container: "dev-container" }),
    expect.any(String),
    undefined,
  );
});

it("手动换 SSH 目标清空旧凭据，发现迟到不覆盖新目标", async () => {
  let resolveAliases!: (aliases: SSHConfigAliasOption[]) => void;
  ports.platform.listSSHConfigAliases.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveAliases = resolve;
      }),
  );
  const props = defaults({ completion: "device-management" });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => {
    result.current.settingsStep.onHostChange("first.example.com");
    result.current.settingsStep.onUsernameChange("dev");
    result.current.settingsStep.onPasswordChange("first-secret");
    result.current.settingsStep.onPrivateKeyPassphraseChange("first-passphrase");
  });
  act(() => result.current.settingsStep.onHostChange("second.example.com"));
  expect(result.current.settingsStep.password).toBe("");
  expect(result.current.settingsStep.privateKeyPassphrase).toBe("");
  await act(async () => resolveAliases([{ alias: "late", host: "late.example.com" }]));
  expect(result.current.settingsStep.host).toBe("second.example.com");
  expect(props.onConnect).not.toHaveBeenCalled();
});

it("分类表单允许发现失败时手动添加，失败与没有运行容器有不同提示", async () => {
  ports.platform.listDockerContainers.mockRejectedValue(new Error("discovery offline"));
  const props = defaults({ completion: "device-management" });
  function Settings() {
    const flow = useRemoteConnectionFlow(props);
    return createElement(RemoteConnectionSettingsStep, flow.settingsStep);
  }
  render(createElement(Settings));
  fireEvent.click(screen.getByRole("button", { name: "Docker", exact: true }));
  await screen.findAllByText(zhCN["remote.optionsLoadFailed"]);
  expect(screen.queryByText(zhCN["docker.noContainers"])).toBeNull();
  const input = screen.getByTestId("docker-container-input");
  fireEvent.change(input, { target: { value: "manual-container" } });
  expect(props.onConnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "添加并连接" }));
  await waitFor(() => expect(props.onConnect).toHaveBeenCalled());
});

it("同一 SSH 地址去除空白不丢失凭据", async () => {
  const props = defaults({ completion: "device-management" });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => {
    result.current.settingsStep.onHostChange(" example.com ");
    result.current.settingsStep.onUsernameChange(" dev ");
    result.current.settingsStep.onPasswordChange("secret");
  });
  act(() => {
    result.current.settingsStep.onHostChange("example.com");
    result.current.settingsStep.onUsernameChange("dev");
  });
  expect(result.current.settingsStep.password).toBe("secret");
});

it("Late Docker discovery request cannot clear the new round of selections", async () => {
  let resolveOld!: (containers: DockerContainerInfo[]) => void;
  ports.platform.listDockerContainers.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const { result } = renderHook(() =>
    useRemoteConnectionFlow(defaults({ completion: "device-management" })),
  );
  act(() => result.current.settingsStep.onKindChange?.("docker"));
  await drain();
  act(() => result.current.settingsStep.onKindChange?.("ssh"));
  act(() => result.current.settingsStep.onKindChange?.("docker"));
  await drain();
  act(() => result.current.settingsStep.onDockerContainerChange("new-container"));
  await act(async () => resolveOld([]));
  expect(result.current.settingsStep.dockerContainer).toBe("new-container");
});

it("Manual refresh of loaded list also invalidates after switching types", async () => {
  let resolveRefresh!: (containers: DockerContainerInfo[]) => void;
  const props = defaults({ completion: "device-management" });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  act(() => result.current.settingsStep.onKindChange?.("docker"));
  await drain();
  ports.platform.listDockerContainers.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  );
  act(() => result.current.settingsStep.onDockerContainersRefresh?.());
  await drain();
  act(() => result.current.settingsStep.onKindChange?.("ssh"));
  act(() => result.current.settingsStep.onKindChange?.("docker"));
  act(() => result.current.settingsStep.onDockerContainerChange("new-selection"));
  await act(async () => resolveRefresh([]));
  expect(result.current.settingsStep.dockerContainer).toBe("new-selection");
});

it("Project return intent completes only upon explicit cancellation; background collapse is not treated as cancel", async () => {
  const onCancelled = vi.fn();
  const props = defaults({ completion: "device-management", onCancelled, onOpenChange: vi.fn() });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => result.current.header.onMinimize());
  expect(onCancelled).not.toHaveBeenCalled();
  await act(async () => result.current.handleOpenChange(false));
  expect(onCancelled).toHaveBeenCalledOnce();
});

it("Project return intent completes when install wait is canceled and does not accept late confirmation", async () => {
  const onCancelled = vi.fn();
  const props = defaults({
    completion: "device-management",
    onCancelled,
    onOpenChange: vi.fn(),
    onConnect: vi.fn(async () => {
      throw Object.assign(new Error("install"), { code: "source-server-install-required" });
    }),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await waitFor(() => expect(result.current.connectingStep.installConfirmation).toBeDefined());
  const confirmation = result.current.connectingStep.installConfirmation!;
  act(() => confirmation.onCancel());
  expect(onCancelled).toHaveBeenCalledOnce();
  await act(async () => confirmation.onConfirm());
  expect(props.onConnect).toHaveBeenCalledOnce();
});

it("Successful background device connection retains result and delivers once only upon explicit continue", async () => {
  let complete!: (id: string) => void;
  const connected = vi.fn();
  const active = vi.fn();
  const props = defaults({
    completion: "device-management",
    onDeviceConnected: connected,
    onFlowActiveChange: active,
    onConnect: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    ),
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await waitFor(() => expect(complete).toBeDefined());
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => complete("session-a"));
  expect(connected).not.toHaveBeenCalled();
  expect(result.current.minimizedProgress).not.toBeNull();
  const continueOperation = result.current.minimizedProgress!.onResume;
  await act(async () => {
    continueOperation();
    continueOperation();
  });
  expect(connected).toHaveBeenCalledTimes(1);
  expect(props.onConnect).toHaveBeenCalledTimes(1);
  expect(active.mock.lastCall?.[0]).toBe(false);
});

it.each(["connecting", "completed"])(
  "Normal entry restores original completion action when reopening background device connection: %s",
  async (phase) => {
    const connection = Promise.withResolvers<string>();
    const connected = vi.fn();
    const active = vi.fn();
    const props = defaults({
      openIntentId: 1,
      completion: "device-management",
      onDeviceConnected: connected,
      onFlowActiveChange: active,
      onOpenChange: vi.fn(),
      onConnect: vi.fn(() => connection.promise),
    });
    const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
      initialProps: props,
    });
    act(() => result.current.selectionStep.onSelectTarget(targetA));
    act(() => result.current.connectingStep.onMinimize());
    rerender({ ...props, open: false });
    if (phase === "completed") await act(async () => connection.resolve("session-a"));
    const oldResume = result.current.minimizedProgress!.onResume;
    expect(active.mock.lastCall?.[0]).toBe(true);

    rerender({ ...props, open: true });
    if (phase === "connecting") await act(async () => connection.resolve("session-a"));
    await waitFor(() => expect(connected).toHaveBeenCalledOnce());
    await act(async () => {
      oldResume();
      oldResume();
    });
    rerender({ ...props, open: true });
    expect(connected).toHaveBeenCalledOnce();
    expect(props.onConnect).toHaveBeenCalledOnce();
    expect(props.onSelectProject).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(active.mock.lastCall?.[0]).toBe(false);
    expect(result.current.minimizedProgress).toBeNull();
  },
);

it("After normal entry restores background completion, cancellation invalidates late device validation and old continue", async () => {
  const connection = Promise.withResolvers<string>();
  const validation = Promise.withResolvers<SourceServerManagementSnapshot>();
  ports.snapshot.servers = [{ sourceServerId: "source-a", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-a", state: "online" } as never];
  const props = defaults({
    openIntentId: 1,
    completion: "device-management",
    onDeviceConnected: vi.fn(),
    onCancelled: vi.fn(),
    onOpenChange: vi.fn(),
    onConnect: vi.fn(async () => {
      const id = await connection.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { [id]: { sessionId: id, sourceServerId: "source-a" } as never },
      });
      return id;
    }),
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => connection.resolve("session-a"));
  const oldResume = result.current.minimizedProgress!.onResume;
  const readSnapshot = vi.fn(() => validation.promise);
  ports.management.getSnapshot.mockImplementationOnce(readSnapshot);
  rerender({ ...props, open: true });
  await waitFor(() => expect(readSnapshot).toHaveBeenCalledOnce());
  await act(async () => result.current.handleOpenChange(false));
  await act(async () => {
    validation.resolve(ports.snapshot);
    oldResume();
  });
  expect(props.onCancelled).toHaveBeenCalledOnce();
  expect(props.onDeviceConnected).not.toHaveBeenCalled();
  expect(props.onConnect).toHaveBeenCalledOnce();
  expect(props.onOpenChange).toHaveBeenLastCalledWith(false);
});

it.each(["directory", "project"])("Background %s completion does not navigate; old continue does not revive after cancellation", async (kind) => {
  let complete!: (id: string) => void;
  const navigate = vi.fn(async () => {});
  const cancelled = vi.fn();
  const props = defaults({
    ...(kind === "project" ? { onConnectionReady: navigate } : { preferredDirectoryPath: "/work" }),
    onSelectProject: navigate,
    onCancelled: cancelled,
    onConnect: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    ),
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await waitFor(() => expect(complete).toBeDefined());
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => complete("session-a"));
  expect(navigate).not.toHaveBeenCalled();
  const oldContinue = result.current.minimizedProgress!.onResume;
  await act(async () => result.current.handleOpenChange(false));
  expect(cancelled).toHaveBeenCalledWith(true);
  await act(async () => oldContinue());
  expect(navigate).not.toHaveBeenCalled();
  expect(props.onCancelSession).toHaveBeenCalledWith("session-a");
});

it("Device disconnected after background completion; old continue does not deliver success and retains actionable error", async () => {
  const connection = Promise.withResolvers<string>();
  ports.snapshot.servers = [{ sourceServerId: "source-a", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-a", state: "online" } as never];
  const connected = vi.fn();
  const props = defaults({
    completion: "device-management",
    onDeviceConnected: connected,
    onConnect: vi.fn(async () => {
      const id = await connection.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { [id]: { sessionId: id, sourceServerId: "source-a" } as never },
      });
      return id;
    }),
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => connection.resolve("session-a"));
  ports.snapshot = {
    ...ports.snapshot,
    generation: 2,
    states: [{ sourceServerId: "source-a", state: "offline" } as never],
  };
  await act(async () => result.current.minimizedProgress!.onResume());
  expect(connected).not.toHaveBeenCalled();
  expect(result.current.minimizedProgress?.error).toContain("设备");
  expect(props.onConnect).toHaveBeenCalledTimes(1);
});

it.each([false, true])("Background directory cancel only releases attachment created this time, reuse=%s", async (reused) => {
  if (reused)
    useRemoteWorkspaceSessionStore.setState({
      sessionsById: { "session-a": { sessionId: "session-a" } as never },
    });
  const connection = Promise.withResolvers<string>();
  const props = defaults({ onConnect: vi.fn(() => connection.promise) });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => connection.resolve("session-a"));
  await act(async () => result.current.handleOpenChange(false));
  if (reused) expect(props.onCancelSession).not.toHaveBeenCalled();
  else expect(props.onCancelSession).toHaveBeenCalledWith("session-a");
});

it.each([false, true])("Async confirmation of background device maintains entry gate, collapse again=%s", async (minimizeAgain) => {
  const connection = Promise.withResolvers<string>();
  const validation = Promise.withResolvers<SourceServerManagementSnapshot>();
  ports.snapshot.servers = [{ sourceServerId: "source-a", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-a", state: "online" } as never];
  const active = vi.fn();
  const props = defaults({
    completion: "device-management",
    onFlowActiveChange: active,
    onDeviceConnected: vi.fn(),
    onConnect: vi.fn(async () => {
      const id = await connection.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { [id]: { sessionId: id, sourceServerId: "source-a" } as never },
      });
      return id;
    }),
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => connection.resolve("session-a"));
  ports.management.getSnapshot.mockImplementationOnce(() => validation.promise);
  act(() => result.current.minimizedProgress!.onResume());
  expect(active.mock.lastCall?.[0]).toBe(true);
  if (minimizeAgain) act(() => result.current.header.onMinimize());
  await act(async () => validation.resolve(ports.snapshot));
  if (minimizeAgain) {
    expect(props.onDeviceConnected).not.toHaveBeenCalled();
    expect(active.mock.lastCall?.[0]).toBe(true);
    await act(async () => result.current.minimizedProgress!.onResume());
  }
  expect(active.mock.lastCall?.[0]).toBe(false);
  expect(props.onDeviceConnected).toHaveBeenCalledOnce();
});

it.each(["cancel", "replace", "current"])(
  "Delayed snapshot failure of background continue handled by entry generation: %s",
  async (action) => {
    const connection = Promise.withResolvers<string>();
    const validation = Promise.withResolvers<SourceServerManagementSnapshot>();
    ports.snapshot.servers = [{ sourceServerId: "source-a", displayName: "Device" } as never];
    ports.snapshot.states = [{ sourceServerId: "source-a", state: "online" } as never];
    const onOpenChange = vi.fn();
    const props = defaults({
      openIntentId: 1,
      completion: "device-management",
      onOpenChange,
      onDeviceConnected: vi.fn(),
      onConnect: vi.fn(async () => {
        const id = await connection.promise;
        useRemoteWorkspaceSessionStore.setState({
          sessionsById: { [id]: { sessionId: id, sourceServerId: "source-a" } as never },
        });
        return id;
      }),
    });
    const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
      initialProps: props,
    });
    act(() => result.current.selectionStep.onSelectTarget(targetA));
    act(() => result.current.connectingStep.onMinimize());
    rerender({ ...props, open: false });
    await act(async () => connection.resolve("session-a"));
    ports.management.getSnapshot.mockImplementationOnce(() => validation.promise);
    act(() => result.current.minimizedProgress!.onResume());
    if (action === "cancel") await act(async () => result.current.handleOpenChange(false));
    if (action === "replace") {
      rerender({ ...props, openIntentId: 2 });
      await drain();
    }
    onOpenChange.mockClear();
    await act(async () => validation.reject(new Error("late resume snapshot failure")));
    if (action === "current") {
      expect(result.current.error).toContain("late resume snapshot failure");
      expect(onOpenChange).toHaveBeenCalledWith(true);
    } else {
      expect(result.current.error).not.toContain("late resume snapshot failure");
      expect(onOpenChange).not.toHaveBeenCalledWith(true);
    }
    expect(props.onDeviceConnected).not.toHaveBeenCalled();
  },
);

it.each([false, true])("First remote introduction must be explicitly confirmed before completing original intent (background=%s)", async (background) => {
  ports.settingService.get.mockResolvedValue({ remoteBoundaryOnboardingVersion: 2 });
  const ack = Promise.withResolvers<boolean>();
  ports.confirm.mockImplementationOnce(() => ack.promise);
  const connected = Promise.withResolvers<string>();
  ports.snapshot.servers = [{ sourceServerId: "source-a", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-a", state: "online" } as never];
  const onDeviceConnected = vi.fn();
  const props = defaults({
    completion: "device-management",
    onDeviceConnected,
    onConnect: async () => {
      const id = await connected.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { [id]: { sessionId: id, sourceServerId: "source-a" } as never },
      });
      return id;
    },
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  if (background) {
    act(() => result.current.connectingStep.onMinimize());
    rerender({ ...props, open: false });
  }
  await act(async () => connected.resolve("session-a"));
  if (background) {
    expect(ports.confirm).not.toHaveBeenCalled();
    act(() => result.current.minimizedProgress!.onResume());
  }
  await waitFor(() =>
    expect(ports.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: "source-server-boundary",
        requiredAcknowledgement: true,
      }),
    ),
  );
  expect(ports.settingService.update).not.toHaveBeenCalled();
  expect(onDeviceConnected).not.toHaveBeenCalled();
  await act(async () => ack.resolve(true));
  await waitFor(() =>
    expect(onDeviceConnected).toHaveBeenCalledWith("source-a", expect.any(Function)),
  );
  expect(ports.settingService.update).toHaveBeenCalledWith({
    remoteBoundaryIntroAcknowledgedVersion: 1,
  });
});

import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
it.each([
  ["close", "dismiss"],
  ["close", "confirm"],
  ["back", "dismiss"],
  ["back", "confirm"],
] as const)("Retain completion when connection succeeds and hits confirmation dialog, entry=%s, choice=%s", async (action, choice) => {
  useConfirmDialogStore.setState({ pendingRequest: undefined });
  ports.confirm.mockImplementation((payload) =>
    useConfirmDialogStore.getState().requestConfirmation(payload),
  );
  ports.settingService.get.mockResolvedValue({ remoteBoundaryOnboardingVersion: 2 });
  const connected = Promise.withResolvers<string>();
  const onFlowActiveChange = vi.fn();
  const props = defaults({
    onFlowActiveChange,
    onConnect: async () => {
      const id = await connected.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { [id]: { sessionId: id, sourceServerId: "source-a" } as never },
      });
      return id;
    },
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() =>
    action === "close" ? result.current.header.onClose() : result.current.connectingStep.onBack(),
  );
  expect(useConfirmDialogStore.getState().pendingRequest).toBeTruthy();
  await act(async () => connected.resolve("session-a"));
  await drain();
  expect(onFlowActiveChange).toHaveBeenLastCalledWith(true);
  await act(async () => useConfirmDialogStore.getState().settleChoice(choice));
  if (choice === "confirm") {
    expect(useConfirmDialogStore.getState().pendingRequest).toBeUndefined();
    expect(ports.settingService.update).not.toHaveBeenCalled();
    expect(props.onCancelSession).toHaveBeenCalledWith("session-a");
    return;
  }
  await drain();
  const pending = useConfirmDialogStore.getState().pendingRequest;
  if (pending?.intent === "source-server-boundary") {
    await act(async () => useConfirmDialogStore.getState().settleChoice("confirm"));
  }
  expect(result.current.currentStep).toBe("directory");
});
it("Collapsing while reading intro status retains result; explicit continue is required to introduce and deliver", async () => {
  useConfirmDialogStore.setState({ pendingRequest: undefined });
  ports.confirm.mockImplementation((payload) =>
    useConfirmDialogStore.getState().requestConfirmation(payload),
  );
  const read = Promise.withResolvers<{ remoteBoundaryOnboardingVersion: number }>();
  const connected = Promise.withResolvers<string>();
  const onDeviceConnected = vi.fn();
  const props = defaults({
    completion: "device-management",
    onDeviceConnected,
    onConnect: async () => {
      const id = await connected.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { [id]: { sessionId: id, sourceServerId: "source-a" } as never },
      });
      return id;
    },
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  await drain();
  ports.settingService.get.mockImplementation(() => read.promise);
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await act(async () => connected.resolve("session-a"));
  await drain();
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => read.resolve({ remoteBoundaryOnboardingVersion: 2 }));
  await drain();
  expect(ports.confirm).not.toHaveBeenCalled();
  expect(onDeviceConnected).not.toHaveBeenCalled();
  ports.snapshot.servers = [{ sourceServerId: "source-a", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-a", state: "online" } as never];
  await act(async () => result.current.minimizedProgress!.onResume());
  expect(useConfirmDialogStore.getState().pendingRequest?.intent).toBe("source-server-boundary");
  await act(async () => useConfirmDialogStore.getState().settleChoice("confirm"));
  expect(onDeviceConnected).toHaveBeenCalledExactlyOnceWith("source-a", expect.any(Function));
});

it("Collapsing while saving intro confirmation retains result; explicit continue delivers once only", async () => {
  useConfirmDialogStore.setState({ pendingRequest: undefined });
  ports.confirm.mockImplementation((payload) =>
    useConfirmDialogStore.getState().requestConfirmation(payload),
  );
  ports.settingService.get.mockResolvedValue({ remoteBoundaryOnboardingVersion: 2 });
  const persisted = Promise.withResolvers<void>();
  ports.settingService.update.mockImplementationOnce(() => persisted.promise);
  const onDeviceConnected = vi.fn();
  const props = defaults({
    completion: "device-management",
    onDeviceConnected,
    onConnect: async () => {
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: {
          "session-a": { sessionId: "session-a", sourceServerId: "source-a" } as never,
        },
      });
      return "session-a";
    },
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await drain();
  expect(useConfirmDialogStore.getState().pendingRequest?.intent).toBe("source-server-boundary");
  await act(async () => useConfirmDialogStore.getState().settleChoice("confirm"));
  expect(ports.settingService.update).toHaveBeenCalled();
  act(() => result.current.header.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => persisted.resolve());
  await drain();
  expect(onDeviceConnected).not.toHaveBeenCalled();
  ports.settingService.get.mockResolvedValue({ remoteBoundaryIntroAcknowledgedVersion: 1 });
  ports.snapshot.servers = [{ sourceServerId: "source-a", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-a", state: "online" } as never];
  const resume = result.current.minimizedProgress!.onResume;
  await act(async () => {
    resume();
    resume();
  });
  expect(onDeviceConnected).toHaveBeenCalledExactlyOnceWith("source-a", expect.any(Function));
  expect(ports.confirm).toHaveBeenCalledTimes(1);
});

it("Canceling during intro read releases current exclusive attachment; late results do not revive", async () => {
  const read = Promise.withResolvers<{ remoteBoundaryOnboardingVersion: number }>();
  const props = defaults({
    onConnect: vi.fn(async () => {
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: {
          "session-a": { sessionId: "session-a", sourceServerId: "source-a" } as never,
        },
      });
      return "session-a";
    }),
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  ports.settingService.get.mockImplementation(() => read.promise);
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await drain();
  act(() => result.current.connectingStep.onCancelConnection());
  expect(props.onCancelSession).toHaveBeenCalledExactlyOnceWith("session-a");
  await act(async () => read.resolve({ remoteBoundaryOnboardingVersion: 2 }));
  expect(ports.confirm).not.toHaveBeenCalled();
  expect(ports.settingService.update).not.toHaveBeenCalled();
  expect(result.current.connectingStep.cancelled).toBe(true);
});

const editedUpgradeTargets = [
  [
    { kind: "ssh", host: "a.example.com", username: "dev", port: 22 },
    { kind: "ssh", host: "b.example.com", username: "dev", port: 22 },
  ],
  [
    { kind: "wsl", distro: "Ubuntu", user: "dev" },
    { kind: "wsl", distro: "Ubuntu", user: "other" },
  ],
  [
    { kind: "docker", container: "a" },
    { kind: "docker", container: "b" },
  ],
] as const;
it.each(editedUpgradeTargets)(
  "After upgrade fails %j, address change with same ID must not update or reconnect to new target",
  async (target, edited) => {
    const profileId = "17ef20b3-622d-4a53-98c1-0cdff29f3e6d";
    ports.snapshot.profiles = [{ profileId, transport: target.kind, target, createdAt: 1 }];
    ports.snapshot.states = [
      {
        profileId,
        state: "needs-upgrade",
        upgradeTarget: "server",
        updateAvailability: "required",
        updatedAt: 1,
      },
    ];
    ports.management.updateSource.mockImplementation(async () => ports.snapshot);
    let release: (() => void) | undefined;
    let failed = false;
    ports.management.getSnapshot.mockImplementation(async (options?: unknown) => {
      if (failed && options === undefined)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return ports.snapshot;
    });
    const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
      if (failed) throw new Error("unexpected reconnect");
      failed = true;
      throw Object.assign(new Error(upgradeFailure.message), upgradeFailure, { profileId });
    });
    const { result } = renderHook(() => useRemoteConnectionFlow(defaults({ onConnect })));
    act(() => result.current.selectionStep.onSelectTarget(target));
    await waitFor(() => expect(release).toBeDefined());
    ports.snapshot.profiles = [{ profileId, transport: edited.kind, target: edited, createdAt: 1 }];
    await act(async () => release!());
    await waitFor(() => expect(result.current.connectingStep.loading).toBe(false));
    expect(ports.management.updateSource).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalledOnce();
    expect(result.current.connectingStep.target).toMatchObject(target);
    render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Update Remote" })).toBeNull();
  },
);

it("Host rejects address change after snapshot verification; old upgrade exits and explicit retry retains original directory", async () => {
  const props = prepareProjectUpgrade();
  ports.management.updateSource.mockRejectedValueOnce(
    Object.assign(new Error("target changed"), { code: "remote-target-changed" }),
  );
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() => expect(result.current.connectingStep.upgradeRequired).toBe(false));
  await waitFor(() => expect(result.current.connectingStep.errorMessage).toBeTruthy());
  expect(props.onConnect).not.toHaveBeenCalled();
  expect(props.onSelectProject).not.toHaveBeenCalled();
  render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
  expect(screen.queryByRole("button", { name: "Update Remote" })).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "重试" })));
  await waitFor(() =>
    expect(props.onSelectProject).toHaveBeenCalledWith("session-a", "/repo-b", undefined),
  );
  expect(props.onConnect).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "ssh", host: "example.com" }),
    expect.any(String),
    undefined,
  );
});
it("WSL original project upgrade handover retains resolved identity without guessing default user from latest Profile", async () => {
  const profileId = wslProfileId;
  ports.snapshot.profiles = [
    { profileId, transport: "wsl", target: resolvedWslTarget, createdAt: 1 },
  ];
  ports.snapshot.states = [
    {
      profileId,
      state: "needs-upgrade",
      upgradeTarget: "server",
      updateAvailability: "required",
      updatedAt: 1,
    },
  ];
  ports.management.updateSource.mockResolvedValue(ports.snapshot);
  const openWizard = vi.fn();
  await requestRemoteProjectConnection({
    preference: { preferredTarget: { kind: "wsl" }, preferredDirectoryPath: "/repo-a" },
    presentation: resolveRemoteConnectionPresentation({}),
    reconnect: async () => {
      throw Object.assign(new Error(upgradeFailure.message), upgradeFailure, {
        profileId,
        resolvedWslTarget,
      });
    },
    openWizard,
  });
  expect(openWizard.mock.calls[0]?.[0].initialFailure.resolvedWslTarget).toEqual(resolvedWslTarget);
  const props = defaults(openWizard.mock.calls[0]![0]);
  renderHook(() => useRemoteConnectionFlow(props));
  await waitFor(() =>
    expect(props.onSelectProject).toHaveBeenCalledWith("session-a", "/repo-a", undefined),
  );
  expect(ports.management.updateSource).toHaveBeenCalledWith({
    profileId,
    expectedTarget: resolvedWslTarget,
    force: false,
  });
  expect(props.onConnect).toHaveBeenCalledWith(resolvedWslTarget, expect.any(String), undefined);
});
it("WSL upgrade only provides retry when resolved identity is missing", async () => {
  ports.snapshot.profiles = [
    { profileId: wslProfileId, transport: "wsl", target: resolvedWslTarget, createdAt: 1 },
  ];
  ports.snapshot.states = [
    {
      profileId: wslProfileId,
      state: "needs-upgrade",
      upgradeTarget: "server",
      updateAvailability: "required",
      updatedAt: 1,
    },
  ];
  const onConnect = vi.fn<RemoteConnectionFlowOptions["onConnect"]>(async () => {
    throw Object.assign(new Error(upgradeFailure.message), upgradeFailure, {
      profileId: wslProfileId,
    });
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(defaults({ onConnect })));
  act(() => result.current.selectionStep.onSelectTarget({ kind: "wsl" }));
  await waitFor(() => expect(result.current.connectingStep.loading).toBe(false));
  expect(ports.management.updateSource).not.toHaveBeenCalled();
  render(createElement(RemoteConnectionConnectingStep, result.current.connectingStep));
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
});

it.each(editedUpgradeTargets)(
  "Original project %j address change with same ID before handover does not consume new route credentials or upgrade",
  async (target, edited) => {
    const profileId = wslProfileId;
    ports.snapshot.profiles = [{ profileId, transport: edited.kind, target: edited, createdAt: 1 }];
    ports.snapshot.states = [
      {
        profileId,
        state: "needs-upgrade",
        upgradeTarget: "server",
        updateAvailability: "required",
        updatedAt: 1,
      },
    ];
    ports.management.updateSource.mockResolvedValue(ports.snapshot);
    ports.credentialService.load.mockResolvedValue("new-target-secret");
    const openWizard = vi.fn();
    await requestRemoteProjectConnection({
      preference: {
        preferredProfileId: profileId,
        preferredTarget: target,
        preferredDirectoryPath: "/repo-a",
      },
      presentation: resolveRemoteConnectionPresentation({}),
      reconnect: async () => {
        throw Object.assign(new Error(upgradeFailure.message), upgradeFailure, {
          profileId,
          ...(target.kind === "wsl" ? { resolvedWslTarget: target } : {}),
        });
      },
      openWizard,
    });
    const props = defaults(openWizard.mock.calls[0]![0]);
    const { result } = renderHook(() => useRemoteConnectionFlow(props));
    await waitFor(() => expect(result.current.connectingStep.errorMessage).toBeTruthy());
    await waitFor(() => expect(result.current.connectingStep.loading).toBe(false));
    expect(ports.management.updateSource).not.toHaveBeenCalled();
    expect(props.onConnect).not.toHaveBeenCalled();
    expect(result.current.connectingStep.target).toMatchObject(target);
  },
);

it("Device completion qualification read failure retains connection error; wizard closes only on successful explicit retry", async () => {
  const completion = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("membership read unavailable"))
    .mockResolvedValue(undefined);
  const props = defaults({
    completion: "device-management",
    onDeviceConnected: completion,
    onOpenChange: vi.fn(),
  });
  props.onConnect = vi.fn(async () => {
    useRemoteWorkspaceSessionStore.setState({
      sessionsById: {
        "session-a": { sessionId: "session-a", sourceServerId: "source-1" } as never,
      },
    });
    return "session-a";
  });
  const { result } = renderHook(() => useRemoteConnectionFlow(props));
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await waitFor(() =>
    expect(result.current.connectingStep.rawError).toContain("membership read unavailable"),
  );
  expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  expect(props.onSelectProject).not.toHaveBeenCalled();
  act(() => result.current.connectingStep.onRetry());
  await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  expect(completion).toHaveBeenCalledTimes(2);
});

it.each(["resolve", "reject"])(
  "After canceling in-progress device completion validation, late %s does not restore errors or close new entry",
  async (outcome) => {
    const completion = Promise.withResolvers<void>();
    const completed = vi.fn(() => completion.promise);
    const props = defaults({
      completion: "device-management",
      onDeviceConnected: completed,
      onCancelled: vi.fn(),
      onOpenChange: vi.fn(),
    });
    props.onConnect = vi.fn(async () => {
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: {
          "session-a": { sessionId: "session-a", sourceServerId: "source-1" } as never,
        },
      });
      return "session-a";
    });
    const { result } = renderHook(() => useRemoteConnectionFlow(props));
    await drain();
    act(() => result.current.selectionStep.onSelectTarget(targetA));
    await waitFor(() => expect(completed).toHaveBeenCalledOnce());
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    act(() => result.current.connectingStep.onCancelConnection());
    expect(props.onCancelled).toHaveBeenCalledOnce();
    vi.mocked(props.onOpenChange!).mockClear();
    await act(async () => {
      if (outcome === "reject") completion.reject(new Error("late membership failure"));
      else completion.resolve();
    });
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(result.current.error).not.toContain("late membership failure");
  },
);

it("Do not deliver when collapsed while waiting for completion qualification; background ready only completes again after explicit continue", async () => {
  const checking = Promise.withResolvers<void>();
  const delivered = vi.fn();
  const completion = vi.fn(async (_source: string | undefined, canDeliver?: () => boolean) => {
    await checking.promise;
    if (canDeliver?.()) delivered();
  });
  const props = defaults({
    completion: "device-management",
    onDeviceConnected: completion,
    onOpenChange: vi.fn(),
  });
  props.onConnect = vi.fn(async () => {
    useRemoteWorkspaceSessionStore.setState({
      sessionsById: {
        "session-a": { sessionId: "session-a", sourceServerId: "source-1" } as never,
      },
    });
    return "session-a";
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  await waitFor(() => expect(completion).toHaveBeenCalledOnce());
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => checking.resolve());
  expect(delivered).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.minimizedProgress?.ready).toBe(true));
  ports.snapshot.servers = [{ sourceServerId: "source-1", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-1", state: "online" } as never];
  act(() => result.current.minimizedProgress!.onResume());
  await waitFor(() => expect(delivered).toHaveBeenCalledOnce());
  expect(completion).toHaveBeenCalledTimes(2);
});

it("Background explicit continue qualification read fails after collapsing again; only updates background error without reclaiming modal", async () => {
  const connection = Promise.withResolvers<string>();
  const validation = Promise.withResolvers<void>();
  const complete = vi.fn(() => validation.promise);
  const props = defaults({
    completion: "device-management",
    onDeviceConnected: complete,
    onOpenChange: vi.fn(),
    onConnect: async () => {
      const sessionId = await connection.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: { [sessionId]: { sessionId, sourceServerId: "source-1" } as never },
      });
      return sessionId;
    },
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => connection.resolve("session-a"));
  await waitFor(() => expect(result.current.minimizedProgress?.ready).toBe(true));
  ports.snapshot.servers = [{ sourceServerId: "source-1", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-1", state: "online" } as never];
  rerender({ ...props, open: true });
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  vi.mocked(props.onOpenChange!).mockClear();
  await act(async () => validation.reject(new Error("membership read while minimized")));
  expect(result.current.minimizedProgress?.error).toContain("membership read while minimized");
  expect(props.onOpenChange).not.toHaveBeenCalledWith(true);
});

it("Background explicit continue restores original draft submission gate before Source and member validation", async () => {
  const connection = Promise.withResolvers<string>();
  const eligibility = Promise.withResolvers<void>();
  let submissionPending = true;
  let deliveryAllowed: (() => boolean) | undefined;
  const onOpenChange = vi.fn((visible: boolean) => {
    submissionPending = visible;
  });
  const completed = vi.fn(async (_source: string | undefined, canDeliver?: () => boolean) => {
    deliveryAllowed = canDeliver;
    await eligibility.promise;
  });
  const props = defaults({
    completion: "device-management",
    onDeviceConnected: completed,
    onOpenChange,
    onConnect: async () => {
      const sessionId = await connection.promise;
      useRemoteWorkspaceSessionStore.setState({
        sessionsById: {
          [sessionId]: { sessionId, sourceServerId: "source-1" } as never,
        },
      });
      return sessionId;
    },
  });
  const { result, rerender } = renderHook((input) => useRemoteConnectionFlow(input), {
    initialProps: props,
  });
  await drain();
  act(() => result.current.selectionStep.onSelectTarget(targetA));
  act(() => result.current.connectingStep.onMinimize());
  rerender({ ...props, open: false });
  await act(async () => connection.resolve("session-a"));
  await waitFor(() => expect(result.current.minimizedProgress?.ready).toBe(true));
  ports.snapshot.servers = [{ sourceServerId: "source-1", displayName: "Device" } as never];
  ports.snapshot.states = [{ sourceServerId: "source-1", state: "online" } as never];
  onOpenChange.mockClear();
  const sourceCheck = Promise.withResolvers<SourceServerManagementSnapshot>();
  ports.management.getSnapshot.mockImplementationOnce(() => sourceCheck.promise);
  act(() => result.current.minimizedProgress!.onResume());
  expect(submissionPending).toBe(true);
  expect(completed).not.toHaveBeenCalled();
  await act(async () => sourceCheck.resolve(ports.snapshot));
  await waitFor(() => expect(completed).toHaveBeenCalledOnce());
  expect(deliveryAllowed?.()).toBe(true);
  expect(onOpenChange).toHaveBeenCalledWith(true);
  expect(submissionPending).toBe(true);
  await act(async () => eligibility.resolve());
});
