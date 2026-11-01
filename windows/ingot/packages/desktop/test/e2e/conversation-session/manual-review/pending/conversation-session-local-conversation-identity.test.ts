import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildServerRemoteWorkspaceIdentity, type RemoteTarget } from "@origin-ai/cf-shared";
import {
  TID_COMPOSER_WORK_OUTSIDE_PROJECT,
  TID_COMPOSER_WORKSPACE_TRIGGER,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_CONVERSATION_WORKSPACE,
  DEFAULT_WORKSPACE,
  clearAppData,
  waitForWorkspaceApp,
} from "#e2e/helpers/desktop-app";

const CASE_MARKER = "E2E_LOCAL_CONVERSATION_IDENTITY";
const REMOTE_IDENTITY = buildServerRemoteWorkspaceIdentity({
  serverId: "25db8db2-d27b-40de-a23e-697b3c127234",
  workspacePath: DEFAULT_WORKSPACE,
});
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/local-conversation-identity",
);

interface NavigationTab {
  id: string;
  kind: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  workspacePurpose?: string;
  remoteSessionId?: string;
}

interface NavigationWindow extends Window {
  __cfTabStoreE2E?: {
    getState(): {
      tabs: NavigationTab[];
      activeTabId: string | null;
      activeWorkspacePath: string | null;
      activeWorkspaceIdentity: string | null;
      addTab(
        path: string,
        options: { workspaceIdentity: string; remoteTarget: RemoteTarget },
      ): string;
      activateTab(id: string): void;
    };
  };
}

async function readNavigation() {
  return browser.execute(() => {
    const state = (window as NavigationWindow).__cfTabStoreE2E?.getState();
    if (!state) throw new Error("导航 store 未就绪");
    return {
      activeTabId: state.activeTabId,
      activeWorkspacePath: state.activeWorkspacePath,
      activeWorkspaceIdentity: state.activeWorkspaceIdentity,
      tabs: state.tabs.map((tab) => ({
        id: tab.id,
        workspacePath: tab.workspacePath ?? null,
        workspaceIdentity: tab.workspaceIdentity ?? null,
        workspacePurpose: tab.workspacePurpose ?? null,
        remoteSessionId: tab.remoteSessionId ?? null,
      })),
    };
  });
}

describe(`${CASE_MARKER}: LocalProject解除Bind按CompleteWorkspace身份匹配`, () => {
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    facts.final = await readNavigation();
    await writeFile(
      resolve(artifactDir, "local-conversation-identity.json"),
      JSON.stringify(facts, null, 2),
    );
    await browser.saveScreenshot(resolve(artifactDir, "local-conversation-identity.png"));
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("RPN-12 Local project and offline remote share same path with remote first, can still work outside project", async function () {
    this.timeout(60_000);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 30_000);
    const localId = await browser.execute(
      (path, identity) => {
        const store = (window as NavigationWindow).__cfTabStoreE2E;
        const localTab = store
          ?.getState()
          .tabs.find(
            (tab) =>
              tab.kind === "workspace" && tab.workspacePath === path && !tab.workspaceIdentity,
          );
        if (!store || !localTab) throw new Error("本地项目 tab 未就绪");
        store.getState().addTab(path, {
          workspaceIdentity: identity,
          remoteTarget: { kind: "ssh", host: "offline.example.com", username: "dev", port: 22 },
        });
        store.getState().activateTab(localTab.id);
        return localTab.id;
      },
      DEFAULT_WORKSPACE,
      REMOTE_IDENTITY,
    );

    const before = await readNavigation();
    facts.before = before;
    expect(before.activeTabId).toBe(localId);
    expect(before.activeWorkspaceIdentity).toBeNull();
    expect(before.tabs[0]?.workspaceIdentity).toBe(REMOTE_IDENTITY);
    expect(before.tabs[0]?.remoteSessionId).toBeNull();
    expect(before.tabs[1]?.id).toBe(localId);

    await $(`[data-testid="${TID_COMPOSER_WORKSPACE_TRIGGER}"]`).click();
    const workOutsideProject = $(`[data-testid="${TID_COMPOSER_WORK_OUTSIDE_PROJECT}"]`);
    await workOutsideProject.waitForDisplayed({ timeout: 10_000 });
    await workOutsideProject.click();
    await browser.waitUntil(
      async () => {
        const state = await readNavigation();
        return (
          state.activeWorkspacePath === DEFAULT_CONVERSATION_WORKSPACE &&
          state.activeWorkspaceIdentity === null
        );
      },
      { timeout: 10_000, timeoutMsg: `${CASE_MARKER}: 点击后没有进入Local conversation workspace` },
    );
    await waitForWorkspaceApp(DEFAULT_CONVERSATION_WORKSPACE, 10_000);

    const after = await readNavigation();
    facts.after = after;
    expect(after.tabs.find((tab) => tab.id === after.activeTabId)?.workspacePurpose).toBe(
      "conversation",
    );
    expect(after.tabs.find((tab) => tab.id === localId)).toEqual(before.tabs[1]);
    expect(after.tabs.find((tab) => tab.workspaceIdentity === REMOTE_IDENTITY)).toEqual(
      before.tabs[0],
    );
  });
});
