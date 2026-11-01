// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Emitter } from "@origin-ai/cf-rpc";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { RemoteConnectionStatusTag } from "@/remote-connection/RemoteConnectionTags.js";
import { RemoteConnectionNavigationDot } from "@/remote-connection/RemoteConnectionNavigationDot.js";
import { RemoteTaskDeviceLabel } from "@/remote-connection/RemoteTaskDeviceLabel.js";
import { RemoteProjectConnectionDetails } from "@/WorkspaceSidebar/RemoteProjectConnectionDetails.js";
import { RemoteConnectionConnectingStep } from "@/remote-connection/RemoteConnectionConnectingStep.js";
import { resolveRemoteConnectionPresentation } from "@/lib/remoteConnectionPresentation.js";
import zh from "@/i18n/locales/zh-CN.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }, values?: Record<string, string | number>) =>
        Object.entries(values ?? {}).reduce(
          (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
          zh[id] ?? id,
        ),
    },
  }),
}));
afterEach(cleanup);

it("Recovery label uses short phrases and separates status; details retain full recovery instructions", () => {
  const presentation = resolveRemoteConnectionPresentation({
    state: "retrying",
    recoveryAttempt: 2,
    recoveryLimit: 3,
    target: { kind: "docker", container: "dev" },
  });
  const { container } = render(
    createElement(RemoteProjectConnectionDetails, {
      tab: {
        id: "project",
        kind: "workspace",
        label: "Project",
        workspacePath: "/srv/project",
        remoteTarget: { kind: "docker", container: "dev" },
      },
      deviceName: "Dev",
      presentation,
    }),
  );
  expect(container.querySelector("[data-remote-connection-status]")?.textContent).toBe(
    "Connecting · Auto-recovery 2/3",
  );
  expect(screen.getByText("正在自动恢复连接（2/3）")).toBeTruthy();
  expect(screen.getByText("Docker · dev")).toBeTruthy();
});

it("Status badges and details cards indicate required actions and update paths", () => {
  const presentation = resolveRemoteConnectionPresentation({
    state: "needs-upgrade",
    upgradeTarget: "controller",
  });
  const { container } = render(
    createElement(RemoteProjectConnectionDetails, {
      tab: { id: "project", kind: "workspace", label: "Project", workspacePath: "/srv/project" },
      deviceName: "Dev",
      presentation,
    }),
  );
  expect(screen.getByText("Needs Attention", { exact: false })).toBeTruthy();
  expect(screen.getByText("需要更新")).toBeTruthy();
  expect(container.querySelector('[data-remote-connection-status="pending"]')?.className).toContain(
    "text-warning-surface-foreground",
  );
});

it("Nav dot uses the model\'s in-progress color; recovery progress is visible text", () => {
  const presentation = resolveRemoteConnectionPresentation({
    state: "retrying",
    recoveryAttempt: 2,
    recoveryLimit: 3,
  });
  const { container } = render(
    createElement(
      "div",
      null,
      createElement(RemoteConnectionNavigationDot, { presentation }),
      createElement(RemoteConnectionStatusTag, { presentation }),
    ),
  );
  expect(screen.getByText("Auto-recovery 2/3")).toBeTruthy();
  expect(
    container.querySelector('[data-remote-navigation-status="connecting"]')?.className,
  ).toContain("progress-surface-foreground");
});

it("Task row device badge reflects installation gate from the same service snapshot", async () => {
  const emitter = new Emitter();
  const management = {
    getSnapshot: async () => ({
      servers: [{ sourceServerId: "device", displayName: "Dev", installState: "installed" }],
      profiles: [
        {
          profileId: "profile",
          sourceServerId: "device",
          target: { kind: "docker", container: "dev" },
        },
      ],
      states: [{ profileId: "profile", state: "needs-install", updatedAt: 1 }],
    }),
    onDidChangeState: emitter.event,
  };
  render(
    createElement(ServiceProvider, {
      services: { sourceServerManagementService: management } as never,
      children: createElement(RemoteTaskDeviceLabel, {
        task: { workspacePath: "/srv", sourceServerId: "device", serverDisplayName: "Dev" },
      }),
    }),
  );
  expect(await screen.findByText("需要安装")).toBeTruthy();
});

it("Wizard categorizes titles by download failure and only offers switching during local downloads", () => {
  const onRetry = vi.fn();
  const target = {
    kind: "ssh" as const,
    host: "dev",
    username: "user",
    assetInstallMode: "remote-download" as const,
  };
  const child = createElement(RemoteConnectionConnectingStep, {
    kind: "ssh",
    target,
    loading: false,
    logs: [],
    errorMessage: "download failed",
    errorCode: "remote-download-failed",
    onBack: vi.fn(),
    onRetry,
    onUseRemoteDownload: vi.fn(),
  });
  render(createElement(PlatformProvider, { platform: {} as never, children: child }));
  expect(screen.getByText("资源下载失败")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "改用远端下载" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it.each([false, true])("Entering missing credentials while connecting can be toggled without triggering submit: passphrase=%s", (passphrase) => {
  const onSubmit = vi.fn();
  const child = createElement(RemoteConnectionConnectingStep, {
    kind: "ssh",
    errorMessage: "",
    loading: false,
    logs: [],
    onBack: vi.fn(),
    onRetry: vi.fn(),
    credentials: { value: "secret", passphrase, onChange: vi.fn(), onSubmit },
  });
  render(createElement(PlatformProvider, { platform: {} as never, children: child }));
  const input = screen.getByLabelText(passphrase ? "私钥口令（可选）" : "密码");
  expect(input.getAttribute("type")).toBe("password");
  fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
  expect(input.getAttribute("type")).toBe("text");
  fireEvent.click(screen.getByRole("button", { name: "隐藏密码" }));
  expect(input.getAttribute("type")).toBe("password");
  expect(onSubmit).not.toHaveBeenCalled();
});
