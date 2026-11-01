import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { countRendererReloadAcks } from "#e2e/helpers/remote-renderer-ready-evidence";
import { waitForV4Pane } from "#e2e/helpers/v4-conversation";
import { TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  readTaskRowInProject,
  readRemoteCoreIdentity,
  sendSSHFollowTurn,
  waitForRendererAfterColdRestart,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  waitForRemoteTab,
} from "../../../helpers/ssh-remote-p0.js";

const CASE_MARKER = "E2E_R3_RENDERER_RELOAD";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-renderer-reload",
);

async function readReadyCounts() {
  const directory = process.env.CF_E2E_RUNTIME_LOG_DIR;
  if (!directory) throw new Error("缺少本 worker 的 Desktop 日志目录");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".log"));
  const counts = new Map<string, number>();
  for (const content of await Promise.all(
    files.map((name) => readFile(join(directory, name), "utf8")),
  )) {
    for (const [id, count] of countRendererReloadAcks(content)) {
      counts.set(id, (counts.get(id) ?? 0) + count);
    }
  }
  return counts;
}

async function selectReloadedTask(task: SSHLifecycleTask, facts: Record<string, unknown>) {
  facts[`beforeSelecting${task.label}`] = await readRemoteTabSnapshot(task.identity);
  const row = $(`[data-project-workspace-identity=${JSON.stringify(task.identity)}]`).$(
    `[data-testid=${JSON.stringify(testId(TID_TASK_ITEM, task.taskId))}]`,
  );
  await row.waitForDisplayed({ timeout: 30_000 });
  await row.click();
  try {
    await waitForV4Pane(
      (pane) => pane.sessionId === task.taskId,
      `${CASE_MARKER}: 真实点击 ${task.label} 未切换Task`,
    );
  } finally {
    facts[`afterSelecting${task.label}`] = {
      tab: await readRemoteTabSnapshot(task.identity),
      panes: await browser.execute(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid^="v4-session-pane-"]')].map(
          (pane) => ({
            id: pane.dataset.testid,
            sessionId: pane.dataset.sessionId,
            visible: pane.getClientRects().length > 0,
          }),
        ),
      ),
    };
  }
}

describe(`${CASE_MARKER}: 仅 renderer reload 时复用 Host 与物理Connect`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "renderer-reload.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-REC-06 Renderer reload with two opened workspaces: Host/remote session generation unchanged, subscriptions and projections restored, conversation can continue", async function () {
    this.timeout(20 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const [workspaceA, workspaceB] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const taskB = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "B",
      provider,
      workspacePath: workspaceB,
    });
    const hostsBefore = await readHostProcesses();
    const coreBefore = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    expect(taskA.remoteSessionId).not.toBe(taskB.remoteSessionId);
    const readyBefore = await readReadyCounts();

    const reloadStartedAt = Date.now();
    await browser.refresh();
    await waitForRendererAfterColdRestart(CASE_MARKER);
    facts.rendererReadyMs = Date.now() - reloadStartedAt;
    let readyAfter = new Map<string, number>();
    await browser.waitUntil(
      async () => {
        readyAfter = await readReadyCounts();
        return [taskA, taskB].every(
          (task) =>
            (readyAfter.get(task.remoteSessionId) ?? 0) >
            (readyBefore.get(task.remoteSessionId) ?? 0),
        );
      },
      {
        timeout: 60_000,
        interval: 250,
        timeoutMsg: `${CASE_MARKER}: 两个 workspace 未All收到 renderer reload ready ACK`,
      },
    );
    facts.reloadReadyAcks = Object.fromEntries(readyAfter);
    await readTaskRowInProject(taskA, CASE_MARKER);
    await selectReloadedTask(taskA, facts);
    const tabA = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskA.identity,
      expectedPath: workspaceA,
      requireActive: false,
      timeoutMs: 60_000,
    });
    await readTaskRowInProject(taskB, CASE_MARKER);
    await selectReloadedTask(taskB, facts);
    const tabB = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: taskB.identity,
      expectedPath: workspaceB,
      requireActive: false,
      timeoutMs: 60_000,
    });
    facts.sessions = {
      A: { before: taskA.remoteSessionId, after: tabA.remoteSessionId },
      B: { before: taskB.remoteSessionId, after: tabB.remoteSessionId },
    };
    expect(tabA.remoteSessionId).toBe(taskA.remoteSessionId);
    expect(tabB.remoteSessionId).toBe(taskB.remoteSessionId);
    expect(await readHostProcesses()).toEqual(hostsBefore);
    const coreAfter = await readRemoteCoreIdentity(prepared.config, CASE_MARKER);
    expect(coreAfter.pid).toBe(coreBefore.pid);
    expect(coreAfter.startTicks).toBe(coreBefore.startTicks);
    expect(coreAfter.generation).toBe(coreBefore.generation);
    expect((await readRemoteTabSnapshot(taskA.identity)).secretPersistedInTab).toBe(false);

    await readTaskRowInProject(taskA, CASE_MARKER);
    await readTaskRowInProject(taskB, CASE_MARKER);
    await sendSSHFollowTurn(taskA, CASE_MARKER, taskB.firstPrompt);
    await sendSSHFollowTurn(taskB, CASE_MARKER, taskA.firstPrompt);
    facts.followTurnsAfterReload = true;
  });
});
