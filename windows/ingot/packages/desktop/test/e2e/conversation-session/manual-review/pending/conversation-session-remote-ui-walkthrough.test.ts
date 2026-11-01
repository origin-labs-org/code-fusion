import { startProjectPointerDrag } from "#e2e/helpers/project-sidebar";
import { createStallableTcpProxy } from "#e2e/helpers/ssh-stallable-proxy";
import { requestRemoteProjectConnection } from "#e2e/helpers/remote-project-actions";

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, connect, type Server, type Socket } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  TID_VIRTUAL_PROJECT_ADD,
  TID_REMOTE_KIND_DOCKER,
  TID_REMOTE_KIND_SSH,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_SSH_AUTH_PASSWORD,
  TID_SSH_AUTH_PRIVATE_KEY,
  TID_SSH_DIALOG,
  TID_SSH_ERROR,
  TID_SSH_SUCCESS,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  hoverTestIdByWebDriver,
  DEFAULT_WORKSPACE,
  waitForWorkspaceApp,
} from "#e2e/helpers/desktop-app";
import { startElectronWindowRecording } from "#e2e/helpers/electron-window-recorder";
import { prepareV4ConversationE2E } from "#e2e/helpers/v4-conversation";
import {
  selectTaskOrganizeMode,
  openWorkspaceDraftFromSidebar,
} from "#e2e/helpers/workspace-agent-warmup";
import {
  clickLastEnabledSSHDialogButton,
  fillSSHPasswordSettings,
  prepareSSHConnectionPage,
  readSSHRuntimeConfig,
  openRemoteConnectionSelection,
  connectSSHWorkspace,
  waitForRemoteTab,
  waitForSSHDirectoryStep,
  waitForSSHError,
} from "#e2e/helpers/ssh-remote-p0";

const MARKER = "E2E_REMOTE_UI_WALKTHROUGH";
const artifact = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/remote-ui-walkthrough",
);
const dialog = `[data-testid="${TID_SSH_DIALOG}"]`;
const run = promisify(execFile);

interface CaptureEntry {
  error?: string;
  files: string[];
  step: string;
  title: string;
}
const index: CaptureEntry[] = [];
let sequence = 0;
const nextStep = () => String(++sequence).padStart(2, "0");

async function settle() {
  await browser.executeAsync((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 120))),
  );
}

async function setTheme(theme: "light" | "dark") {
  await browser.execute((value) => {
    const actions = (window as Window & { __testActions?: { setTheme(value: string): void } })
      .__testActions;
    if (!actions) throw new Error("Missing theme test actions");
    actions.setTheme(value);
  }, theme);
}

async function capture(name: string, title: string) {
  const step = nextStep();
  const files: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    await setTheme(theme);
    await settle();
    const file = `${step}-${name}-${theme}.png`;
    await browser.saveScreenshot(resolve(artifact, file));
    files.push(file);
  }
  await setTheme("light");
  await settle();
  index.push({ step, title, files });
}

async function captureFrames(
  name: string,
  title: string,
  until: () => Promise<boolean>,
  options: { intervalMs?: number; timeoutMs: number },
) {
  const step = nextStep();
  const files: string[] = [];
  const started = Date.now();
  let satisfied = false;
  while (Date.now() - started < options.timeoutMs) {
    const file = `${step}-${name}-f${String(files.length + 1).padStart(3, "0")}.png`;
    await browser.saveScreenshot(resolve(artifact, file));
    files.push(file);
    if (await until()) {
      satisfied = true;
      break;
    }
    await browser.pause(options.intervalMs ?? 600);
  }
  index.push({ step, title: `${title}（${files.length} 帧）`, files });
  if (!satisfied) throw new Error(`${MARKER}: ${title} 未到达TargetStatus`);
}

async function clickButton(label: string | RegExp, root = dialog) {
  const pattern = label instanceof RegExp ? label.source : null;
  await browser.waitUntil(
    () =>
      browser.execute(
        (scope, text, source) => {
          const matcher = source ? new RegExp(source, "u") : null;
          const button = Array.from(
            document
              .querySelector(scope)
              ?.querySelectorAll<HTMLElement>('button, [role="menuitem"]') ?? [],
          ).find((item) => {
            const disabled =
              (item as HTMLButtonElement).disabled ||
              item.getAttribute("aria-disabled") === "true" ||
              item.hasAttribute("data-disabled");
            if (!item.getClientRects().length || disabled) return false;
            const content = item.textContent?.trim() ?? "";
            const aria = item.getAttribute("aria-label") ?? "";
            return matcher
              ? matcher.test(content) || matcher.test(aria)
              : content === text || aria === text;
          });
          if (!button) return false;
          button.click();
          return true;
        },
        root,
        typeof label === "string" ? label : null,
        pattern,
      ),
    { timeout: 30_000, timeoutMsg: `${MARKER}: 找不到按钮 ${String(label)}（${root}）` },
  );
}

async function hasButton(label: string, root = dialog) {
  return browser.execute(
    (scope, text) =>
      Array.from(
        document.querySelector(scope)?.querySelectorAll<HTMLElement>('button, [role="menuitem"]') ??
          [],
      ).some(
        (item) =>
          item.getClientRects().length > 0 &&
          (item.textContent?.trim() === text || item.getAttribute("aria-label") === text),
      ),
    root,
    label,
  );
}

async function openProjectAddMenu() {
  await selectTaskOrganizeMode(["项目", "Project"]);
  await hoverTestIdByWebDriver("project-section");
  await clickTestIdByDom(TID_VIRTUAL_PROJECT_ADD);
  await $('[role="dialog"]').waitForDisplayed();
}

async function openSelection() {
  await openRemoteConnectionSelection();
}

async function closeDialog() {
  if (await $(dialog).isExisting()) {
    await clickButton("关闭");
    await $(dialog).waitForExist({ reverse: true, timeout: 10_000 });
  }
}

async function openSettingsRemoteDevices() {
  if (!(await $('[data-testid="settings-page"]').isDisplayed())) {
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
  }
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "remoteDevices"));
  await $("[data-settings-content-frame]").waitForDisplayed();
}

async function backToWorkspace() {
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
  await $("[data-settings-content-frame]").waitForExist({ reverse: true, timeout: 10_000 });
}

async function rowState(identity: string) {
  return browser.execute(
    (key) =>
      document.querySelector<HTMLElement>(`[data-project-workspace-identity="${key}"]`)?.dataset
        .connectionState ?? null,
    identity,
  );
}

async function openProjectActions(identity: string) {
  const row = $(`[data-project-workspace-identity="${identity}"]`);
  await row.$('[data-testid="virtual-project-toggle"]').moveTo();
  await row.$('[data-testid="virtual-project-menu"]').click();
  await $('[role="menu"]').waitForDisplayed();
}

async function closePopover() {
  await browser.keys("Escape");
  await browser.pause(300);
}

async function recover() {
  await browser.keys("Escape");
  await browser.pause(300);
  if (await $(dialog).isExisting()) {
    if (await hasButton("Choose Later")) await clickButton("Choose Later").catch(() => undefined);
    await closeDialog().catch(() => undefined);
  }
  if (await $("[data-settings-content-frame]").isExisting()) {
    await backToWorkspace().catch(() => undefined);
  }
}

async function segment(key: string, title: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    const detail = String(error instanceof Error ? error.message : error).slice(0, 300);
    const step = nextStep();
    const file = `${step}-FAILED-${key}.png`;
    await browser.saveScreenshot(resolve(artifact, file)).catch(() => undefined);
    index.push({
      step,
      title: `【SectionFailed】${title}：${detail}`,
      error: detail,
      files: [file],
    });
    await recover().catch(() => undefined);
  }
}

async function closedPort() {
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing unused port");
  await new Promise<void>((done, reject) =>
    listener.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

async function startStallServer() {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing stall port");
  return {
    port: address.port,
    sockets,
    async close() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((yes) => server.close(() => yes()));
    },
  };
}

async function ownedContainer(): Promise<string | null> {
  const name = process.env.CF_E2E_SSH_CONTAINER?.trim();
  if (!name || !/^cf-r3-server-[a-z0-9-]+$/u.test(name)) return null;
  try {
    const { stdout } = await run("docker", [
      "inspect",
      "--format",
      '{{index .Config.Labels "cf.e2e.run"}}',
      name,
    ]);
    return stdout.trim() === "r3-server" ? name : null;
  } catch {
    return null;
  }
}

async function waitForTcpPort(host: string, port: number, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await new Promise<boolean>((done) => {
      const socket = connect({ host, port });
      socket.setTimeout(1500);
      socket.once("connect", () => {
        socket.destroy();
        done(true);
      });
      socket.once("error", () => done(false));
      socket.once("timeout", () => {
        socket.destroy();
        done(false);
      });
    });
    if (ok) return;
    await new Promise((tick) => setTimeout(tick, 1000));
  }
  throw new Error(`${MARKER}: ${host}:${port} 在 ${timeoutMs}ms inner没有重New可达`);
}

describe(`${MARKER}: RemoteConnect UI 走查`, () => {
  let transportProxy: Awaited<ReturnType<typeof createStallableTcpProxy>> | undefined;
  after(async () => {
    await transportProxy?.close();
    transportProxy = undefined;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("RDUX-WALKTHROUGH Capture wizard, sidebar, and settings states in user order with screen recording", async function () {
    this.timeout(30 * 60_000);
    await mkdir(artifact, { recursive: true });
    const direct = readSSHRuntimeConfig(MARKER);
    const endpoint = { host: direct.host, port: direct.port };
    const backendPorts = [endpoint.port];
    transportProxy = await createStallableTcpProxy(endpoint);
    const config = { ...direct, host: "127.0.0.1", port: transportProxy.port };
    const workspacePath = config.workspacePaths[0]!;
    await prepareSSHConnectionPage(MARKER);
    await prepareV4ConversationE2E({ skipProvider: true });
    await browser.execute(() => {
      (
        window as Window & { __testActions?: { setLocale(value: "zh-CN"): void } }
      ).__testActions?.setLocale("zh-CN");
    });
    await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 60_000);
    await browser.electron.execute((electron) => {
      const window = electron.BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
      window?.setMinimumSize(360, 600);
      window?.setSize(1400, 1000);
    });
    await setTheme("light");
    await settle();
    await browser.performActions([
      {
        type: "pointer",
        id: "park",
        parameters: { pointerType: "mouse" },
        actions: [{ type: "pointerMove", x: 2, y: 2, duration: 0 }],
      },
    ]);

    const recording = await startElectronWindowRecording({
      browser,
      frameIntervalMs: 500,
      outputPath: resolve(artifact, "remote-ui-walkthrough.webm"),
      encodeTimeoutMs: 5 * 60_000,
      stopTimeoutMs: 5 * 60_000,
    });
    const stall = await startStallServer();
    const container = await ownedContainer();
    let containerStopped = false;

    try {
      await openProjectAddMenu();
      await capture("project-add-menu", "Sidebar \"Add Project\": Select local machine or remote device");
      await browser.keys("Escape");
      await openSelection();
      await $(`${dialog} [data-testid="ssh-host-input"]`).waitForDisplayed();
      await capture("selection-empty", "设置新建：默认 SSH 分类表单");

      await clickTestIdByDom(TID_REMOTE_KIND_DOCKER);
      await $(`${dialog} [data-testid="docker-container-input"]`).waitForDisplayed();
      await capture("docker-manual-form", "手动输入 Docker 容器的表单");
      await clickTestIdByDom(TID_REMOTE_KIND_SSH);
      await $(`${dialog} [data-testid="ssh-host-input"]`).waitForDisplayed();
      await capture("ssh-form-empty", "新建 SSH 连接：空表单");
      await fillSSHPasswordSettings(config);
      await clickTestIdByDom(TID_SSH_AUTH_PRIVATE_KEY);
      await settle();
      await capture("ssh-form-private-key", "SSH form: Switch to private key authentication");
      await clickTestIdByDom(TID_SSH_AUTH_PASSWORD);
      await fillSSHPasswordSettings(config);
      await clickButton("高级选项");
      await settle();
      await capture(
        "ssh-form-filled-advanced",
        "SSH form: Filled, expanded advanced options (resource download method defaults to download locally then upload)",
      );

      await clickLastEnabledSSHDialogButton(MARKER);
      const installVisible = () => hasButton("安装并继续");
      await captureFrames(
        "connecting-first",
        "Wizard Screen 2: First-time connection, timeline progresses until installation confirmation is required",
        async () => (await installVisible()) || !(await $(dialog).isExisting()),
        { timeoutMs: 120_000, intervalMs: 500 },
      );
      if (await installVisible()) {
        await capture("install-confirm", "首次连接：新设备需要安装 CodeFusion Server 的确认卡");
        await clickButton(/^ConnectLogs/u);
        await settle();
        await capture("install-confirm-log-expanded", "Installation confirmation + expand connection logs");
        await clickButton("安装并继续");
        await captureFrames(
          "installing",
          "安装并启动 CodeFusion Server 的实时进度",
          async () => !(await $(dialog).isExisting()),
          { timeoutMs: 240_000, intervalMs: 700 },
        );
      }
      expect(await waitForSSHDirectoryStep(MARKER)).toBe("closed");
      await capture("device-first-added", "Settings: Added and located device without opening directory");
      await backToWorkspace();
      await connectSSHWorkspace({ config, workspacePath, caseMarker: MARKER });
      const tab = await waitForRemoteTab({ caseMarker: MARKER, expectedPath: workspacePath });
      const identity = tab.workspaceIdentity!;
      await browser.waitUntil(async () => (await rowState(identity)) === "online", {
        timeout: 30_000,
      });
      await settle();
      await capture("workspace-online", "Remote project opened: Sidebar project row (Connected) + empty session");

      await openProjectActions(identity);
      await capture(
        "sidebar-details-online",
        "Sidebar online project actions: Append Project / Edit / Pin to Top / Delete / Remove entry",
      );
      await closePopover();
      const row = $(`[data-project-workspace-identity="${identity}"]`);
      await row.$('[data-testid="virtual-project-toggle"]').moveTo();
      await row.$('button[aria-label="更多"]').click();
      await $('[role="menu"]').waitForDisplayed();
      await capture("sidebar-more-menu", "Sidebar project row \"More\" menu");
      await closePopover();
      await openProjectAddMenu();
      await capture("project-add-menu-devices", "Add Project entry: Select target device");
      await browser.keys("Escape");
      await browser.keys("Escape");

      await openSettingsRemoteDevices();
      await clickButton("编辑", "[data-source-server-card]");
      const editor = '[role="dialog"][data-slot="dialog-content"]';
      await $(editor).waitForDisplayed();
      await capture("edit-connection-dialog", "Settings page Edit Connection dialog");
      await clickButton("取消", editor);
      await $(editor).waitForExist({ reverse: true });

      await openSelection();
      await capture("add-with-saved-device", "When devices exist, creating new still directly opens default SSH category form");
      expect(await $(`${dialog} input[type="search"]`).isExisting()).toBe(false);
      await fillSSHPasswordSettings(config);
      await clickLastEnabledSSHDialogButton(MARKER);
      expect(await waitForSSHDirectoryStep(MARKER)).toBe("closed");
      await settle();
      await capture("manual-reuse", "Manually enter already online target: Reuse connection and stay in Settings");

      await openSettingsRemoteDevices();
      await $("[data-source-server-card]").waitForDisplayed();
      await capture("settings-card-online", "设置 · 远程设备：设备卡（已连接）与连接偏好");
      await $("[data-source-server-card] [data-source-server-log-toggle]").click();
      await $("[data-source-server-log-timestamp]").waitForDisplayed();
      await capture("settings-card-logs", "设备卡：展开最近日志");
      await $('[data-source-server-card] button[aria-label="更多"]').click();
      await $("[data-device-info]").waitForDisplayed();
      await capture(
        "settings-card-more-menu",
        "Device card \"More\" menu: Device Info / Show in Sidebar / Copy Device ID / Remove Device",
      );
      await clickButton("Remove Device", '[role="menu"]');
      await $('[role="dialog"]').waitForDisplayed();
      await capture("settings-remove-confirm", "移除设备确认框（截图后按 Esc 取消）");
      await browser.keys("Escape");
      await $('[role="dialog"]').waitForExist({ reverse: true });
      await clickButton("编辑", "[data-source-server-card]");
      await $(editor).waitForDisplayed();
      await capture("settings-edit-dialog", "Device card \"Edit\" dialog");
      await clickButton("取消", editor);
      await $(editor).waitForExist({ reverse: true });
      await clickButton("断开", "[data-source-server-card]");
      await $(
        '[data-source-server-card] [data-remote-connection-status="offline"]',
      ).waitForDisplayed({ timeout: 30_000 });
      await settle();
      await capture("settings-card-offline", "Device card (Disconnected): Last online and \"Connect\" entry");

      await backToWorkspace();
      await browser.waitUntil(async () => (await rowState(identity)) === "offline", {
        timeout: 30_000,
      });
      await settle();
      await capture("conversation-disconnected", "After disconnect: Sidebar project row (Disconnected) and session area disconnection placeholder");
      await openProjectActions(identity);
      await capture("sidebar-details-offline", "侧栏离线项目操作：连接 / 移除入口");
      await clickButton("连接", '[role="menu"]');
      await captureFrames(
        "reconnecting",
        "从侧栏重连：连接中状态直到恢复在线",
        async () => (await rowState(identity)) === "online",
        { timeoutMs: 120_000, intervalMs: 600 },
      );
      if (await $(dialog).isExisting()) {
        if (await $(`${dialog} [data-testid="${TID_SSH_SUCCESS}"]`).isExisting()) {
          await clickButton("Choose Later");
        }
        await closeDialog();
      }
      await settle();
      await capture("workspace-reconnected", "Reconnection complete: Project back online");

      await segment("unreachable", "主机不可达失败态", async () => {
        await openSelection();
        await clickTestIdByDom(TID_REMOTE_KIND_SSH);
        await fillSSHPasswordSettings({ ...config, host: "127.0.0.1", port: await closedPort() });
        await clickLastEnabledSSHDialogButton(MARKER);
        await waitForSSHError(MARKER, 90_000);
        await settle();
        await capture("failed-unreachable", "连接失败：主机不可达（错误卡 + 建议操作）");
        await closeDialog();
      });
      await segment("auth", "SSH 认证失败态", async () => {
        await openSelection();
        await clickTestIdByDom(TID_REMOTE_KIND_SSH);
        await fillSSHPasswordSettings({
          ...config,
          username: `${config.username}-nobody`,
          password: `${config.password}-wrong`,
        });
        await clickLastEnabledSSHDialogButton(MARKER);
        await waitForSSHError(MARKER, 120_000);
        await settle();
        await capture("failed-auth", "Connection failed: SSH authentication failed (should provide \"Change Password or Private Key\")");
        if (await hasButton("Change Password or Private Key")) {
          await clickButton("Change Password or Private Key");
          await $(`${dialog} [data-testid="ssh-host-input"]`).waitForDisplayed();
          await settle();
          await capture("failed-auth-edit", "Click \"Change Password or Private Key\" to return to form");
        }
        await closeDialog();
      });

      await segment("cancel", "连接中取消", async () => {
        await openSelection();
        await clickTestIdByDom(TID_REMOTE_KIND_SSH);
        await fillSSHPasswordSettings({ ...config, host: "127.0.0.1", port: stall.port });
        await clickLastEnabledSSHDialogButton(MARKER);
        await browser.waitUntil(() => stall.sockets.size > 0, { timeout: 30_000 });
        await settle();
        await capture("connecting-pending", "连接中（对端不响应）：可取消或在后台继续");
        await clickButton("取消连接");
        await browser
          .waitUntil(async () => (await $(dialog).getText()).includes("已取消"), {
            timeout: 30_000,
          })
          .catch(() => undefined);
        await settle();
        await capture("cancelled", "Cancelled: Target retained, can retry");
        await closeDialog();
        for (const socket of stall.sockets) socket.destroy();
      });

      await segment("minimized", "在后台继续与后台失败", async () => {
        await openSelection();
        await clickTestIdByDom(TID_REMOTE_KIND_SSH);
        await fillSSHPasswordSettings({ ...config, host: "127.0.0.1", port: stall.port });
        await clickLastEnabledSSHDialogButton(MARKER);
        await browser.waitUntil(() => stall.sockets.size > 0, { timeout: 30_000 });
        await clickButton(/在BackgroundContinue|Collapse/u);
        await $('[data-testid="remote-connection-minimized"]').waitForDisplayed();
        await settle();
        await capture("minimized-connecting", "在后台继续：侧栏出现连接进度卡片");
        for (const socket of stall.sockets) socket.destroy();
        await browser.waitUntil(
          async () =>
            /Failed|failed/iu.test(await $('[data-testid="remote-connection-minimized"]').getText()),
          { timeout: 90_000 },
        );
        await $(dialog)
          .waitForExist({ reverse: true, timeout: 5_000 })
          .catch(() => undefined);
        await settle();
        await capture("minimized-failed", "后台连接失败：侧栏卡片变为失败态，不自动弹回");
        await $('[data-testid="remote-connection-minimized"]').click();
        await $(`${dialog} [data-testid="${TID_SSH_ERROR}"]`).waitForDisplayed();
        await settle();
        await capture("reopened-failed", "点击卡片恢复向导：失败详情");
        await closeDialog();
      });

      await segment("unfinished", "Pending connections on Settings page", async () => {
        await openSettingsRemoteDevices();
        const unfinished = $("[data-unfinished-connections]");
        if (await unfinished.isExisting()) {
          await $("[data-unfinished-connections] summary").click();
          await settle();
          await capture("settings-unfinished", "设置 · 未完成的连接（失败的新目标不生成设备卡）");
          await clickButton("Clear All", "[data-unfinished-connections]");
          await $('[role="dialog"]').waitForDisplayed();
          await capture("settings-clear-all-confirm", "清理全部确认框（截图后按 Esc 取消）");
          await browser.keys("Escape");
          await $('[role="dialog"]').waitForExist({ reverse: true });
        }
        await backToWorkspace();
      });

      if (container) {
        await segment("container", "Disconnection and recovery after stopping remote container", async () => {
          transportProxy!.setRejectNewConnections(true);
          await run("docker", ["stop", container]);
          containerStopped = true;
          await captureFrames(
            "connection-lost",
            "After remote stopped: Sidebar project transitions from connected to auto-recovering / action required / connection failed",
            async () => ["failed", "pending", "offline"].includes((await rowState(identity)) ?? ""),
            { timeoutMs: 180_000, intervalMs: 1_000 },
          );
          await settle();
          await capture(
            "sidebar-after-loss",
            `掉线后的SidebarProject行（Status：${await rowState(identity)}）`,
          );
          await openProjectActions(identity);
          await capture("sidebar-details-after-loss", "掉线后的项目操作菜单");
          await closePopover();
          await run("docker", ["start", container]);
          containerStopped = false;
          const published = await run("docker", ["port", container, "22/tcp"]);
          const port = Number(/^127\.0\.0\.1:(\d+)$/mu.exec(published.stdout)?.[1]);
          if (!Number.isInteger(port) || port < 1 || port > 65535)
            throw new Error("Dedicated container missing loopback SSH port after restart");
          endpoint.port = port;
          backendPorts.push(port);
          await waitForTcpPort(endpoint.host, endpoint.port, 60_000);
          transportProxy!.setRejectNewConnections(false);
          if ((await rowState(identity)) !== "online") {
            await requestRemoteProjectConnection(identity, MARKER);
          }
          if ((await $(dialog).isExisting()) && (await hasButton("重试"))) {
            await settle();
            await capture(
              "recovering-failed-detail",
              "Click failed project after remote recovery: First view last failure details and \"Retry\"",
            );
            await clickButton("重试");
          }
          await captureFrames(
            "recovering",
            "Click project after remote recovery: Reconnecting until online",
            async () => (await rowState(identity)) === "online",
            { timeoutMs: 180_000, intervalMs: 800 },
          );
          if (await $(dialog).isExisting()) {
            if (await $(`${dialog} [data-testid="${TID_SSH_SUCCESS}"]`).isExisting()) {
              await clickButton("Choose Later");
            }
            await closeDialog();
          }
          await settle();
          await capture("workspace-recovered", "远端恢复后项目重新在线");
        });
      }

      await segment("drag", "Drag preview", async () => {
        const dragSelector = `[data-project-workspace-identity="${identity}"] [data-testid="virtual-project-toggle"]`;
        const position = await startProjectPointerDrag(dragSelector);
        await browser.waitUntil(
          () =>
            browser.execute(
              (selector, top) =>
                Math.abs(document.querySelector(selector)!.getBoundingClientRect().top - top) >= 6,
              dragSelector,
              position.top,
            ),
          { timeout: 5000, timeoutMsg: "Project drag produced no visible displacement" },
        );
        await $(
          `[data-project-workspace-identity="${identity}"] [data-testid="project-device"]`,
        ).waitForDisplayed();
        const step = nextStep();
        await browser.saveScreenshot(resolve(artifact, `${step}-drag-device-light.png`));
        index.push({
          step,
          title: "Drag project: Moved project row retains device badge",
          files: [`${step}-drag-device-light.png`],
        });
        await browser.keys("Escape");
        await browser.releaseActions();
      });
    } finally {
      if (container && containerStopped)
        await run("docker", ["start", container]).catch(() => undefined);
      await stall.close();
      const video = await recording.stop({ tailDurationMs: 1_000 }).catch((error: unknown) => ({
        videoPath: null,
        error: String(error),
      }));
      if (!video.videoPath)
        index.push({
          step: nextStep(),
          title: "全程录屏失败",
          files: [],
          error: "error" in video ? video.error : "未生成视频",
        });
      await writeFile(
        resolve(artifact, "index.json"),
        JSON.stringify(
          {
            marker: MARKER,
            capturedAt: new Date().toISOString(),
            target: `${config.username}@${config.host}:${config.port}`,
            backendPorts,
            video,
            captures: index,
          },
          null,
          2,
        ),
      );
    }
    expect(index.filter((entry) => entry.error !== undefined).map((entry) => entry.title)).toEqual(
      [],
    );
  });
});
