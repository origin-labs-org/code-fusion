import { startDraftFromProject } from "#e2e/helpers/project-sidebar";
import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "#e2e/helpers/remote-project-actions";
import { Buffer } from "node:buffer";
import { selectUpstreamModel } from "#e2e/helpers/upstream-provider";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { TID_TASK_ARCHIVE, TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByDom } from "../../../helpers/desktop-app.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import { readRemoteTabSnapshot, runSSHCommand } from "../../../helpers/ssh-remote-p0.js";
import {
  selectV4TaskById,
  waitForV4ConversationState,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_TASK_ACTIONS";
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-task-actions");

async function readTaskOrder(): Promise<string[]> {
  return browser.execute(
    (prefix) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}-"]`))
        .filter((node) => node.getClientRects().length)
        .map((node) => (node.dataset.testid ?? "").slice(prefix.length + 1)),
    TID_TASK_ITEM,
  );
}

async function clickTaskAction(taskId: string, ariaLabel: string): Promise<boolean> {
  const item = $(`[data-testid="${testId(TID_TASK_ITEM, taskId)}"]`);
  await item.waitForExist({ timeout: 30_000 });
  await item.moveTo();
  return browser.waitUntil(
    () =>
      browser.execute(
        (itemTestId, label) => {
          const node = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
            (candidate) => candidate.dataset.testid === itemTestId,
          );
          const li = node?.closest("li") ?? node;
          const button = Array.from(li?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
            (b) => b.getAttribute("aria-label") === label && !b.disabled,
          );
          if (!button) return false;
          button.click();
          return true;
        },
        testId(TID_TASK_ITEM, taskId),
        ariaLabel,
      ),
    {
      timeout: 15_000,
      interval: 200,
      timeoutMsg: `${CASE_MARKER}: task ${taskId} 没有Available的“${ariaLabel}”`,
    },
  );
}

describe(`${CASE_MARKER}: 多 Source task 的置顶/Archive写操作Hit原 Source、Offline fail-closed、跨ReconnectPersistence`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "task-actions.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-UI-02 Remote task pin/archive: immediate list update, preserved after reconnection (written to original Source), local tasks unaffected; task row inoperable when offline (fail-closed)", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    await selectUpstreamModel();
    const localMarker = `${CASE_MARKER}_LOCAL_CONTROL`;
    await sendV4PromptAndWaitAccepted(
      `${localMarker} 请Reply`,
      localMarker,
      `${CASE_MARKER}: Local machine对照Task未被接受`,
    );
    await waitForV4AssistantMessageContaining("R3_TASK_ACTIONS_REPLY", 90_000);
    const localControl = await waitForV4ConversationState(
      (state) => Boolean(state.taskId && state.taskId !== "draft") && state.state === "idle",
      `${CASE_MARKER}: Local machine对照Task没有Completed`,
      60_000,
    );
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    await startDraftFromProject(workspaceA, { workspaceIdentity: taskA.identity });
    await sendV4PromptAndWaitAccepted(
      `${CASE_MARKER}_SECOND 请Reply`,
      `${CASE_MARKER}_SECOND`,
      `${CASE_MARKER}: 第Two个 task 未被接受`,
    );
    const second = await waitForV4ConversationState(
      (s) => Boolean(s.taskId && s.taskId !== "draft" && s.taskId !== taskA.taskId),
      `${CASE_MARKER}: 第Two个 task 没有产生`,
      60_000,
    );
    await waitForV4AssistantMessageContaining("R3_TASK_ACTIONS_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => s.taskId === second.taskId && s.state === "idle",
      `${CASE_MARKER}: 第Two个 task 没有收口`,
      90_000,
    );
    const taskB = second.taskId!;
    const orderBefore = await readTaskOrder();
    facts.orderBefore = orderBefore;
    expect(orderBefore).toEqual(expect.arrayContaining([taskA.taskId, taskB]));

    expect(await clickTaskAction(taskA.taskId, "置顶任务")).toBe(true);
    await browser.waitUntil(
      async () => {
        const order = await readTaskOrder();
        const indexA = order.indexOf(taskA.taskId);
        const indexB = order.indexOf(taskB);
        return indexA >= 0 && indexB >= 0 && indexA < indexB;
      },
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 置顶后 A 没有排到 B 前` },
    );
    facts.orderAfterPin = await readTaskOrder();
    const unpinVisible = await browser.execute(
      (itemTestId) => {
        const node = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (candidate) => candidate.dataset.testid === itemTestId,
        );
        return Boolean(
          Array.from(node?.closest("li")?.querySelectorAll("button") ?? []).find(
            (b) => b.getAttribute("aria-label") === "取消置顶任务",
          ),
        );
      },
      testId(TID_TASK_ITEM, taskA.taskId),
    );
    facts.unpinAvailable = unpinVisible;
    expect(unpinVisible).toBe(true);

    await clickTaskAction(taskB, "归档任务");
    await clickTestIdByDom(testId(TID_TASK_ARCHIVE, taskB), {
      timeout: 10_000,
      timeoutMsg: `${CASE_MARKER}: Archive确认按钮没有出现`,
    }).catch(() => undefined);
    await browser.waitUntil(async () => !(await readTaskOrder()).includes(taskB), {
      timeout: 20_000,
      timeoutMsg: `${CASE_MARKER}: Archive后 B 仍在list`,
    });
    facts.orderAfterArchive = await readTaskOrder();

    const idsBase64 = Buffer.from(JSON.stringify([taskA.taskId, taskB])).toString("base64");
    let remoteRows: Array<{
      task_id: string;
      workspace_path: string;
      pinned: number;
      archived: number;
    }> = [];
    await browser.waitUntil(
      async () => {
        const result = await runSSHCommand(
          prepared.config,
          `python3 - <<'PY'
import base64,json,os,sqlite3
ids=json.loads(base64.b64decode("${idsBase64}"))
path=os.path.expanduser("~/.cf/v2/tasks-index.sqlite")
with sqlite3.connect("file:"+path+"?mode=ro",uri=True) as connection:
    connection.row_factory=sqlite3.Row
    rows=connection.execute("SELECT task_id,workspace_path,pinned,archived FROM tasks WHERE task_id IN (?,?)",ids).fetchall()
    print(json.dumps([dict(row) for row in rows]))
PY`,
        );
        if (result.code !== 0)
          throw new Error(`${CASE_MARKER}: Read Source task index Failed: ${result.stderr}`);
        remoteRows = JSON.parse(result.stdout);
        return (
          remoteRows.length === 2 &&
          remoteRows.some(
            (row) =>
              row.task_id === taskA.taskId &&
              row.workspace_path === workspaceA &&
              row.pinned === 1 &&
              row.archived === 0,
          ) &&
          remoteRows.some(
            (row) =>
              row.task_id === taskB && row.workspace_path === workspaceA && row.archived === 1,
          )
        );
      },
      {
        timeout: 15_000,
        interval: 500,
        timeoutMsg: `${CASE_MARKER}: Source task index 没有Persistence置顶与Archive`,
      },
    );
    facts.remoteDbRows = remoteRows;

    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId ?? "";

    await disconnectRemoteSource(sourceId!, CASE_MARKER, { workspaceIdentities: [taskA.identity] });

    await browser.pause(2_000);
    const offlineRows = await readTaskOrder();
    const offlineActionable = await browser.execute(
      (itemTestId) => {
        const node = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (candidate) => candidate.dataset.testid === itemTestId,
        );
        if (!node) return "row-hidden";
        const buttons = Array.from(
          node.closest("li")?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        );
        return buttons.some(
          (b) => !b.disabled && /置顶|Archive/u.test(b.getAttribute("aria-label") ?? ""),
        )
          ? "enabled"
          : "disabled";
      },
      testId(TID_TASK_ITEM, taskA.taskId),
    );
    facts.offline = { rows: offlineRows, taskAActions: offlineActionable };
    expect(offlineActionable).not.toBe("enabled");

    await reconnectRemoteProject(taskA.identity, CASE_MARKER);
    await browser.waitUntil(
      async () =>
        Boolean((await readRemoteTabSnapshot(taskA.identity).catch(() => null))?.remoteSessionId),
      { timeout: 120_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: Reconnect没有恢复` },
    );
    await browser.waitUntil(async () => (await readTaskOrder()).includes(taskA.taskId), {
      timeout: 60_000,
      timeoutMsg: `${CASE_MARKER}: Reconnect后Tasklist没有恢复`,
    });
    const orderAfterReconnect = await readTaskOrder();
    const pinnedAfterReconnect = await browser.execute(
      (itemTestId) => {
        const node = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (candidate) => candidate.dataset.testid === itemTestId,
        );
        return Boolean(
          Array.from(node?.closest("li")?.querySelectorAll("button") ?? []).find(
            (b) => b.getAttribute("aria-label") === "取消置顶任务",
          ),
        );
      },
      testId(TID_TASK_ITEM, taskA.taskId),
    );
    facts.afterReconnect = {
      order: orderAfterReconnect,
      archivedStillHidden: !orderAfterReconnect.includes(taskB),
      pinnedKept: pinnedAfterReconnect,
    };
    expect(orderAfterReconnect.includes(taskB)).toBe(false);
    expect(pinnedAfterReconnect).toBe(true);
    await selectV4TaskById(taskA.taskId);
    await sendV4PromptAndWaitAccepted(
      `${taskA.followPrompt}: 只Reply ${taskA.followReply}`,
      taskA.followPrompt,
      `${CASE_MARKER}: Reconnect后续发未被接受`,
    );
    await waitForV4AssistantMessageContaining(taskA.followReply, 90_000);
    await selectV4TaskById(localControl.taskId!, 30_000);
    const localRow = $(`[data-testid="${testId(TID_TASK_ITEM, localControl.taskId!)}"]`);
    await localRow.waitForDisplayed({ timeout: 15_000 });
    await localRow.moveTo();
    await browser.waitUntil(
      () =>
        browser.execute(
          (rowId) => {
            const row = document.querySelector<HTMLElement>(`[data-testid="${rowId}"]`);
            return Array.from(
              row?.closest("li")?.querySelectorAll<HTMLButtonElement>("button") ?? [],
            ).some(
              (button) => button.getAttribute("aria-label") === "置顶任务" && !button.disabled,
            );
          },
          testId(TID_TASK_ITEM, localControl.taskId!),
        ),
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Local machine对照Task被Error置顶orHide` },
    );
    expect((await readRemoteTabSnapshot()).activeWorkspaceIdentity).toBeNull();
    facts.localControlUnaffected = { taskId: localControl.taskId, visible: true, unpinned: true };
  });
});
