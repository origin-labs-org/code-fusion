// @vitest-environment jsdom
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { RemoteIdentityHoverCard } from "@/project-sidebar/RemoteIdentityHoverCard.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, unknown>) =>
        values ? `${id}${JSON.stringify(values)}` : id,
    },
  }),
}));
const remote = vi.hoisted(() => ({
  device: undefined as Record<string, unknown> | undefined,
  logs: {} as Record<string, unknown[]>,
  requestedProfileIds: [] as string[][],
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({ useBaseWorkspaceServices: () => ({}) }));
vi.mock("@/hooks/useSourceServerStatuses.js", () => ({
  useRemoteDevicePresentationInput: (sourceServerId?: string) =>
    sourceServerId === "alpha" ? remote.device : undefined,
}));
vi.mock("@/hooks/useSourceServerOperationLogs.js", () => ({
  useSourceServerOperationLogs: (_management: unknown, profileIds: string[] = []) => {
    remote.requestedProfileIds.push(profileIds);
    return { logsByProfileId: remote.logs };
  },
}));
beforeAll(() => vi.stubGlobal("PointerEvent", MouseEvent));
afterEach(() => {
  cleanup();
  remote.device = undefined;
  remote.logs = {};
  remote.requestedProfileIds = [];
  vi.restoreAllMocks();
});
const host = {
  id: "remote:server:alpha",
  membershipId: "alpha",
  kind: "ssh" as const,
  target: { kind: "ssh" as const, host: "alpha.example.com", username: "dev", port: 22 },
  connectionStatus: "offline" as const,
  position: 0,
};
function mount() {
  return render(
    createElement(RemoteIdentityHoverCard, {
      host,
      title: "Task",
      projectName: "test2",
      deviceName: "Alpha",
      paths: ["/home/dev/test2"],
      children: createElement("button", { type: "button" }, "remote row"),
    }),
  );
}
it("shows offline device identity, stays open over content, and closes after leaving without a close action", async () => {
  mount();
  fireEvent.pointerEnter(screen.getByText("remote row"), { pointerType: "mouse" });
  const details = await screen.findByTestId("remote-identity-details");
  expect(details.textContent).toContain("Alpha");
  expect(details.textContent).toContain("alpha.example.com");
  expect(details.textContent).toContain("/home/dev/test2");
  expect(details.textContent).toContain("remote.status.offline");
  expect(details.querySelector("button")).toBeNull();
  fireEvent.pointerLeave(screen.getByText("remote row"), { pointerType: "mouse" });
  fireEvent.pointerEnter(details, { pointerType: "mouse" });
  expect(screen.getByTestId("remote-identity-details")).toBeTruthy();
  fireEvent.pointerLeave(details, { pointerType: "mouse" });
  await waitFor(() => expect(screen.queryByTestId("remote-identity-details")).toBeNull());
});
it("closes on keyboard blur and Escape, and never pins after clicking the row", async () => {
  mount();
  const row = screen.getByText("remote row");
  fireEvent.focus(row);
  await screen.findByTestId("remote-identity-details");
  fireEvent.blur(row);
  await waitFor(() => expect(screen.queryByTestId("remote-identity-details")).toBeNull());
  fireEvent.pointerEnter(row, { pointerType: "mouse" });
  await screen.findByTestId("remote-identity-details");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("remote-identity-details")).toBeNull());
  fireEvent.pointerEnter(row, { pointerType: "mouse" });
  await screen.findByTestId("remote-identity-details");
  fireEvent.click(row);
  fireEvent.pointerLeave(row, { pointerType: "mouse" });
  await waitFor(() => expect(screen.queryByTestId("remote-identity-details")).toBeNull());
});

it.each(["outside", "trigger", "keyboard"])(
  "does not pin selected path text when leaving through %s",
  async (leaveThrough) => {
    mount();
    const row = screen.getByText("remote row");
    fireEvent.pointerEnter(row, { pointerType: "mouse" });
    const details = await screen.findByTestId("remote-identity-details");
    fireEvent.pointerLeave(row, { pointerType: "mouse" });
    fireEvent.pointerEnter(details, { pointerType: "mouse" });
    const path = screen.getByText("/home/dev/test2");
    fireEvent.pointerDown(path);
    const range = document.createRange();
    range.selectNodeContents(path);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    fireEvent.pointerUp(path);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(document.getSelection()?.toString()).toBe("/home/dev/test2");
    expect(screen.getByTestId("remote-identity-details")).toBeTruthy();

    if (leaveThrough === "keyboard") {
      fireEvent.focus(row);
      fireEvent.blur(row, { relatedTarget: document.body });
    } else {
      fireEvent.pointerLeave(details, { pointerType: "mouse" });
      if (leaveThrough === "trigger") {
        fireEvent.pointerEnter(row, { pointerType: "mouse" });
        await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
        expect(screen.getByTestId("remote-identity-details")).toBeTruthy();
        fireEvent.pointerLeave(row, { pointerType: "mouse" });
      }
    }
    await waitFor(() => expect(screen.queryByTestId("remote-identity-details")).toBeNull());
  },
);

it("keeps a focused row's details open while selecting text inside them", async () => {
  mount();
  const row = screen.getByText("remote row");
  fireEvent.focus(row);
  const details = await screen.findByTestId("remote-identity-details");
  fireEvent.pointerEnter(details, { pointerType: "mouse" });
  fireEvent.pointerDown(screen.getByText("/home/dev/test2"));
  fireEvent.blur(row, { relatedTarget: null });
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
  expect(screen.getByTestId("remote-identity-details")).toBeTruthy();
  fireEvent.pointerUp(details);
  fireEvent.pointerLeave(details, { pointerType: "mouse" });
  await waitFor(() => expect(screen.queryByTestId("remote-identity-details")).toBeNull());
});

it("Pending devices show a specific short status, locate device settings via bottom entry, and close", async () => {
  const onOpenDeviceSettings = vi.fn();
  render(
    createElement(RemoteIdentityHoverCard, {
      host: { ...host, lastConnectionStatus: "needs-upgrade" },
      title: "Task",
      paths: ["/home/dev/test2"],
      onOpenDeviceSettings,
      children: createElement("button", { type: "button" }, "remote row"),
    }),
  );
  fireEvent.pointerEnter(screen.getByText("remote row"), { pointerType: "mouse" });
  const details = await screen.findByTestId("remote-identity-details");
  expect(details.textContent).toContain("remote.status.needsUpdate");
  expect(details.textContent).not.toContain("remote.status.pending");
  const entry = screen.getByTestId("remote-identity-device-settings");
  expect(entry.textContent).toContain("remote.action.update-server");
  fireEvent.click(entry);
  expect(onOpenDeviceSettings).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.queryByTestId("remote-identity-details")).toBeNull());
});

it.each([
  { name: "Offline device even with entry callback", lastConnectionStatus: "offline", callback: true },
  {
    name: "Pending device without entry callback (mobile/menu)",
    lastConnectionStatus: "needs-install",
    callback: false,
  },
])("Settings entry hidden in details when $name", async ({ lastConnectionStatus, callback }) => {
  render(
    createElement(RemoteIdentityHoverCard, {
      host: { ...host, lastConnectionStatus },
      title: "Task",
      paths: ["/home/dev/test2"],
      ...(callback ? { onOpenDeviceSettings: vi.fn() } : {}),
      children: createElement("button", { type: "button" }, "remote row"),
    }),
  );
  fireEvent.pointerEnter(screen.getByText("remote row"), { pointerType: "mouse" });
  const details = await screen.findByTestId("remote-identity-details");
  expect(details.querySelector("button")).toBeNull();
});

it("Entry shows \"Update Desktop App\" when desktop version is outdated, matching device card in settings", async () => {
  render(
    createElement(RemoteIdentityHoverCard, {
      host: { ...host, lastConnectionStatus: "needs-upgrade", upgradeTarget: "controller" },
      title: "Task",
      paths: ["/home/dev/test2"],
      onOpenDeviceSettings: vi.fn(),
      children: createElement("button", { type: "button" }, "remote row"),
    }),
  );
  fireEvent.pointerEnter(screen.getByText("remote row"), { pointerType: "mouse" });
  await screen.findByTestId("remote-identity-details");
  expect(screen.getByTestId("remote-identity-device-settings").textContent).toContain(
    "remote.action.update-desktop",
  );
});

const PROFILE = "00000000-0000-4000-8000-000000000001";
function hoverConnecting(overrides: Record<string, unknown> = {}) {
  render(
    createElement(RemoteIdentityHoverCard, {
      host: {
        ...host,
        connectionStatus: "connecting",
        lastConnectionStatus: "retrying",
        ...overrides,
      },
      title: "Task",
      paths: ["/home/dev/test2"],
      children: createElement("button", { type: "button" }, "remote row"),
    }),
  );
  fireEvent.pointerEnter(screen.getByText("remote row"), { pointerType: "mouse" });
  return screen.findByTestId("remote-identity-details");
}

it("While connecting, top of details shows phase, upload progress, steps, elapsed time, and auto-recovery, omitting raw logs", async () => {
  vi.spyOn(Date, "now").mockReturnValue(40_000);
  remote.device = { profileId: PROFILE, state: "retrying", recoveryAttempt: 2, recoveryLimit: 3 };
  remote.logs = {
    [PROFILE]: [
      {
        profileId: PROFILE,
        operation: "connect",
        phase: "probe",
        level: "info",
        message: "Checking the remote device",
        timestamp: 8_000,
      },
      {
        profileId: PROFILE,
        operation: "connect",
        phase: "upload",
        level: "info",
        message: "cf.tar.gz",
        progress: 0.43,
        timestamp: 39_000,
      },
    ],
  };
  const details = await hoverConnecting();
  const progress = screen.getByTestId("remote-connection-progress");
  expect(remote.requestedProfileIds.at(-1)).toEqual([PROFILE]);
  expect(progress.textContent).toContain("remote.phase.deploy");
  expect(progress.textContent).toContain("43%");
  expect(progress.textContent).toContain('remote.progress.step{"current":3,"total":4}');
  expect(progress.textContent).toContain('remote.progress.elapsedSeconds{"seconds":32}');
  expect(progress.textContent).toContain(
    'workspaceSidebar.recoveringAutomaticShort{"attempt":2,"limit":3}',
  );
  expect(
    [...progress.querySelectorAll("[data-progress-segment]")].map((node) =>
      node.getAttribute("data-progress-segment"),
    ),
  ).toEqual(["complete", "complete", "active", "pending"]);
  expect(details.textContent).not.toContain("Checking the remote device");
  expect(details.textContent).not.toContain("cf.tar.gz");
  expect(screen.queryByTestId("remote-connection-failure")).toBeNull();
});

it("Stays at step 1 without elapsed time when there are no logs during connection", async () => {
  const details = await hoverConnecting();
  const progress = screen.getByTestId("remote-connection-progress");
  expect(progress.textContent).toContain("remote.phase.channel");
  expect(progress.textContent).toContain('remote.progress.step{"current":1,"total":4}');
  expect(details.textContent).not.toContain("remote.progress.elapsed");
});

it("Connection failure shows readable reason and copy error details; raw text goes only to clipboard", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const error = "ssh: handshake failed: ssh: unable to authenticate";
  const details = await hoverConnecting({
    connectionStatus: "offline",
    lastConnectionStatus: "failed",
    lastConnectionError: error,
  });
  const failure = screen.getByTestId("remote-connection-failure");
  expect(details.textContent).toContain("remote.status.failed");
  expect(failure.textContent).not.toContain(error);
  expect(screen.queryByTestId("remote-connection-progress")).toBeNull();
  fireEvent.click(screen.getByTestId("remote-connection-copy-error"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(error));
  vi.unstubAllGlobals();
  vi.stubGlobal("PointerEvent", MouseEvent);
});

it("Shows failure reason when offline with errors; online and normal offline do not show connection area", async () => {
  await hoverConnecting({
    connectionStatus: "offline",
    lastConnectionStatus: "offline",
    lastConnectionError: "connect ECONNREFUSED",
  });
  expect(screen.getByTestId("remote-connection-failure")).toBeTruthy();
  cleanup();
  for (const lastConnectionStatus of ["online", "offline"]) {
    await hoverConnecting({ connectionStatus: lastConnectionStatus, lastConnectionStatus });
    expect(screen.queryByTestId("remote-connection-progress")).toBeNull();
    expect(screen.queryByTestId("remote-connection-failure")).toBeNull();
    cleanup();
  }
});

it("Direct URL Server connection is outside Source management domain; hides progress area and skips reading logs while connecting", async () => {
  remote.device = { profileId: PROFILE };
  const details = await hoverConnecting({
    kind: "server",
    target: { kind: "server", url: "https://example.com" },
  });
  expect(remote.requestedProfileIds.at(-1)).toEqual([]);
  expect(screen.queryByTestId("remote-connection-progress")).toBeNull();
  expect(details.textContent).toContain("remote.status.connecting");
});

it("Shows only auto-recovery before the first retry after disconnect, without previous successful phase and elapsed time", async () => {
  vi.spyOn(Date, "now").mockReturnValue(8_000 + 2 * 60 * 60 * 1000);
  remote.device = { profileId: PROFILE, state: "retrying", recoveryAttempt: 1, recoveryLimit: 3 };
  const entry = (phase: string, timestamp: number, progress?: number) => ({
    profileId: PROFILE,
    operation: "connect",
    phase,
    level: "info",
    message: phase,
    timestamp,
    ...(progress === undefined ? {} : { progress }),
  });
  remote.logs = {
    [PROFILE]: [entry("probe", 8_000), entry("daemon", 9_000), entry("ready", 10_000, 1)],
  };
  await hoverConnecting();
  const progress = screen.getByTestId("remote-connection-progress");
  expect(progress.textContent).toContain("remote.phase.channel");
  expect(progress.textContent).toContain('remote.progress.step{"current":1,"total":4}');
  expect(progress.textContent).not.toContain("remote.progress.elapsed");
  expect(progress.textContent).toContain(
    'workspaceSidebar.recoveringAutomaticShort{"attempt":1,"limit":3}',
  );
});

it("\"Copied\" applies only to the copied raw error; reverts to copy button when error changes", async () => {
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const props = (lastConnectionError: string) => ({
    host: {
      ...host,
      connectionStatus: "offline",
      lastConnectionStatus: "failed",
      lastConnectionError,
    },
    title: "Task",
    paths: ["/home/dev/test2"],
    children: createElement("button", { type: "button" }, "remote row"),
  });
  const { rerender } = render(createElement(RemoteIdentityHoverCard, props("first failure")));
  fireEvent.pointerEnter(screen.getByText("remote row"), { pointerType: "mouse" });
  fireEvent.click(await screen.findByTestId("remote-connection-copy-error"));
  await waitFor(() =>
    expect(screen.getByTestId("remote-connection-copy-error").textContent).toBe(
      "remote.progress.copied",
    ),
  );
  rerender(createElement(RemoteIdentityHoverCard, props("second failure")));
  expect(screen.getByTestId("remote-connection-copy-error").textContent).toBe(
    "remote.progress.copyError",
  );
  vi.unstubAllGlobals();
  vi.stubGlobal("PointerEvent", MouseEvent);
});
