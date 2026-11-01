import { openMobilePairingPage } from "#e2e/helpers/mobile-pairing";
import { readRemoteToolExecutionEvents } from "#e2e/helpers/remote-tool-execution-evidence";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import {
  PERMISSION_INTERACTION_PREFIX,
  readPermissionInteractionIdsInBrowser,
  waitForPermissionInteractionId,
} from "#e2e/helpers/permission-interaction-id";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  listRemoteAgentProcesses,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  runSSHCommand,
} from "../../../helpers/ssh-remote-p0.js";
import {
  getV4ConversationState,
  hasV4PermissionDialog,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4PermissionDialogInComposerDock,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_MOBILE_PERMISSION";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-mobile-permission",
);
const CHROME =
  process.env.R3_MOBILE_CHROME?.trim() ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const MOBILE_VIEWPORT = { width: 390, height: 844 };
const run = promisify(execFile);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwPage = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwContext = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PwBrowser = any;

async function countRemoteSshSessions(container: string): Promise<number> {
  const { stdout } = await run("docker", [
    "exec",
    container,
    "sh",
    "-c",
    "ps -o user=,args= -C sshd | grep -c '^dev ' || true",
  ]);
  return Number.parseInt(stdout.trim() || "0", 10);
}

async function obtainPairUrl(): Promise<string> {
  await browser.execute(() => {
    const clipboard = navigator.clipboard;
    const original = clipboard.writeText.bind(clipboard);
    (
      window as Window & { __r3RestoreClipboard?: () => void; __r3PairUrl?: string }
    ).__r3RestoreClipboard = () => {
      clipboard.writeText = original;
    };
    clipboard.writeText = async (text: string) => {
      (window as Window & { __r3PairUrl?: string }).__r3PairUrl = text;
    };
  });
  const trigger = $('button[aria-label="移动端远程控制"]');
  await trigger.waitForClickable({ timeout: 30_000 });
  await trigger.click();
  await $('[data-testid="web-remote-control-dialog-scroll"]').waitForDisplayed({ timeout: 30_000 });
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const button = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '[data-testid="web-remote-control-dialog-scroll"] button',
          ),
        ).find((b) => b.innerText.trim() === "复制链接" && !b.disabled);
        button?.click();
        return Boolean(button);
      }),
    {
      timeout: 60_000,
      interval: 500,
      timeoutMsg: `${CASE_MARKER}: Copy link按钮Unavailable（relay 未就绪？）`,
    },
  );
  let url = "";
  await browser.waitUntil(
    async () => {
      url = (await browser.execute(
        () => (window as Window & { __r3PairUrl?: string }).__r3PairUrl ?? "",
      )) as string;
      return url.startsWith("http");
    },
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 没有取得配对链接` },
  );
  await browser.execute(() => {
    const w = window as Window & { __r3RestoreClipboard?: () => void; __r3PairUrl?: string };
    w.__r3RestoreClipboard?.();
    delete w.__r3RestoreClipboard;
    delete w.__r3PairUrl;
  });
  return url;
}

async function readDesktopMobileStatus(): Promise<string> {
  return browser.execute(
    () =>
      document
        .querySelector<HTMLElement>('[data-testid="web-remote-control-connection-card"]')
        ?.innerText.replace(/\s+/gu, " ")
        .slice(0, 200) ?? "",
  );
}

async function closeRemoteControlDialog(): Promise<void> {
  await browser.keys(["Escape"]);
  await browser
    .waitUntil(
      () =>
        browser.execute(
          () => !document.querySelector('[data-testid="web-remote-control-dialog-scroll"]'),
        ),
      { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: Remote控制Chat框没有Close` },
    )
    .catch(() => undefined);
}

async function mobileText(page: PwPage): Promise<string> {
  return (await page.evaluate(() => document.body?.innerText ?? "")) as string;
}

const REMOTE_PERMISSION_DIR = "/home/dev/r3-workspace-a/.cf-e2e/r3-mobile-permission";
const REMOTE_PERMISSION_FILE = `${REMOTE_PERMISSION_DIR}/permission-output.txt`;
const PERMISSION_EXECUTION = { toolCallId: "toolu_r3_mobp_permission", toolName: "Write" };

async function readMobilePermission(
  page: PwPage,
): Promise<{ visible: boolean; text: string; optionCount: number; interactionIds: string[] }> {
  const state = (await page.evaluate(() => {
    const listbox = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).find(
      (node) => node.getClientRects().length && node.querySelector('button[role="option"]'),
    );
    const dock = listbox?.closest<HTMLElement>("[data-testid], form, section") ?? listbox;
    return {
      visible: Boolean(listbox),
      text: (dock?.innerText ?? "").replace(/\s+/gu, " ").slice(0, 300),
      optionCount: listbox?.querySelectorAll('button[role="option"]').length ?? 0,
    };
  })) as { visible: boolean; text: string; optionCount: number };
  const interactionIds = await page.evaluate(
    readPermissionInteractionIdsInBrowser,
    PERMISSION_INTERACTION_PREFIX,
  );
  return { ...state, interactionIds };
}

describe(`${CASE_MARKER}: Permissions阻塞在手机端呈现、重建手机 bridge 后同One阻塞恢复、手机Answer后各端清除`, () => {
  let provider: SSHLifecycleProvider | null = null;
  let mobileBrowser: PwBrowser = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "mobile-permission.json"), JSON.stringify(facts, null, 2));
    await mobileBrowser?.close().catch(() => undefined);
    mobileBrowser = null;
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-MOB-04 Remote Write permission pending → mobile shows same block; block remains with same ID after closing mobile context and rebuilding bridge; desktop and mobile cleared after mobile approval, remote tool truly executed exactly once", async function () {
    this.timeout(40 * 60_000);
    const container = process.env.CF_E2E_SSH_CONTAINER?.trim();
    if (!container) throw new Error(`${CASE_MARKER}: Missing CF_E2E_SSH_CONTAINER`);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, {
      apiType: "anthropic-messages",
      tunnelUsername: "tunnel",
    });
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    await runSSHCommand(prepared.config, `rm -rf "${REMOTE_PERMISSION_DIR}"`);
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const baseline = {
      hosts: (await readHostProcesses()).length,
      ssh: await countRemoteSshSessions(container),
      agents: (await listRemoteAgentProcesses(prepared.config)).length,
    };
    facts.baseline = baseline;

    const pairUrl = await obtainPairUrl();
    const { chromium } = (await import("playwright-core")) as {
      chromium: { launch(o: object): Promise<PwBrowser> };
    };
    mobileBrowser = await chromium.launch({ headless: true, executablePath: CHROME });
    let pairingAttempt = 0;
    const newMobileContext = async (): Promise<{ context: PwContext; page: PwPage }> => {
      const context = await mobileBrowser.newContext({
        viewport: MOBILE_VIEWPORT,
        isMobile: true,
        hasTouch: true,
        locale: "zh-CN",
      });
      const page = await context.newPage();
      await openMobilePairingPage(page, pairUrl, {
        artifactDir,
        caseMarker: CASE_MARKER,
        phase: `pairing-${++pairingAttempt}`,
        readySelector: `[data-testid="${testId(TID_TASK_ITEM, taskA.taskId)}"]`,
      });
      return { context, page };
    };
    let { context: mobileContext, page: mobile } = await newMobileContext();
    await browser.waitUntil(async () => (await readDesktopMobileStatus()).includes("Mobile connected"), {
      timeout: 60_000,
      timeoutMsg: `${CASE_MARKER}: Desktop 未ShowPhone connected`,
    });
    await closeRemoteControlDialog();
    await mobile
      .locator(`[data-testid="${testId(TID_TASK_ITEM, taskA.taskId)}"]`)
      .first()
      .click();
    await mobile.getByText(taskA.firstReply, { exact: false }).first().waitFor({ timeout: 60_000 });

    const permissionStart = await getUpstreamRequestRecordCount();
    await sendV4Prompt(`${CASE_MARKER}_PERMISSION 写File`);
    await waitForUpstreamRequest(
      { lastUserMessageIncludes: [`${CASE_MARKER}_PERMISSION`] },
      `${CASE_MARKER}: Permissions回合没有到达回放`,
      60_000,
      { afterIndex: permissionStart - 1 },
    );
    const dock = await waitForV4PermissionDialogInComposerDock(90_000);
    facts.desktopPermission = dock;
    expect(dock.inDock).toBe(true);
    const pendingId = await waitForPermissionInteractionId(CASE_MARKER);
    facts.permissionInteractionId = pendingId;
    let mobilePermission = await readMobilePermission(mobile);
    await browser.waitUntil(
      async () => {
        mobilePermission = await readMobilePermission(mobile);
        return mobilePermission.visible && mobilePermission.interactionIds.length === 1;
      },
      { timeout: 60_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: 手机端没有ShowPermissions阻塞` },
    );
    facts.mobilePermissionFirst = mobilePermission;
    expect(mobilePermission.interactionIds).toEqual([pendingId]);
    const remoteBeforeApprove = await runSSHCommand(
      prepared.config,
      `test -f "${REMOTE_PERMISSION_FILE}" && echo EXISTS || echo ABSENT`,
    );
    expect(remoteBeforeApprove.stdout.trim()).toBe("ABSENT");

    await mobileContext.close();
    await browser.pause(5_000);
    facts.desktopStillBlockedAfterMobileGone = await hasV4PermissionDialog();
    expect(facts.desktopStillBlockedAfterMobileGone).toBe(true);
    ({ context: mobileContext, page: mobile } = await newMobileContext());
    await mobile
      .locator(`[data-testid="${testId(TID_TASK_ITEM, taskA.taskId)}"]`)
      .first()
      .click();
    await browser.waitUntil(
      async () => {
        mobilePermission = await readMobilePermission(mobile);
        return mobilePermission.visible && mobilePermission.interactionIds.length === 1;
      },
      {
        timeout: 60_000,
        interval: 1000,
        timeoutMsg: `${CASE_MARKER}: 重建 bridge 后手机端没有恢复Permissions阻塞`,
      },
    );
    facts.mobilePermissionAfterRepair = mobilePermission;
    expect(mobilePermission.interactionIds).toEqual([pendingId]);
    expect(await waitForPermissionInteractionId(CASE_MARKER)).toBe(pendingId);
    const first = facts.mobilePermissionFirst as { text: string; optionCount: number };
    expect(mobilePermission.optionCount).toBe(first.optionCount);
    expect(mobilePermission.text).toContain("permission-output.txt");
    expect(mobilePermission.text).toContain("需要权限");
    expect(first.text).toContain("需要权限");
    const executionQuery = { sessionId: taskA.taskId, toolName: PERMISSION_EXECUTION.toolName };
    expect(await readRemoteToolExecutionEvents(prepared.config, executionQuery)).toEqual([]);

    await mobile.locator('[role="listbox"] button[role="option"]').first().click();
    await browser.waitUntil(async () => !(await hasV4PermissionDialog()), {
      timeout: 60_000,
      timeoutMsg: `${CASE_MARKER}: 手机Allow后Desktop阻塞没有清除`,
    });
    await waitForV4AssistantMessageContaining("R3_MOBILE_PERMISSION_DONE", 120_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: Permissions回合没有收口`,
      120_000,
    );
    await browser.pause(3_000);
    const mobileAfter = await readMobilePermission(mobile);
    const remoteFile = await runSSHCommand(
      prepared.config,
      `cat "${REMOTE_PERMISSION_FILE}" 2>/dev/null | wc -l; cat "${REMOTE_PERMISSION_FILE}" 2>/dev/null`,
    );
    facts.afterApprove = {
      mobilePermissionVisible: mobileAfter.visible,
      remoteFile: remoteFile.stdout.trim().split("\n"),
      desktopState: (await getV4ConversationState()).state,
    };
    expect(mobileAfter.visible).toBe(false);
    expect(remoteFile.stdout).toContain("R3_MOBILE_PERMISSION_RESULT");
    expect(remoteFile.stdout.trim().split("\n")[0]).toBe("1");
    let executions = await readRemoteToolExecutionEvents(prepared.config, executionQuery);
    await browser.waitUntil(
      async () => {
        executions = await readRemoteToolExecutionEvents(prepared.config, executionQuery);
        facts.remoteToolExecutions = executions;
        return executions.some((event) => event.event === "tool.call.completed");
      },
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 远端 Write MissingCompletedEvents` },
    );
    expect(executions.filter((event) => event.event === "tool.call.started")).toHaveLength(1);
    expect(executions.filter((event) => event.event === "tool.call.completed")).toHaveLength(1);
    expect(executions.every((event) => event.toolCallId === PERMISSION_EXECUTION.toolCallId)).toBe(
      true,
    );
    const after = {
      hosts: (await readHostProcesses()).length,
      ssh: await countRemoteSshSessions(container),
      agents: (await listRemoteAgentProcesses(prepared.config)).length,
    };
    facts.after = after;
    expect(after.hosts).toBe(baseline.hosts);
    expect(after.ssh).toBeLessThanOrEqual(baseline.ssh);
    expect(after.agents).toBeLessThanOrEqual(baseline.agents);
    await mobileContext.close();
  });
});
