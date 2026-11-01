import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TID_CHAT_MODE_SELECT_TRIGGER, TID_V4_COMPOSER_SEND } from "@origin-ai/cf-shared/test-ids";
import { ServiceChannels } from "@origin-ai/cf-shared";
import {
  installHandoffRpcProbe,
  callHandoffHost,
  restoreHandoffProbes,
} from "../../../helpers/remote-project-handoff-probe.js";
import {
  UPSTREAM_PROVIDER_ID,
  ensureUpstreamProviderForE2E,
  UPSTREAM_MODEL,
  UPSTREAM_SECONDARY_MODEL,
} from "../../../helpers/upstream-provider.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import { startDraftFromProject } from "../../../helpers/project-sidebar.js";
import { clearAppData, DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import { resolveE2ERuntimePath, resolveE2EToolPath } from "../../../helpers/e2e-runtime-paths.js";
import { getLatestUpstreamToolResultByToolCallId } from "../../../helpers/conversation-session-network.js";
import { getV4ComposerDraftScopeSnapshot } from "../../../helpers/conversation-session-store.js";
import {
  getV4ModelConfig,
  getV4PaneSnapshot,
  selectV4TaskById,
  sendV4PromptAndWaitAccepted as sendPrompt,
  switchV4Mode,
  switchV4Model,
  setV4ComposerText,
  waitForV4ComposerSelectionReady,
  waitForV4TimelineContaining,
  waitForV4ComposerText,
  sendV4Prompt,
} from "../../../helpers/v4-conversation.js";

declare global {
  interface Window {
    __pdSendGate?: { count: number; release(): void; restore(): void };
  }
}

async function sendV4PromptAndWaitAccepted(prompt: string, marker: string, message: string) {
  try {
    await sendPrompt(prompt, marker, message);
  } catch (error) {
    const details = $('[data-testid="chat-error-details-button"]');
    if (await details.isExisting()) {
      await details.click();
      const content = $('[role="dialog"] pre');
      await content.waitForDisplayed();
      throw new Error(`${message}: ${await content.getText()}`, { cause: error });
    }
    throw error;
  }
}

const CASE_NAME = "conversation-session-composer-recent-mode";
const CASE_DIR = resolveE2ERuntimePath(CASE_NAME);
const OUTPUT_PATH = resolveE2EToolPath(CASE_NAME, "result.txt");
const EVIDENCE_DIR = join(
  process.env.CF_E2E_ARTIFACT_DIR ?? join(process.cwd(), ".e2e-artifacts"),
  CASE_NAME,
);

async function captureState(step: string) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const permissionTrigger = $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`);
  await permissionTrigger.waitForDisplayed();
  const state = {
    pane: await getV4PaneSnapshot(),
    composer: await getV4ModelConfig(),
    rootDraft: await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, null),
    permissionLabel: await permissionTrigger.getText(),
    persisted: await browser.execute(() => ({
      entries: Object.entries(localStorage).filter(
        ([key]) => key.includes("composer-") || key.includes("pending-command"),
      ),
      navigation: (
        window as unknown as { __cfTabStoreE2E: { getState(): unknown } }
      ).__cfTabStoreE2E.getState(),
    })),
  };
  await writeFile(join(EVIDENCE_DIR, `${step}.json`), JSON.stringify(state, null, 2));
  await browser.saveScreenshot(join(EVIDENCE_DIR, `${step}.png`));
  return state;
}

async function expectMode(mode: string) {
  await $(`[data-testid="${TID_CHAT_MODE_SELECT_TRIGGER}"]`).waitForDisplayed();
  await waitForV4ComposerSelectionReady();
  expect((await getV4ModelConfig()).mode).toBe(mode);
}

describe("Composer Recent 权限继承", () => {
  it("PD01/02: 任务草稿复用执行目录，接纳后新任务换目录并继承模型权限", async () => {
    await skipOccupationOnboardingIfPresent();
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });
    const startTask = async () => {
      const button = $('[data-testid="virtual-project-new-task"]');
      await $('[data-testid="conversation-section"]').moveTo();
      await button.waitForDisplayed();
      await button.click();
      await browser.waitUntil(
        async () =>
          (await getV4PaneSnapshot()).sessionId === "draft" &&
          (await browser.execute(() => {
            const w = window as unknown as {
              __cfTabStoreE2E: { getState(): { activeWorkspacePath: string } };
            };
            const pending = JSON.parse(
              localStorage.getItem('cf-pending-task-draft:v1:["desktop","local",null]') ??
                "null",
            );
            return Boolean(
              pending?.workspacePath &&
              pending.workspacePath === w.__cfTabStoreE2E.getState().activeWorkspacePath,
            );
          })),
      );
    };
    const activePath = () =>
      browser.execute(
        () =>
          (
            window as unknown as {
              __cfTabStoreE2E: { getState(): { activeWorkspacePath: string } };
            }
          ).__cfTabStoreE2E.getState().activeWorkspacePath,
      );
    await startTask();
    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "");
    await switchV4Mode("yolo");
    await setV4ComposerText("E2E_PD01_UNSENT");
    const firstPath = await activePath();
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await startTask();
    await waitForV4ComposerText("E2E_PD01_UNSENT", "Task draft was not restored");
    expect(await activePath()).toBe(firstPath);
    await expectMode("yolo");
    const selected = await getV4ModelConfig();
    await sendV4PromptAndWaitAccepted(
      "E2E_COMPOSER_RECENT_MODE_SEED 请回复测试标记。",
      "E2E_COMPOSER_RECENT_MODE_SEED",
      "Initial task send was not accepted",
    );
    await startTask();
    await waitForV4ComposerText("", "New task should not copy sent body");
    expect(await activePath()).not.toBe(firstPath);
    await expectMode("yolo");
    expect(await getV4ModelConfig()).toMatchObject({
      provider: selected.provider,
      model: selected.model,
    });
  });

  it("PD03/04/09: Projects in same directory save drafts and default configs independently; modifying primary directory preserves project draft", async () => {
    await installHandoffRpcProbe();
    try {
      const p = await callHandoffHost<{ id: string }>(ServiceChannels.Project, "saveProject", [
        { name: "E2E_PD_P", roots: [DEFAULT_WORKSPACE], primaryRoot: DEFAULT_WORKSPACE },
      ]);
      const q = await callHandoffHost<{ id: string }>(ServiceChannels.Project, "saveProject", [
        { name: "E2E_PD_Q", roots: [DEFAULT_WORKSPACE], primaryRoot: DEFAULT_WORKSPACE },
      ]);
      const start = async (id: string) => {
        const section = $(`[data-project-id="${id}"]`);
        await section.waitForDisplayed();
        await section.moveTo();
        await section.$('[data-testid="virtual-project-create-task"]').click();
      };
      await start(p.id);
      await setV4ComposerText("E2E_PD_PROJECT_P");
      await switchV4Mode("yolo");
      await start(q.id);
      await waitForV4ComposerText("", "Q incorrectly read P\'s draft");
      await setV4ComposerText("E2E_PD_PROJECT_Q");
      await switchV4Mode("build");
      await start(p.id);
      await waitForV4ComposerText("E2E_PD_PROJECT_P", "P\'s draft was overwritten");
      await expectMode("yolo");
      await start(q.id);
      await waitForV4ComposerText("E2E_PD_PROJECT_Q", "Q\'s draft was overwritten");
      await expectMode("build");
      await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_SECONDARY_MODEL, "");
      await sendV4PromptAndWaitAccepted(
        "E2E_COMPOSER_RECENT_MODE_SECOND Q",
        "E2E_COMPOSER_RECENT_MODE_SECOND",
        "Q initial send was not accepted",
      );
      await waitForV4TimelineContaining("RECENT_MODE_SECOND_DONE");
      await start(p.id);
      await waitForV4ComposerText("E2E_PD_PROJECT_P", "Q acceptance contaminated P's draft");
      await expectMode("yolo");
      await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "");
      await sendV4PromptAndWaitAccepted(
        "E2E_COMPOSER_RECENT_MODE_SECOND P",
        "E2E_COMPOSER_RECENT_MODE_SECOND",
        "P initial send was not accepted",
      );
      await waitForV4TimelineContaining("RECENT_MODE_SECOND_DONE");
      const pSession = (await getV4PaneSnapshot()).sessionId;
      await start(q.id);
      await waitForV4ComposerText("", "Q sent body resurfaced");
      await expectMode("build");
      expect((await getV4ModelConfig()).model).toBe(UPSTREAM_SECONDARY_MODEL);
      await start(p.id);
      await expectMode("yolo");
      expect((await getV4ModelConfig()).model).toBe(UPSTREAM_MODEL);
      await setV4ComposerText("E2E_PD_PROJECT_MOVED_ROOT");
      const nextRoot = join(CASE_DIR, "new-primary");
      await mkdir(nextRoot, { recursive: true });
      await callHandoffHost(ServiceChannels.Project, "saveProject", [
        {
          id: p.id,
          name: "E2E_PD_P_RENAMED",
          roots: [DEFAULT_WORKSPACE, nextRoot],
          primaryRoot: nextRoot,
        },
      ]);
      await start(p.id);
      await waitForV4ComposerText("E2E_PD_PROJECT_MOVED_ROOT", "Changing project primary directory caused draft loss");
      await expectMode("yolo");
      const directories = await callHandoffHost<{ workspacePath: string }>(
        ServiceChannels.Project,
        "resolveSessionDirectories",
        [{ workspacePath: DEFAULT_WORKSPACE, taskId: pSession }],
      );
      expect(directories.workspacePath).toBe(DEFAULT_WORKSPACE);
    } finally {
      await restoreHandoffProbes();
    }
  });
  it("PD06/07: Switching away and back during in-flight initial send preserves directory; late acceptance completes handoff of original task", async () => {
    const startTask = async () => {
      await $('[data-testid="conversation-section"]').moveTo();
      await $('[data-testid="virtual-project-new-task"]').click();
      await browser.waitUntil(
        async () =>
          (await getV4PaneSnapshot()).sessionId === "draft" &&
          (await browser.execute(() => {
            const w = window as unknown as {
              __cfTabStoreE2E: { getState(): { activeWorkspacePath: string } };
            };
            const pending = JSON.parse(
              localStorage.getItem('cf-pending-task-draft:v1:["desktop","local",null]') ??
                "null",
            );
            return Boolean(
              pending?.workspacePath &&
              pending.workspacePath === w.__cfTabStoreE2E.getState().activeWorkspacePath,
            );
          })),
      );
    };
    const path = () =>
      browser.execute(
        () =>
          (
            window as unknown as {
              __cfTabStoreE2E: { getState(): { activeWorkspacePath: string } };
            }
          ).__cfTabStoreE2E.getState().activeWorkspacePath,
      );
    await startTask();
    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "");
    await switchV4Mode("yolo");
    const pendingPath = await path();
    await browser.execute(() => {
      const original = MessagePort.prototype.postMessage;
      const held: Array<() => void> = [];
      let holding = true;
      const gate = {
        count: 0,
        release() {
          holding = false;
          held.splice(0).forEach((send) => send());
        },
        restore() {
          gate.release();
          MessagePort.prototype.postMessage = original;
          delete window.__pdSendGate;
        },
      };
      MessagePort.prototype.postMessage = function (
        this: MessagePort,
        ...args: [unknown, (Transferable[] | StructuredSerializeOptions)?]
      ) {
        const data = args[0];
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : ArrayBuffer.isView(data)
              ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
              : null;
        const wire = bytes ? new TextDecoder().decode(bytes) : "";
        const forward = () => Reflect.apply(original, this, args);
        if (wire.includes("sendConversationCommandV4") && wire.includes('"type":"sendText"')) {
          gate.count += 1;
          if (holding) {
            held.push(forward);
            return;
          }
        }
        forward();
      };
      window.__pdSendGate = gate;
    });
    try {
      await sendV4Prompt("E2E_COMPOSER_RECENT_MODE_SECOND LATE_ACK");
      await browser.waitUntil(() => browser.execute(() => window.__pdSendGate?.count === 1));
      await startDraftFromProject(DEFAULT_WORKSPACE);
      await startTask();
      expect(await path()).toBe(pendingPath);
      expect(await $(`[data-testid="${TID_V4_COMPOSER_SEND}"]`).isEnabled()).toBe(false);
      await browser.execute(() => window.__pdSendGate!.release());
      await waitForV4TimelineContaining("RECENT_MODE_SECOND_DONE");
      expect(await browser.execute(() => window.__pdSendGate!.count)).toBe(1);
      expect((await getV4PaneSnapshot()).sessionId).not.toBe("draft");
      await startTask();
      expect(await path()).not.toBe(pendingPath);
      await waitForV4ComposerText("", "Late acceptance contaminated next task draft");
      await expectMode("yolo");
    } finally {
      await browser.execute(() => window.__pdSendGate?.restore());
    }
  });
  after(async () => {
    await clearAppData();
    await rm(CASE_DIR, { recursive: true, force: true });
  });

  it("TD01/03/04: Blank is not saved, text restored on refresh, New Task re-fetches default after clearing", async () => {
    await skipOccupationOnboardingIfPresent();
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });
    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "");
    await switchV4Mode("yolo");
    expect((await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, null)).exists).toBe(false);
    await setV4ComposerText("unsent text persistence");
    await browser.waitUntil(
      async () =>
        (await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, null)).text ===
        "unsent text persistence",
    );
    await browser.refresh();
    try {
      await waitForV4ComposerText("unsent text persistence", "Refresh did not restore text draft");
    } catch (error) {
      const diagnosis = await browser.executeAsync(async (done) => {
        const script = document.querySelector<HTMLScriptElement>('script[type="module"]');
        let moduleError = "";
        try {
          if (script?.src) await import(script.src);
        } catch (cause) {
          moduleError = String(cause);
        }
        done({
          body: document.body.innerText,
          moduleError,
          url: location.href,
          storage: Object.entries(localStorage).filter(([key]) => key.includes("composer-")),
        });
      });
      await mkdir(EVIDENCE_DIR, { recursive: true });
      await writeFile(
        join(EVIDENCE_DIR, "refresh-failure.json"),
        JSON.stringify(diagnosis, null, 2),
      );
      throw error;
    }
    await expectMode("yolo");
    await setV4ComposerText(" ");
    await browser.waitUntil(
      async () => !(await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, null)).exists,
    );
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await expectMode("build");
    await switchV4Mode("yolo");
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await expectMode("build");
    expect((await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, null)).exists).toBe(false);
    await captureState("00-text-only-draft");
  });

  it("I74/I75: 完全访问首发后 New Task 保留权限，已有草稿与 Session 选择仍各自独立", async () => {
    await rm(CASE_DIR, { recursive: true, force: true });
    await mkdir(CASE_DIR, { recursive: true });
    await skipOccupationOnboardingIfPresent();
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });
    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL, "");
    await expectMode("build");
    await switchV4Mode("yolo");
    await expectMode("yolo");
    const selected = await getV4ModelConfig();
    await sendV4PromptAndWaitAccepted(
      "E2E_COMPOSER_RECENT_MODE_SEED 请回复测试标记。",
      "E2E_COMPOSER_RECENT_MODE_SEED",
      "第一次输入未被接纳",
    );
    await waitForV4TimelineContaining("RECENT_MODE_STREAMING");
    const firstSession = (await getV4PaneSnapshot()).sessionId!;
    const first = await captureState("01-accepted-yolo");
    expect(first.composer.mode).toBe("yolo");
    expect(first.pane.canStop).toBe(true);

    await startDraftFromProject(DEFAULT_WORKSPACE);
    await waitForV4ComposerSelectionReady();
    const next = await captureState("02-new-task-mode");
    expect(next.composer.mode).toBe("yolo");
    expect(next.rootDraft.exists).toBe(false);
    expect(next.composer).toMatchObject({ provider: selected.provider, model: selected.model });
    await sendV4PromptAndWaitAccepted(
      `E2E_COMPOSER_RECENT_MODE_WRITE 请Write ${OUTPUT_PATH}`,
      "E2E_COMPOSER_RECENT_MODE_WRITE",
      "Input after inheriting permissions was not accepted",
    );
    await waitForV4TimelineContaining("RECENT_MODE_DONE", 60_000);
    const secondSession = (await getV4PaneSnapshot()).sessionId!;
    expect(secondSession).not.toBe(firstSession);
    expect(await readFile(join(CASE_DIR, "result.txt"), "utf8")).toBe("RECENT_MODE_WRITE_OK\n");
    expect(
      (await getLatestUpstreamToolResultByToolCallId("toolu_recent_mode_write"))?.isError,
    ).toBe(false);
    await captureState("03-inherited-mode-executed");

    await startDraftFromProject(DEFAULT_WORKSPACE);
    await expectMode("yolo");
    await selectV4TaskById(secondSession);
    await switchV4Mode("build");
    await switchV4Model(UPSTREAM_PROVIDER_ID, UPSTREAM_SECONDARY_MODEL, "");
    await sendV4PromptAndWaitAccepted(
      "E2E_COMPOSER_RECENT_MODE_SECOND 回复标记。",
      "E2E_COMPOSER_RECENT_MODE_SECOND",
      "第二次选择未被接纳",
    );
    await waitForV4TimelineContaining("RECENT_MODE_SECOND_DONE");
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await expectMode("build");
    const updated = await captureState("04-new-task-model-b");
    expect(updated.composer.model).toBe(UPSTREAM_SECONDARY_MODEL);
    expect(updated.rootDraft.exists).toBe(false);
    await switchV4Mode("yolo");
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await expectMode("build");
    await setV4ComposerText("temporary draft");
    await browser.waitUntil(
      async () =>
        (await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, null)).text === "temporary draft",
    );
    await setV4ComposerText("");
    await browser.waitUntil(
      async () => !(await getV4ComposerDraftScopeSnapshot(DEFAULT_WORKSPACE, null)).exists,
    );
    await setV4ComposerText("unsent root draft");
    await switchV4Mode("plan");
    await selectV4TaskById(firstSession);
    await expectMode("yolo");
    await setV4ComposerText("unsent session draft");
    await switchV4Mode("build");
    await selectV4TaskById(secondSession);
    await expectMode("build");
    await startDraftFromProject(DEFAULT_WORKSPACE);
    await expectMode("build");
    await $('[data-testid="v4-composer-plan-marker"]').waitForDisplayed();
    await browser.refresh();
    await expectMode("build");
    await $('[data-testid="v4-composer-plan-marker"]').waitForDisplayed();
    await selectV4TaskById(firstSession);
    await waitForV4TimelineContaining("RECENT_MODE_STREAMING");
    await expectMode("yolo");
    await waitForV4ComposerText("unsent session draft", "Text draft for formal session was not restored");
    await captureState("05-session-draft-isolation");
  });
});
