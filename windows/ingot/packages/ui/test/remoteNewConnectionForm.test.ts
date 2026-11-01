// @vitest-environment jsdom
import { createElement, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DockerContainerInfo,
  SourceServerManagementSnapshot,
  SSHConfigAliasOption,
  WSLDistro,
} from "@origin-ai/cf-shared";
import zhCN from "@/i18n/locales/zh-CN.js";

const ports = vi.hoisted(() => ({
  snapshot: {} as SourceServerManagementSnapshot,
  credentialService: { load: vi.fn(async () => null), save: vi.fn() },
  settingService: {
    get: vi.fn(async () => ({ remoteBoundaryIntroAcknowledgedVersion: 1 })),
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
    isLocalDevelopmentRuntime: false,
    isDockerAvailable: vi.fn(async () => true),
    listSSHConfigAliases: vi.fn(async (): Promise<SSHConfigAliasOption[]> => []),
    listWSLDistros: vi.fn(async (): Promise<WSLDistro[]> => []),
    listDockerContainers: vi.fn(async (): Promise<DockerContainerInfo[]> => []),
    onRemoteConnectionLog: vi.fn(() => () => undefined),
    cancelPendingRemoteConnection: vi.fn(async () => undefined),
    selectFile: vi.fn(async () => null),
  },
  confirm: vi.fn(async () => true),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: "zh-CN",
    intl: {
      formatMessage: ({ id }: { id: string }, values: Record<string, string> = {}) =>
        ((zhCN as Record<string, string>)[id] ?? id).replace(
          /\{(\w+)\}/gu,
          (_, key) => values[key] ?? `{${key}}`,
        ),
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

import { RemoteConnectionDialog } from "@/SSHDialog.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";

type DialogProps = ComponentProps<typeof RemoteConnectionDialog>;
function mountDialog(overrides: Partial<DialogProps> = {}) {
  const props: DialogProps = {
    open: true,
    onConnect: vi.fn(async () => "session-a"),
    onSelectProject: vi.fn(async () => undefined),
    onCancelSession: vi.fn(async () => undefined),
    ...overrides,
  };
  return { ...render(createElement(RemoteConnectionDialog, props)), props };
}
const mountSettingsEntry = (overrides: Partial<DialogProps> = {}) =>
  mountDialog({ completion: "device-management", ...overrides });

const aliases: SSHConfigAliasOption[] = [
  {
    alias: "gpu",
    host: "gpu.example.com",
    username: "ubuntu",
    port: 2222,
    privateKeyPath: "~/.ssh/gpu.pem",
  },
  { alias: "staging", host: "staging.example.com", username: "deploy" },
];

function pasteInto(element: HTMLElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { getData: () => text } });
  fireEvent(element, event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  ports.platform.isDockerAvailable.mockResolvedValue(true);
  ports.platform.listSSHConfigAliases.mockResolvedValue([]);
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
  useRemoteWorkspaceSessionStore.setState({ sessionsById: {} });
});
afterEach(cleanup);

describe("设置入口的新建连接表单", () => {
  it("No step bar or descriptions; live target preview under title with focus on host", async () => {
    mountSettingsEntry();
    const host = await screen.findByTestId("ssh-host-input");
    expect(screen.getByRole("heading", { name: "新建连接" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: zhCN["remote.wizard"] })).toBeNull();
    expect(screen.queryByText(/填写建立/)).toBeNull();
    const preview = screen.getByTestId("remote-new-connection-preview");
    expect(preview.textContent).toBe("user@host:22");
    await waitFor(() => expect(document.activeElement).toBe(host));

    fireEvent.change(host, { target: { value: "10.0.0.5" } });
    fireEvent.change(screen.getByTestId("ssh-username-input"), { target: { value: "root" } });
    expect(preview.textContent).toBe("root@10.0.0.5:22");
  });

  it("Type toggle shows type color and marks selected item; auth method stays neutral", async () => {
    mountSettingsEntry();
    const kinds = await screen.findByRole("group", { name: zhCN["remote.connectionType"] });
    const ssh = within(kinds).getByTestId("remote-kind-ssh");
    expect(ssh.getAttribute("aria-pressed")).toBe("true");
    expect(ssh.className).toContain("bg-remote-ssh-surface");
    fireEvent.click(within(kinds).getByTestId("remote-kind-docker"));
    const docker = within(kinds).getByTestId("remote-kind-docker");
    expect(docker.getAttribute("aria-pressed")).toBe("true");
    expect(docker.className).toContain("bg-remote-docker-surface");
    expect(ssh.className).not.toContain("bg-remote-ssh-surface");
    fireEvent.click(ssh);
    const auth = screen.getByRole("group", { name: zhCN["ssh.authMethod"] });
    expect(within(auth).getByRole("button", { pressed: true }).className).not.toMatch(
      /bg-remote-/u,
    );
  });

  it("Shows linked tag after importing from SSH config, focuses first empty required field; × only unlinks", async () => {
    ports.platform.listSSHConfigAliases.mockResolvedValue(aliases);
    mountSettingsEntry();
    const importButton = await screen.findByTestId("remote-ssh-config-import");
    await waitFor(() => expect((importButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(importButton);
    fireEvent.click(await screen.findByText("staging"));

    const chip = await screen.findByTestId("remote-ssh-config-alias-chip");
    expect(chip.textContent).toContain("已关联 Host staging");
    expect(chip.className).toContain("bg-remote-ssh-surface");
    expect((screen.getByTestId("ssh-host-input") as HTMLInputElement).value).toBe(
      "staging.example.com",
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("ssh-password-input")),
    );

    fireEvent.click(within(chip).getByRole("button", { name: zhCN["ssh.configAliasUnlink"] }));
    expect(screen.queryByTestId("remote-ssh-config-alias-chip")).toBeNull();
    expect((screen.getByTestId("ssh-host-input") as HTMLInputElement).value).toBe(
      "staging.example.com",
    );
  });

  it("Focuses primary action if imported Host already has a private key", async () => {
    ports.platform.listSSHConfigAliases.mockResolvedValue(aliases);
    mountSettingsEntry();
    const importButton = await screen.findByTestId("remote-ssh-config-import");
    await waitFor(() => expect((importButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(importButton);
    fireEvent.click(await screen.findByText("gpu"));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "添加并连接" })),
    );
  });

  it("Import button disabled with explanation when no config Host is available", async () => {
    mountSettingsEntry();
    const importButton = await screen.findByTestId("remote-ssh-config-import");
    await waitFor(() => expect(importButton.textContent).toContain(zhCN["ssh.importEmpty"]));
    expect((importButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("Pasting ssh command splits host, username, and port, and unlinks alias", async () => {
    ports.platform.listSSHConfigAliases.mockResolvedValue(aliases);
    mountSettingsEntry();
    const importButton = await screen.findByTestId("remote-ssh-config-import");
    await waitFor(() => expect((importButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(importButton);
    fireEvent.click(await screen.findByText("staging"));
    await screen.findByTestId("remote-ssh-config-alias-chip");

    const host = screen.getByTestId("ssh-host-input");
    const event = pasteInto(host, "ssh root@10.0.0.5 -p 2222");
    expect(event.defaultPrevented).toBe(true);
    expect((host as HTMLInputElement).value).toBe("10.0.0.5");
    expect((screen.getByTestId("ssh-username-input") as HTMLInputElement).value).toBe("root");
    expect((screen.getByTestId("ssh-port-input") as HTMLInputElement).value).toBe("2222");
    expect(screen.getByText("已识别 root@10.0.0.5:2222")).toBeTruthy();
    expect(screen.queryByTestId("remote-ssh-config-alias-chip")).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("ssh-password-input")),
    );

    fireEvent.change(host, { target: { value: "10.0.0.6" } });
    expect(screen.queryByText(/已识别/)).toBeNull();
    expect(pasteInto(host, "plain-host").defaultPrevented).toBe(false);
  });

  it("Displays errors below fields on submit, focuses first invalid field, and clears error once fixed", async () => {
    const { props } = mountSettingsEntry();
    const host = await screen.findByTestId("ssh-host-input");
    fireEvent.click(screen.getByRole("button", { name: "添加并连接" }));

    const hostError = (await screen.findByText(zhCN["ssh.validation.hostRequired"])).closest("p")!;
    expect(host.getAttribute("aria-invalid")).toBe("true");
    expect(host.getAttribute("aria-describedby")).toBe(hostError.id);
    expect(screen.getByText(zhCN["ssh.validation.usernameRequired"])).toBeTruthy();
    expect(screen.getByText(zhCN["ssh.validation.passwordRequired"])).toBeTruthy();
    expect(document.activeElement).toBe(host);
    expect(props.onConnect).not.toHaveBeenCalled();

    fireEvent.change(host, { target: { value: "10.0.0.5" } });
    expect(screen.queryByText(zhCN["ssh.validation.hostRequired"])).toBeNull();
    expect(host.getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByText(zhCN["ssh.validation.usernameRequired"])).toBeTruthy();
  });

  it("设置入口页脚提供取消与添加并连接", async () => {
    mountSettingsEntry();
    const submit = await screen.findByRole("button", { name: "添加并连接" });
    const footer = submit.parentElement!;
    expect(within(footer).getByRole("button", { name: zhCN["common.cancel"] })).toBeTruthy();
  });

  it("Docker has no description; shows a warning below selector when unavailable", async () => {
    ports.platform.isDockerAvailable.mockResolvedValue(false);
    mountSettingsEntry();
    fireEvent.click(await screen.findByTestId("remote-kind-docker"));
    fireEvent.click(screen.getByRole("button", { name: zhCN["docker.inputMode.select"] }));
    const warning = await screen.findByText(zhCN["docker.unavailable"]);
    expect(warning.closest("[data-remote-field-hint=warning]")).toBeTruthy();
    expect(screen.queryByText("连接本机 Docker 容器。")).toBeNull();
    expect(screen.getByTestId("remote-new-connection-preview").textContent).toBe(
      zhCN["docker.selectContainer"],
    );
  });

  it.each([
    ["Docker 不可用", false, "docker.unavailable"],
    ["没有运行中的容器", true, "docker.noContainers"],
  ] as const)("When %s, explain reason in empty container dropdown", async (_, available, messageId) => {
    ports.platform.isDockerAvailable.mockResolvedValue(available);
    mountSettingsEntry();
    fireEvent.click(await screen.findByTestId("remote-kind-docker"));
    fireEvent.click(screen.getByRole("button", { name: zhCN["docker.inputMode.select"] }));
    await screen.findByText(zhCN[messageId]);
    fireEvent.click(screen.getByTestId("docker-container-select"));
    const list = await screen.findByRole("listbox");
    expect(within(list).getByText(zhCN[messageId])).toBeTruthy();
    expect(within(list).queryByText(zhCN["docker.selectContainer"])).toBeNull();
  });
});

describe("项目/聊天入口的新建 SSH 连接表单", () => {
  it("Retains 3-step bar, type tag, and back-to-connections entry; hides alias entry", async () => {
    ports.platform.listSSHConfigAliases.mockResolvedValue(aliases);
    mountDialog();
    fireEvent.click(await screen.findByRole("button", { name: zhCN["remote.selection.new.ssh"] }));
    await screen.findByTestId("ssh-host-input");

    const steps = screen.getByRole("navigation", { name: zhCN["remote.wizard"] });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "新建连接" })).toBeTruthy();
    expect(document.querySelector("[data-remote-connection-kind=ssh]")).toBeTruthy();
    expect(screen.queryByTestId("remote-ssh-config-import")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Premium/ }));
    expect(screen.queryByTestId("ssh-config-alias-select")).toBeNull();

    const back = screen.getByRole("button", { name: zhCN["remote.selection.back"] });
    const footer = back.parentElement!;
    expect(footer.lastElementChild!.textContent).toBe(zhCN["remote.startConnection"]);
  });
});
