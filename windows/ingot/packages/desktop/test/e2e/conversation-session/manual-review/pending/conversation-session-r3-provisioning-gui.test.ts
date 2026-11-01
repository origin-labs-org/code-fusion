import { startDraftFromProject } from "#e2e/helpers/project-sidebar";
import { selectTaskOrganizeMode } from "../../../helpers/workspace-agent-warmup.js";
import {
  openSSHSourceDirectory,
  waitForSSHDirectoryStep,
  selectSSHRemoteDirectory,
} from "#e2e/helpers/ssh-remote-p0";
import {
  disconnectRemoteSource,
  reconnectRemoteProject,
} from "#e2e/helpers/remote-project-actions";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseProvisioningSyncEvents,
  type ProvisioningSyncEvent,
} from "#e2e/helpers/provisioning-sync-evidence";
import { createHeldResponseProxy } from "#e2e/helpers/ssh-held-response-proxy";
import {
  parseRemoteWorkspaceIdentity,
  providerProvisioningResultSchema,
  type AppSettings,
} from "@origin-ai/cf-shared";
import {
  TID_CONFIRM_DIALOG_CONFIRM,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  getE2EAppDataPaths,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  readSettings,
} from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestEvidence,
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import { createCustomOpenAIChatCompletionsProvider } from "../../../helpers/custom-openai-provider.js";
import {
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../../../helpers/upstream-provider.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  readRemoteCoreIdentity,
  readTaskRowInProject,
  sendSSHFollowTurn,
  SSH_LIFECYCLE_MODEL_ID,
  SSH_LIFECYCLE_THOUGHT_LEVEL,
  type SSHLifecycleProvider,
  type SSHLifecycleTask,
} from "../../../helpers/ssh-remote-lifecycle.js";
import {
  getV4ModelConfig,
  selectV4TaskById,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ComposerSelectionReady,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";
import {
  readHostProcesses,
  readRemoteTabSnapshot,
  runSSHCommand,
  waitForRemoteTab,
  type SSHConnectionConfig,
} from "../../../helpers/ssh-remote-p0.js";
import { sel } from "../../../helpers/selectors.js";

const CASE_MARKER = "E2E_R3_PROVISIONING_GUI";
const CASE_REPLY = "R3_PROVISIONING_GUI_REPLY";
const B05_THOUGHT_LEVEL = "disabled";
const artifactDir = resolve(
  process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-provisioning-gui",
);
const REMOTE_SYNC_TIMEOUT_MS = 90_000;

async function readRemotePersonalConfig(config: SSHConnectionConfig): Promise<string> {
  const result = await runSSHCommand(config, 'cat "$HOME/.cf/v2/provider_config.json"');
  return result.code === 0 ? result.stdout : "";
}

async function waitForRemotePersonalConfig(
  config: SSHConnectionConfig,
  predicate: (text: string) => boolean,
  description: string,
  timeout = REMOTE_SYNC_TIMEOUT_MS,
): Promise<string> {
  let latest = "";
  await browser.waitUntil(
    async () => {
      latest = await readRemotePersonalConfig(config);
      return predicate(latest);
    },
    {
      timeout,
      interval: 1000,
      timeoutMsg: `${CASE_MARKER}: 远端 Personal Configuration未满足: ${description}`,
    },
  );
  return latest;
}

async function openModelProviderSettings(): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000, timeoutMsg: "No settings entry" });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15_000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "modelProvider"), {
    timeout: 15_000,
    timeoutMsg: "Settings page has no model provider section",
  });
}

async function deleteProviderThroughSettings(providerName: string): Promise<void> {
  await openModelProviderSettings();
  await browser.waitUntil(
    () =>
      browser.execute((name) => {
        const nav = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (element) =>
            (element.dataset.testid ?? "").startsWith("model-provider-nav-item") &&
            element.innerText.includes(name),
        );
        if (!nav) return false;
        nav.click();
        return true;
      }, providerName),
    { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: Settings页没有 provider ${providerName}` },
  );
  await clickTestIdByWebDriver("model-provider-actions-button", {
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: provider ${providerName} 没有“More”操作菜单`,
  });
  const deleteItem = $('[role="menuitem"]:has(svg.lucide-trash-2)');
  await deleteItem.waitForDisplayed({
    timeout: 15_000,
    timeoutMsg: `${CASE_MARKER}: “More”菜单里没有Delete项`,
  });
  await deleteItem.click();
  await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM, {
    timeout: 20_000,
    timeoutMsg: `${CASE_MARKER}: Delete provider 没有出现确认`,
  });
  await browser.waitUntil(
    () =>
      browser.execute(
        (name) =>
          !Array.from(
            document.querySelectorAll<HTMLElement>('[data-testid^="model-provider-nav-item"]'),
          ).some((element) => element.innerText.includes(name)),
        providerName,
      ),
    { timeout: 20_000, timeoutMsg: `${CASE_MARKER}: provider ${providerName} Delete后仍在Settings页` },
  );
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeout: 15_000, timeoutMsg: "No back button on settings page" });
}

async function readSyncEvents(directory: string): Promise<ProvisioningSyncEvent[]> {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".log")).sort();
  const contents = await Promise.all(files.map((name) => readFile(join(directory, name), "utf8")));
  return contents.flatMap(parseProvisioningSyncEvents);
}

async function assertManagementAvailableBeforeHold(sourceId: string): Promise<void> {
  const source = (await readSettings()).sourceServers?.find(
    (item) => item.sourceServerId === sourceId,
  );
  if (!source) throw new Error(`${CASE_MARKER}: 故障前没有已Save Source`);
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
  await $(sel(TID_SETTINGS_PAGE)).waitForDisplayed({ timeout: 15_000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "remoteDevices"), { timeout: 15_000 });
  await browser.waitUntil(
    () =>
      browser.execute((name) => {
        const page = document.querySelector('[data-testid="settings-page"]');
        const cards = [
          ...new Set(
            Array.from(page?.querySelectorAll("p") ?? [])
              .filter((element) => element.textContent?.trim() === name)
              .map((element) => element.closest("section"))
              .filter((element): element is HTMLElement => element !== null),
          ),
        ];
        return (
          cards.length === 1 &&
          Array.from(cards[0]!.querySelectorAll<HTMLButtonElement>("button")).some(
            (button) =>
              button.getClientRects().length > 0 &&
              !button.disabled &&
              ["断开", "Disconnect"].includes(button.innerText.trim()),
          )
        );
      }, source.displayName),
    { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: Health链路下DeviceManage也没有Disconnect入口` },
  );
  await mkdir(artifactDir, { recursive: true });
  await browser.saveScreenshot(resolve(artifactDir, "management-before-hold.png"));
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeout: 15_000 });
}

async function readAppliedSyncCount(config: SSHConnectionConfig): Promise<number> {
  const result = await runSSHCommand(
    config,
    'cat "$HOME/.cf/v2/runtime/provider/provisioning.json"',
  );
  expect(result.code).toBe(0);
  const journal = JSON.parse(result.stdout) as {
    records?: Array<{ syncId: string; result: unknown }>;
  };
  if (!Array.isArray(journal.records))
    throw new Error(`${CASE_MARKER}: Missing真实 Provisioning journal`);
  return journal.records.filter((record) => {
    const value = providerProvisioningResultSchema.parse(record.result);
    expect(value.syncId).toBe(record.syncId);
    return value.status === "applied";
  }).length;
}

async function assertConnectedSyncFailureRecovery(options: {
  config: SSHConnectionConfig;
  desktopTarget: SSHConnectionConfig;
  task: SSHLifecycleTask;
  sibling: { identity: string; workspacePath: string; remoteSessionId: string };
  provider: SSHLifecycleProvider;
  facts: Record<string, unknown>;
}): Promise<void> {
  const { config, desktopTarget, task, sibling, provider, facts } = options;
  const directory = await browser.electron.execute(() => process.env.CF_E2E_RUNTIME_LOG_DIR);
  if (!directory) throw new Error(`${CASE_MARKER}: Missing本次 Main LogsTable of Contents`);
  const beforeEvents = await readSyncEvents(directory);
  const keys = [...new Set(beforeEvents.map((event) => event.environmentKey))];
  expect(keys).toHaveLength(1);
  expect(beforeEvents.some((event) => event.kind === "completed")).toBe(true);
  const environmentKey = keys[0]!;
  const readNewEvents = async () =>
    (await readSyncEvents(directory))
      .slice(beforeEvents.length)
      .filter((event) => event.environmentKey === environmentKey);
  const beforeConfig = await readRemotePersonalConfig(config);
  expect(beforeConfig).toContain(provider.name);
  const core = await readRemoteCoreIdentity(config, CASE_MARKER);
  const owner = await runSSHCommand(
    config,
    `test "$(id -u)" -ne 0 && test "$(id -u)" = "$(stat -c %u /proc/${core.pid})"`,
  );
  expect(owner.code).toBe(0);
  const mode = await runSSHCommand(config, 'stat -c %a "$HOME/.cf/v2"');
  expect(mode.code).toBe(0);
  const originalMode = mode.stdout.trim();
  expect(originalMode).toMatch(/^[0-7]{3,4}$/u);
  facts.connectedSyncFaultSetup = { originalMode, corePid: core.pid, environmentKey };
  const failedName = `R3 Failed Sync ${Date.now()}`;
  let warningCount = 0;
  try {
    const denied = await runSSHCommand(
      config,
      'set -eu; d="$HOME/.cf/v2"; test ! -e "$d/.r3-write-denial-probe"; chmod 0555 "$d"; if touch "$d/.r3-write-denial-probe" 2>/dev/null; then rm "$d/.r3-write-denial-probe"; exit 74; fi; printf WRITE_DENIED',
    );
    expect(denied.code).toBe(0);
    expect(denied.stdout.trim()).toBe("WRITE_DENIED");
    facts.connectedSyncWriteDenied = true;
    await browser.execute((name) => {
      const view = window as Window & {
        __r3ProvisioningFeedback?: { observer: MutationObserver; states: string[] };
      };
      const states: string[] = [];
      const capture = () => {
        for (const element of document.querySelectorAll<HTMLElement>(
          "[data-provider-detail-feedback-state]",
        )) {
          if (!element.textContent?.includes(name)) continue;
          const state = element.dataset.providerDetailFeedbackState;
          if (state && !states.includes(state)) states.push(state);
        }
      };
      const observer = new MutationObserver(capture);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-provider-detail-feedback-state"],
        characterData: true,
      });
      view.__r3ProvisioningFeedback = { observer, states };
      capture();
    }, failedName);
    const failedProvider = await createCustomOpenAIChatCompletionsProvider({
      baseURL: provider.tunnel.baseURL,
      modelId: "r3-failed-sync-model",
      providerName: failedName,
    });
    expect(await readFile(getE2EAppDataPaths().configFile, "utf8")).toContain(failedName);
    facts.connectedSyncLocalSaveCompleted = true;
    await browser.waitUntil(
      async () =>
        (await readNewEvents()).some(
          (event) =>
            event.kind === "warning" &&
            event.trigger === "personal-config" &&
            event.status === "failed",
        ),
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: 真实Write failed后没有Structures化同步 warning` },
    );
    await browser.waitUntil(
      () =>
        browser.execute(
          () =>
            (
              window as Window & { __r3ProvisioningFeedback?: { states: string[] } }
            ).__r3ProvisioningFeedback?.states.includes("success") ?? false,
        ),
      {
        timeout: 15_000,
        timeoutMsg: `${CASE_MARKER}: 远端同步Failed时，Local machine没有To出真实Save成功Feedback`,
      },
    );
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: "Local save did not return to settings page after sync failure",
    });
    expect(await readRemotePersonalConfig(config)).toBe(beforeConfig);
    expect((await readRemoteTabSnapshot(task.identity)).remoteSessionId).toBe(task.remoteSessionId);
    expect((await readRemoteTabSnapshot(sibling.identity)).remoteSessionId).toBe(
      sibling.remoteSessionId,
    );
    const saved: Partial<AppSettings> = JSON.parse(
      await readFile(join(getE2EAppDataPaths().appDataDir, "setting.json"), "utf8"),
    );
    const savedConnections = saved.lastWorkspaceSession ?? [];
    facts.connectionPersistenceDuringFailure = savedConnections.flatMap((entry) =>
      entry.kind === "remote"
        ? [
            {
              workspacePath: entry.workspacePath,
              diskIdentity: entry.workspaceIdentity,
              lastConnectionStatus: entry.lastConnectionStatus,
            },
          ]
        : [],
    );
    for (const expected of [
      { identity: task.identity, workspacePath: task.workspacePath },
      sibling,
    ]) {
      const sourceId = parseRemoteWorkspaceIdentity(expected.identity)?.sourceServerId;
      const history = saved.sourceServerWorkspaceHistory?.find(
        (item) =>
          item.workspaceIdentity === expected.identity &&
          item.workspacePath === expected.workspacePath,
      );
      expect(sourceId).toBeTruthy();
      expect(history?.sourceServerId).toBe(sourceId);
      const entry = savedConnections.find(
        (item) =>
          item.kind === "remote" &&
          item.workspacePath === expected.workspacePath &&
          item.target.kind === "ssh" &&
          item.target.host === desktopTarget.host &&
          item.target.port === desktopTarget.port &&
          item.target.username === desktopTarget.username,
      );
      if (entry?.kind !== "remote") throw new Error(`${CASE_MARKER}: 同步Failed后Remote条目丢失`);
      expect(entry.lastConnectionStatus).toBe("connected");
    }
    let previousCount = -1;
    let lastChangeAt = Date.now();
    await browser.waitUntil(
      async () => {
        const events = await readNewEvents();
        if (events.length !== previousCount) {
          previousCount = events.length;
          lastChangeAt = Date.now();
        }
        return events.length > 0 && Date.now() - lastChangeAt >= 3_000;
      },
      {
        timeout: 30_000,
        interval: 250,
        timeoutMsg: `${CASE_MARKER}: SaveCompleted后同步FailedEvents没有收口`,
      },
    );
    const settled = await readNewEvents();
    facts.connectedSyncWarningsObserved = settled;
    expect(settled.every((event) => event.kind === "warning" && event.status === "failed")).toBe(
      true,
    );
    warningCount = settled.length;
    await browser.pause(10_000);
    expect(await readNewEvents()).toEqual(settled);
    const feedbackStates = await browser.execute(
      () =>
        (window as Window & { __r3ProvisioningFeedback?: { states: string[] } })
          .__r3ProvisioningFeedback?.states ?? [],
    );
    expect(feedbackStates).toContain("success");
    expect(feedbackStates).not.toContain("failure");
    facts.connectedSyncFailure = {
      localProviderSaved: failedProvider.id,
      warningCount,
      warnings: settled,
      remoteConfigUnchanged: true,
      originalSessionsRetained: true,
      localFeedbackStates: feedbackStates,
      noRetryObservationMs: 10_000,
    };
  } finally {
    await browser
      .execute(() => {
        const view = window as Window & {
          __r3ProvisioningFeedback?: { observer: MutationObserver };
        };
        view.__r3ProvisioningFeedback?.observer.disconnect();
        delete view.__r3ProvisioningFeedback;
      })
      .catch(() => undefined);
    const restored = await runSSHCommand(config, `chmod ${originalMode} "$HOME/.cf/v2"`);
    expect(restored.code).toBe(0);
  }

  expect(await readRemotePersonalConfig(config)).toBe(beforeConfig);
  await sendSSHFollowTurn(task, CASE_MARKER);
  expect(await readRemotePersonalConfig(config)).toBe(beforeConfig);
  facts.existingTaskWorksBeforeResave = true;
  const beforeRecoverySave = (await readSyncEvents(directory)).length;
  const repairedName = `R3 Recovered Sync ${Date.now()}`;
  await createCustomOpenAIChatCompletionsProvider({
    baseURL: provider.tunnel.baseURL,
    modelId: "r3-recovered-sync-model",
    providerName: repairedName,
  });
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "Save did not return to settings page after fix",
  });
  await waitForRemotePersonalConfig(
    config,
    (text) => text.includes(failedName) && text.includes(repairedName),
    "After fixing write permissions, newly saved payload contains latest full snapshot of previously failed edits",
  );
  await browser.waitUntil(
    async () =>
      (await readSyncEvents(directory))
        .slice(beforeRecoverySave)
        .some(
          (event) =>
            event.environmentKey === environmentKey &&
            event.kind === "completed" &&
            event.trigger === "personal-config" &&
            event.status === "applied",
        ),
    { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: 修复后再次Save没有真实同步Completed记录` },
  );
  expect((await readRemoteTabSnapshot(task.identity)).remoteSessionId).toBe(task.remoteSessionId);
  expect((await readRemoteTabSnapshot(sibling.identity)).remoteSessionId).toBe(
    sibling.remoteSessionId,
  );
  expect((await readNewEvents()).filter((event) => event.kind === "warning")).toHaveLength(
    warningCount,
  );
  await sendSSHFollowTurn(task, CASE_MARKER);
  const afterCore = await readRemoteCoreIdentity(config, CASE_MARKER);
  expect(afterCore.pid).toBe(core.pid);
  expect(afterCore.startTicks).toBe(core.startTicks);
  facts.connectedSyncRecovery = {
    bothEditsApplied: true,
    sameSessions: true,
    sameCore: true,
    nextTurnCompleted: true,
  };
}

describe(`${CASE_MARKER}: Local Provider Save/Delete/断线期间修改经 Provisioning 到达 SSH Target`, () => {
  let provider: SSHLifecycleProvider | null = null;
  let proxy: Awaited<ReturnType<typeof createHeldResponseProxy>> | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "provisioning-gui.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await proxy?.close().catch(() => undefined);
    proxy = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R3A-PRV-04/05/12/13 Real sync for save/delete, disconnects when old RPC has not returned, warns only on failure and can be recovered by saving again", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER);
    provider = prepared.provider;
    proxy = await createHeldResponseProxy(prepared.config);
    const desktopConfig = { ...prepared.config, host: "127.0.0.1", port: proxy.port };
    const [workspaceA] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: desktopConfig,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const workspaceB = prepared.config.workspacePaths[1];
    await openSSHSourceDirectory(desktopConfig, CASE_MARKER);
    await waitForSSHDirectoryStep(CASE_MARKER);
    await selectSSHRemoteDirectory(workspaceB, CASE_MARKER);
    const initialB = await waitForRemoteTab({ caseMarker: CASE_MARKER, expectedPath: workspaceB });
    const initial = await waitForRemotePersonalConfig(
      prepared.config,
      (text) => text.includes(provider!.name),
      "Contains lifecycle provider after initial connection",
    );
    facts.initialContainsSeeded = initial.includes(provider.name);

    const onlineName = `R3 Online Save ${Date.now()}`;
    const online = await createCustomOpenAIChatCompletionsProvider({
      baseURL: provider.tunnel.baseURL,
      modelId: "r3-online-model",
      providerName: onlineName,
    });
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: "No back button on settings page",
    });
    const syncedOnline = await waitForRemotePersonalConfig(
      prepared.config,
      (text) => text.includes(onlineName),
      "Online-saved provider reached remote",
    );
    facts.onlineSave = {
      providerId: online.id,
      remoteContainsLabel: syncedOnline.includes(onlineName),
    };
    expect(syncedOnline).toContain(provider.name);

    await startDraftFromProject(workspaceB, { workspaceIdentity: initialB.workspaceIdentity! });
    await selectUpstreamProviderModelById("r3-online-model", {
      includePlainModelFallback: false,
      providerId: online.id,
      providerName: onlineName,
    });
    await selectUpstreamThoughtLevelValue(B05_THOUGHT_LEVEL);
    const b05Marker = `${CASE_MARKER}_STALE_WORKER`;
    const b05Query = {
      lastUserMessageIncludes: [b05Marker],
      excludes: ["CRITICAL: Respond with TEXT ONLY"],
    };
    const b05RequestStart = await getUpstreamRequestRecordCount();
    await sendV4PromptAndWaitAccepted(
      `${b05Marker}: 只Reply ${CASE_REPLY}`,
      b05Marker,
      `${CASE_MARKER}: 存量 Agent Refresh Registry 后Initial turn没有被接受`,
    );
    await waitForUpstreamRequest(
      b05Query,
      `${CASE_MARKER}: New Provider Request没有到达回放Service`,
      120_000,
      { afterIndex: b05RequestStart - 1 },
    );
    await waitForV4AssistantMessageContaining(CASE_REPLY, 120_000);
    await waitForV4ConversationState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      `${CASE_MARKER}: B-05 回归 turn 没有回到 idle`,
      120_000,
    );
    await browser.waitUntil(
      async () => {
        const requests = await getUpstreamRequestEvidence(b05Query, {
          afterIndex: b05RequestStart - 1,
        });
        return (
          requests.length === 1 &&
          requests[0]!.status === "complete" &&
          requests[0]!.statusCode === 200
        );
      },
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: New Provider Initial turn不YesOne次Complete成功的Model request` },
    );
    const b05Requests = await getUpstreamRequestEvidence(b05Query, {
      afterIndex: b05RequestStart - 1,
    });
    expect(b05Requests).toHaveLength(1);
    expect(b05Requests[0]!.requestJson).toMatchObject({ model: "r3-online-model" });
    facts.b05ExistingAgentRefresh = {
      accepted: true,
      marker: b05Marker,
      actualRequestModel: "r3-online-model",
    };

    await readTaskRowInProject(taskA, CASE_MARKER);
    await selectV4TaskById(taskA.taskId, 30_000);
    await waitForV4ComposerSelectionReady();
    expect(await getV4ModelConfig()).toMatchObject({
      provider: provider.id,
      model: SSH_LIFECYCLE_MODEL_ID,
    });
    await assertConnectedSyncFailureRecovery({
      config: prepared.config,
      desktopTarget: desktopConfig,
      task: taskA,
      sibling: {
        identity: initialB.workspaceIdentity!,
        workspacePath: workspaceB,
        remoteSessionId: initialB.remoteSessionId!,
      },
      provider,
      facts,
    });
    const sourceId = parseRemoteWorkspaceIdentity(taskA.identity)?.sourceServerId;
    if (!sourceId) throw new Error(`${CASE_MARKER}: Missing稳定 Source 身份`);
    await assertManagementAvailableBeforeHold(sourceId);
    facts.managementAvailableBeforeHold = true;

    const logDirectory = await browser.electron.execute(
      () => process.env.CF_E2E_RUNTIME_LOG_DIR,
    );
    if (!logDirectory) throw new Error(`${CASE_MARKER}: Missing本次 Main LogsTable of Contents`);
    await browser.waitUntil(
      async () => {
        const applied = await readAppliedSyncCount(prepared.config);
        return (
          applied > 0 &&
          (await readSyncEvents(logDirectory)).filter((event) => event.status === "applied")
            .length === applied
        );
      },
      { timeout: 30_000, timeoutMsg: `${CASE_MARKER}: 既有 Provisioning RPC 未All收口` },
    );
    const beforeHeldSync = (await readSyncEvents(logDirectory)).length;
    expect(proxy.holdCurrent()).toBeGreaterThan(0);
    const holdStartedAt = Date.now();
    await deleteProviderThroughSettings(onlineName);
    const afterDelete = await waitForRemotePersonalConfig(
      prepared.config,
      (text) => !text.includes(onlineName) && text.includes(provider!.name),
      "Remote no longer contains the provider after deletion while retaining other providers",
    );
    facts.deletePropagated = !afterDelete.includes(onlineName);
    await browser.waitUntil(() => proxy!.stats().heldBytes + proxy!.stats().retiredBytes > 0, {
      timeout: 10_000,
      timeoutMsg: `${CASE_MARKER}: ConfigurationSubmitted但代理没有扣住真实回包`,
    });
    const afterHeldSync = (await readSyncEvents(logDirectory)).length;
    facts.oldSyncHoldObservation = {
      beforeMainResults: beforeHeldSync,
      afterMainResults: afterHeldSync,
      proxy: proxy.stats(),
    };
    expect(afterHeldSync).toBe(beforeHeldSync);
    expect((await readRemoteTabSnapshot(taskA.identity)).remoteSessionId).toBe(
      taskA.remoteSessionId,
    );
    facts.oldSyncHeldAfterRemoteCommit = proxy.stats();

    await selectTaskOrganizeMode(["项目", "Project"]);

    try {
      await disconnectRemoteSource(sourceId, CASE_MARKER, {
        workspaceIdentities: [taskA.identity],
      });
    } catch (error) {
      facts.manualDisconnectBlocked = {
        holdElapsedMs: Date.now() - holdStartedAt,
        savedSourceStillPresent:
          (await readSettings()).sourceServers?.some((item) => item.sourceServerId === sourceId) ??
          false,
        page: await browser.execute(() => {
          const page = document.querySelector<HTMLElement>('[data-testid="settings-page"]');
          return {
            text: page?.innerText.slice(0, 5000) ?? null,
            buttons: Array.from(page?.querySelectorAll<HTMLButtonElement>("button") ?? []).map(
              (button) => ({ text: button.innerText.trim(), disabled: button.disabled }),
            ),
          };
        }),
      };
      await mkdir(artifactDir, { recursive: true });
      await browser.saveScreenshot(resolve(artifactDir, "management-pending-rpc-failure.png"));
      throw error;
    }

    const releasedOldSync = await proxy.release();
    expect(releasedOldSync.forwardedBytes + releasedOldSync.discardedBytes).toBeGreaterThan(0);
    facts.oldSyncReleasedAfterDisconnect = releasedOldSync;
    const remoteWhileOffline = await readRemotePersonalConfig(prepared.config);
    const offlineName1 = `R3 Offline Edit One ${Date.now()}`;
    await createCustomOpenAIChatCompletionsProvider({
      baseURL: provider.tunnel.baseURL,
      modelId: "r3-offline-one",
      providerName: offlineName1,
    });
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: "No back button on settings page",
    });
    const offlineName2 = `R3 Offline Edit Two ${Date.now()}`;
    await createCustomOpenAIChatCompletionsProvider({
      baseURL: provider.tunnel.baseURL,
      modelId: "r3-offline-two",
      providerName: offlineName2,
    });
    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: "No back button on settings page",
    });
    await browser.pause(5000);
    const remoteStillOffline = await readRemotePersonalConfig(prepared.config);
    expect(remoteStillOffline).toBe(remoteWhileOffline);
    expect(remoteStillOffline).not.toContain(offlineName1);
    facts.offlineEditsNotSyncedWhileOffline = true;

    await reconnectRemoteProject(taskA.identity, CASE_MARKER);
    let reconnected: Awaited<ReturnType<typeof waitForRemoteTab>>;
    try {
      reconnected = await waitForRemoteTab({
        caseMarker: CASE_MARKER,
        expectedIdentity: taskA.identity,
        expectedPath: workspaceA,
        requireActive: false,
      });
    } catch (error) {
      facts.reconnectDiagnostic = await browser.execute(() => {
        type RemoteTab = {
          id?: string;
          remoteSessionId?: string;
          workspaceIdentity?: string;
          workspacePath?: string;
          workspacePurpose?: string;
        };
        const store = (
          window as Window & {
            __cfTabStoreE2E?: {
              getState?: () => {
                activeWorkspaceIdentity?: string | null;
                activeWorkspacePath?: string | null;
                tabs?: RemoteTab[];
              };
            };
          }
        ).__cfTabStoreE2E?.getState?.();
        return {
          tabs: (store?.tabs ?? []).map((tab) => ({
            identity: tab.workspaceIdentity ?? null,
            path: tab.workspacePath ?? null,
            purpose: tab.workspacePurpose ?? null,
            sessionId: tab.remoteSessionId ?? null,
          })),
          active: {
            identity: store?.activeWorkspaceIdentity ?? null,
            path: store?.activeWorkspacePath ?? null,
          },
        };
      });
      throw error;
    }
    expect(reconnected.remoteSessionId).not.toBe(taskA.remoteSessionId);
    const restoredB = await waitForRemoteTab({
      caseMarker: CASE_MARKER,
      expectedIdentity: initialB.workspaceIdentity!,
      expectedPath: workspaceB,
      requireActive: false,
    });
    expect(parseRemoteWorkspaceIdentity(restoredB.workspaceIdentity!)?.sourceServerId).toBe(
      sourceId,
    );
    expect(restoredB.remoteSessionId).not.toBe(initialB.remoteSessionId);
    expect(restoredB.remoteSessionId).not.toBe(reconnected.remoteSessionId);
    facts.reconnectedWorkspaceScopes = { projectA: true, projectB: true, distinctSessions: true };
    const afterReconnect = await waitForRemotePersonalConfig(
      prepared.config,
      (text) => text.includes(offlineName1) && text.includes(offlineName2),
      "Remote contains latest content of two modifications made during disconnection after reconnecting",
    );
    facts.afterReconnectHasBothOfflineEdits = true;
    expect(afterReconnect).not.toContain(onlineName);
    expect(await readHostProcesses()).toEqual(prepared.initialHosts);

    const resumed: SSHLifecycleTask = { ...taskA, remoteSessionId: reconnected.remoteSessionId! };
    await readTaskRowInProject(resumed, CASE_MARKER);
    await selectV4TaskById(resumed.taskId, 30_000);
    await waitForV4ComposerSelectionReady();
    const resumedModelConfig = await getV4ModelConfig();
    facts.resumedModelConfig = resumedModelConfig;
    expect(resumedModelConfig).toMatchObject({
      provider: provider.id,
      model: SSH_LIFECYCLE_MODEL_ID,
      thought: SSH_LIFECYCLE_THOUGHT_LEVEL,
    });
    await sendSSHFollowTurn(resumed, CASE_MARKER);
    expect(await readHostProcesses()).toEqual(prepared.initialHosts);
  });
});
