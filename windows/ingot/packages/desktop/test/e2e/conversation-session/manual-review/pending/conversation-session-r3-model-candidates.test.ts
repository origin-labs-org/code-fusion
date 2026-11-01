import { startDraftFromProject } from "#e2e/helpers/project-sidebar";
import { selectTaskOrganizeMode } from "../../../helpers/workspace-agent-warmup.js";
import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "#e2e/helpers/remote-project-actions";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import {
  TID_CHAT_MODEL_SELECT_GROUP,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  TID_V4_COMPOSER_INPUT,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByDom, DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import { refreshSeededOpenAIProvidersThroughSettings } from "../../../helpers/custom-openai-provider.js";
import { seedCustomOpenAIChatCompletionsProvider } from "../../../helpers/custom-openai-provider-store.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import { readRemoteTabSnapshot, runSSHCommand } from "../../../helpers/ssh-remote-p0.js";
import { selectV4TaskById } from "../../../helpers/v4-conversation.js";
import { openWorkspaceDraftFromSidebar } from "../../../helpers/workspace-agent-warmup.js";

const CASE_MARKER = "E2E_R3_MODEL_CANDIDATES";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-model-candidates",
);
const LOCAL_ONLY_PROVIDER_ID = "e2e-r3-local-only";
const LOCAL_ONLY_LABEL = "R3 Local Only Provider";
const LOCAL_ONLY_MODEL_ID = "e2e-r3-local-only-model";

interface MenuSnapshot {
  items: string[];
  triggerDisabled: boolean;
  triggerText: string;
  bannerText: string;
}

async function readModelMenu(): Promise<MenuSnapshot> {
  const trigger = $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`);
  await trigger.waitForExist({ timeout: 30_000 });
  const base = await browser.execute((triggerId) => {
    const element = document.querySelector<HTMLButtonElement>(`[data-testid="${triggerId}"]`);
    const banner = Array.from(
      document.querySelectorAll<HTMLElement>('[role="alert"], [role="status"]'),
    )
      .filter((node) => node.getClientRects().length)
      .map((node) => (node.innerText ?? node.textContent ?? "").trim())
      .filter(Boolean)
      .join(" | ")
      .slice(0, 300);
    return {
      triggerDisabled: element?.disabled ?? true,
      triggerText: (element?.innerText ?? element?.textContent ?? "").trim(),
      bannerText: banner,
    };
  }, TID_CHAT_MODEL_SELECT_TRIGGER);
  if (base.triggerDisabled) return { items: [], ...base };
  await trigger.click();
  let items: string[] = [];
  await browser
    .waitUntil(
      async () => {
        items = await browser.execute(
          (groupPrefix, itemPrefix) =>
            Array.from(
              document.querySelectorAll<HTMLElement>(
                `[data-testid^="${groupPrefix}"], [data-testid^="${itemPrefix}"]`,
              ),
            )
              .filter((item) => item.getClientRects().length > 0)
              .map((item) => item.dataset.testid ?? ""),
          TID_CHAT_MODEL_SELECT_GROUP,
          TID_CHAT_MODEL_SELECT_ITEM,
        );
        return items.length > 0;
      },
      { timeout: 15_000, interval: 200, timeoutMsg: "menu-empty" },
    )
    .catch(() => undefined);
  await browser.keys(["Escape"]);
  await browser
    .waitUntil(
      () =>
        browser.execute(
          (groupPrefix, itemPrefix) =>
            !document.querySelector(
              `[data-testid^="${groupPrefix}"], [data-testid^="${itemPrefix}"]`,
            ),
          TID_CHAT_MODEL_SELECT_GROUP,
          TID_CHAT_MODEL_SELECT_ITEM,
        ),
      { timeout: 10_000, timeoutMsg: "menu-close" },
    )
    .catch(() => undefined);
  return { items, ...base };
}

const hasLocalOnly = (snapshot: MenuSnapshot) =>
  snapshot.items.some((item) => item.includes(LOCAL_ONLY_PROVIDER_ID));

describe(`${CASE_MARKER}: 远端 tab 候选读Target远端（Offline不 fallback Local machine、同步后One致）、Fast切 tab 不串、Settings页EditLocal`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "model-candidates.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-PRV-16 Add local provider while Source offline: local tab visible immediately, remote tab does not fallback; remote tab visible after reconnect sync; fast tab switching for 5 rounds without crosstalk; settings page editing is always local", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, { tunnelUsername: "tunnel" });
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId ?? "";

    const disconnectSource = async () => {
      await selectTaskOrganizeMode(["项目", "Project"]);
      await disconnectRemoteSource(sourceId!, CASE_MARKER, {
        workspaceIdentities: [taskA.identity],
      });
    };
    const reconnectSource = async () => {
      await selectTaskOrganizeMode(["项目", "Project"]);
      await reconnectRemoteProject(taskA.identity, CASE_MARKER);
      await browser.waitUntil(
        async () =>
          Boolean((await readRemoteTabSnapshot(taskA.identity).catch(() => null))?.remoteSessionId),
        { timeout: 120_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: Reconnect没有恢复` },
      );
    };
    const openRemoteDraft = async () => {
      const remote = await readRemoteTabSnapshot(taskA.identity);
      const online = Boolean(remote.remoteSessionId);
      if (online) {
        await selectV4TaskById(taskA.taskId, 30_000);
        await startDraftFromProject(workspaceA, { workspaceIdentity: taskA.identity });
      } else {
        const activated = await browser.execute((identity) => {
          const store = (
            window as Window & {
              __cfTabStoreE2E?: {
                getState(): {
                  tabs: Array<{ id: string; workspaceIdentity?: string }>;
                  activateTab(id: string): void;
                };
              };
            }
          ).__cfTabStoreE2E;
          const state = store?.getState();
          const tab = state?.tabs.find((item) => item.workspaceIdentity === identity);
          if (!tab) return false;
          state!.activateTab(tab.id);
          return true;
        }, taskA.identity);
        if (!activated) throw new Error(`${CASE_MARKER}: 远端 tab 不存在，无法激活`);
        await browser.executeAsync((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        );
      }
      const active = await readRemoteTabSnapshot();
      if (active.activeWorkspaceIdentity !== taskA.identity) {
        throw new Error(`${CASE_MARKER}: 远端Target归属Error: ${active.activeWorkspaceIdentity}`);
      }
      return online;
    };
    const readOfflineModelSurface = async (): Promise<MenuSnapshot> => {
      const active = await readRemoteTabSnapshot();
      expect(active.activeWorkspaceIdentity).toBe(taskA.identity);
      expect(active.remoteSessionId).toBeNull();
      if (await $(`[data-testid="${TID_CHAT_MODEL_SELECT_TRIGGER}"]`).isExisting()) {
        return readModelMenu();
      }
      const surface = await browser.execute(
        (identity, composerId, groupId, itemId) => {
          const row = Array.from(
            document.querySelectorAll<HTMLElement>("[data-project-workspace-identity]"),
          ).find((node) => node.dataset.projectWorkspaceIdentity === identity);
          const visible = (node: HTMLElement) => node.getClientRects().length > 0;
          return {
            offlineRowText: row && visible(row) ? row.innerText.replace(/\s+/gu, " ") : "",
            composerPresent: Array.from(
              document.querySelectorAll<HTMLElement>(`[data-testid="${composerId}"]`),
            ).some(visible),
            items: Array.from(
              document.querySelectorAll<HTMLElement>(
                `[data-testid^="${groupId}"], [data-testid^="${itemId}"]`,
              ),
            )
              .filter(visible)
              .map((node) => node.dataset.testid ?? ""),
          };
        },
        taskA.identity,
        TID_V4_COMPOSER_INPUT,
        TID_CHAT_MODEL_SELECT_GROUP,
        TID_CHAT_MODEL_SELECT_ITEM,
      );
      expect(surface.offlineRowText).toMatch(
        /Offline|Connection failed|Disconnected|Disconnected|Connection failed/iu,
      );
      expect(surface.composerPresent).toBe(false);
      facts.lastOfflineSurface = { ...surface, identity: taskA.identity, triggerPresent: false };
      return {
        items: surface.items,
        triggerDisabled: true,
        triggerText: "",
        bannerText: surface.offlineRowText,
      };
    };
    
    const readRemoteMenuSettled = async (): Promise<MenuSnapshot & { settleMs: number }> => {
      const startedAt = Date.now();
      let snapshot = await readModelMenu();
      const deadline = startedAt + 60_000;
      while (snapshot.items.length === 0 && Date.now() < deadline) {
        await browser.pause(3_000);
        snapshot = await readModelMenu();
      }
      return { ...snapshot, settleMs: Date.now() - startedAt };
    };
    const openLocalDraft = async () => {
      await openWorkspaceDraftFromSidebar(DEFAULT_WORKSPACE);
    };

    await openRemoteDraft();
    const remoteBaseline = await readRemoteMenuSettled();
    await openLocalDraft();
    const localBaseline = await readModelMenu();
    facts.baseline = { remote: remoteBaseline, local: localBaseline.items };
    expect(remoteBaseline.items.length).toBeGreaterThan(0);
    expect(hasLocalOnly(remoteBaseline)).toBe(false);
    expect(hasLocalOnly(localBaseline)).toBe(false);

    await disconnectSource();
    await seedCustomOpenAIChatCompletionsProvider({
      modelId: LOCAL_ONLY_MODEL_ID,
      providerId: LOCAL_ONLY_PROVIDER_ID,
      providerName: LOCAL_ONLY_LABEL,
    });
    await refreshSeededOpenAIProvidersThroughSettings([LOCAL_ONLY_LABEL]);
    await openLocalDraft();
    const localOffline = await readModelMenu();
    facts.offlineLocal = localOffline;
    expect(hasLocalOnly(localOffline)).toBe(true);

    const offlineDraftReady = await openRemoteDraft();
    const remoteOffline: MenuSnapshot = offlineDraftReady
      ? await readRemoteMenuSettled()
      : await readOfflineModelSurface();
    facts.offlineRemote = { ...remoteOffline, draftPaneAvailable: offlineDraftReady };
    expect(hasLocalOnly(remoteOffline)).toBe(false);
    const remoteConfigOffline = await runSSHCommand(
      prepared.config,
      `grep -c "${LOCAL_ONLY_PROVIDER_ID}" "$HOME/.cf/v2/provider_config.json" || true`,
    );
    const remoteConfigHasLocalOnlyWhileOffline =
      Number.parseInt(remoteConfigOffline.stdout.trim() || "0", 10) > 0;
    facts.remoteConfigHasLocalOnlyWhileOffline = remoteConfigHasLocalOnlyWhileOffline;
    expect(remoteConfigHasLocalOnlyWhileOffline).toBe(false);

    const offlineRounds: Array<{
      local: boolean;
      remote: boolean;
      remoteTriggerDisabled: boolean;
      remoteDraft: boolean;
    }> = [];
    const offlineSwitchStartedAt = Date.now();
    for (let round = 0; round < 5; round += 1) {
      await openLocalDraft();
      const l = await readModelMenu();
      const remoteDraft = await openRemoteDraft();
      const r: MenuSnapshot = remoteDraft
        ? await readRemoteMenuSettled()
        : await readOfflineModelSurface();
      offlineRounds.push({
        local: hasLocalOnly(l),
        remote: hasLocalOnly(r),
        remoteTriggerDisabled: r.triggerDisabled,
        remoteDraft,
      });
    }
    facts.offlineQuickSwitch = offlineRounds;
    facts.offlineSwitchDurationMs = Date.now() - offlineSwitchStartedAt;
    expect(offlineRounds.every((round) => round.local && !round.remote)).toBe(true);

    await reconnectSource();
    await browser.waitUntil(
      async () => {
        const result = await runSSHCommand(
          prepared.config,
          `grep -c "${LOCAL_ONLY_PROVIDER_ID}" "$HOME/.cf/v2/provider_config.json" || true`,
        );
        return Number.parseInt(result.stdout.trim() || "0", 10) > 0;
      },
      {
        timeout: 90_000,
        interval: 2000,
        timeoutMsg: `${CASE_MARKER}: Reconnect后远端Configuration没有同步到 local-only provider`,
      },
    );
    let remoteAfterSync: MenuSnapshot = {
      items: [],
      triggerDisabled: true,
      triggerText: "",
      bannerText: "",
    };
    await openRemoteDraft();
    const remoteSeesSynced = await browser
      .waitUntil(
        async () => {
          remoteAfterSync = await readModelMenu();
          return hasLocalOnly(remoteAfterSync);
        },
        { timeout: 90_000, interval: 5_000, timeoutMsg: "remote-sync-visible" },
      )
      .then(() => true)
      .catch(() => false);
    facts.afterReconnect = {
      remote: remoteAfterSync.items,
      remoteSeesSyncedProvider: remoteSeesSynced,
    };
    expect(remoteSeesSynced).toBe(true);
    const onlineRounds: Array<{ local: boolean; remote: boolean }> = [];
    for (let round = 0; round < 5; round += 1) {
      await openLocalDraft();
      const l = await readModelMenu();
      await openRemoteDraft();
      const r = await readRemoteMenuSettled();
      onlineRounds.push({ local: hasLocalOnly(l), remote: hasLocalOnly(r) });
    }
    facts.onlineQuickSwitch = onlineRounds;
    expect(onlineRounds.every((round) => round.local)).toBe(true);
    expect(onlineRounds.every((round) => round.remote === remoteSeesSynced)).toBe(true);

    await openRemoteDraft();
    await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: No entry point set.`,
    });
    await $(`[data-testid="${TID_SETTINGS_PAGE}"]`).waitForDisplayed({ timeout: 15_000 });
    await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page lacks the model provider section`,
    });
    await browser.pause(1_500);
    const settingsText = await browser.execute(() => document.body?.innerText ?? "");
    facts.settings = {
      showsLocalOnly: settingsText.includes(LOCAL_ONLY_LABEL),
      showsLifecycle: settingsText.includes(provider.name),
    };
    expect(settingsText).toContain(LOCAL_ONLY_LABEL);
    expect(settingsText).toContain(provider.name);
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Settings page back button did not appear`,
    });
    expect(remoteSeesSynced).toBe(true);
  });
});
