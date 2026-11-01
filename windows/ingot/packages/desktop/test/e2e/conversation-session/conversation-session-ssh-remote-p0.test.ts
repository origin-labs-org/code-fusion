import { releaseControlledReplay } from "#e2e/helpers/controlled-replay";
import { parseRemoteWorkspaceIdentity } from "@origin-ai/cf-shared";
import { clearAppData, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import {
  refreshSeededOpenAIProvidersThroughSettings,
  seedCustomOpenAIChatCompletionsProvider,
} from "../helpers/custom-openai-provider.js";
import { resolveSeededReplayBaseUrl } from "../helpers/custom-openai-provider-store.js";
import {
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "../helpers/upstream-provider.js";
import {
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "../helpers/conversation-session-network.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../helpers/v4-conversation.js";
import {
  beginConversationTelemetryCapture,
  waitForConversationReportInventory,
} from "../helpers/conversation-telemetry-parity-capture.js";
import {
  clickLastEnabledSSHDialogButton,
  createSSHReplayTunnel,
  readHostProcesses,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  openSSHSourceDirectory,
  runSSHCommand,
  selectSSHRemoteDirectory,
  waitForSSHDirectoryStep,
} from "../helpers/ssh-remote-p0.js";
import { readProjectTaskRowState, type ProjectTaskRowState } from "../helpers/project-sidebar.js";

const CASE_MARKER = "R1_SSH_P0_01";
const PROMPT_MARKER = "E2E_SSH_REMOTE_P0";
const MODEL_ID = "e2e-ssh-remote-p0-model";
const WORKSPACE_READY_TIMEOUT_MS = 2 * 60_000;
const TURN_TIMEOUT_MS = 2 * 60_000;

interface SSHRuntimeConfig {
  host: string;
  password: string;
  port: number;
  username: string;
  workspacePaths: readonly [string, string];
}

interface RemoteTabSnapshot {
  activeWorkspaceIdentity: string | null;
  activeWorkspacePath: string | null;
  remoteHost: string | null;
  remoteKind: string | null;
  remoteSessionId: string | null;
  secretPersistedInTab: boolean;
  workspaceIdentity: string | null;
  workspacePath: string | null;
}

interface ReplayTunnel {
  baseURL: string;
  close(): Promise<void>;
}

interface TaskCase {
  firstPrompt: string;
  firstReply: string;
  followPrompt: string;
  followReply: string;
  identity: string;
  label: "A" | "B";
  remoteSessionId: string;
  taskId: string;
  workspacePath: string;
}

const runningRowMismatches: Array<{
  taskId: string;
  label: string;
  observed: ProjectTaskRowState;
}> = [];

describe(`${CASE_MARKER}: SSH remote workspace P0`, () => {
  let replayTunnel: ReplayTunnel | null = null;

  after(async () => {
    await replayTunnel?.close();
    replayTunnel = null;
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("R1-SSH-P0-01 Send initial message in each SSH workspace, then switch back to task to continue", async function () {
    this.timeout(20 * 60_000);
    runningRowMismatches.length = 0;
    const config = readSSHRuntimeConfig();
    const [workspaceA, workspaceB] = config.workspacePaths;

    await prepareV4ConversationE2E({ skipProvider: true });
    const initialHosts = await readHostProcesses();
    expect(initialHosts).toHaveLength(1);
    const telemetryCapture = await beginConversationTelemetryCapture();

    replayTunnel = await createReplayTunnel(config);
    const previousReplayBaseURL = process.env.E2E_PROVIDER_RUNTIME_BASE_URL;
    let provider: { id: string; name: string };
    process.env.E2E_PROVIDER_RUNTIME_BASE_URL = replayTunnel.baseURL;
    try {
      provider = await seedCustomOpenAIChatCompletionsProvider({
        modelId: MODEL_ID,
        providerId: "e2e-ssh-remote-p0-provider",
        providerName: "SSH Remote P0",
      });
      await refreshSeededOpenAIProvidersThroughSettings([provider.name]);
    } finally {
      if (previousReplayBaseURL === undefined) {
        delete process.env.E2E_PROVIDER_RUNTIME_BASE_URL;
      } else {
        process.env.E2E_PROVIDER_RUNTIME_BASE_URL = previousReplayBaseURL;
      }
    }

    const provisioningRecordsBeforeConnect = await readProvisioningRecordCount(config);

    const taskA = await connectWorkspaceAndSendFirstTurn({
      config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const provisioningRecordsAfterFirstWorkspace = await waitForProvisioningRecordCountGreaterThan(
      config,
      provisioningRecordsBeforeConnect,
    );
    const taskB = await connectWorkspaceAndSendFirstTurn({
      config,
      label: "B",
      provider,
      workspacePath: workspaceB,
    });

    expect(await readProvisioningRecordCount(config)).toBe(provisioningRecordsAfterFirstWorkspace);

    expect(taskA.remoteSessionId).not.toBe(taskB.remoteSessionId);
    expect(await readHostProcesses()).toEqual(initialHosts);

    await switchTaskAndSendFollowTurn(taskA, taskB.firstPrompt);
    await switchTaskAndSendFollowTurn(taskB, taskA.firstPrompt);

    await assertTaskRow(taskA, { active: false, running: false });
    await assertTaskRow(taskB, { active: true, running: false });
    expect(await readHostProcesses()).toEqual(initialHosts);

    const reports = await waitForConversationReportInventory(telemetryCapture, {
      agent_step: 4,
      message_completion: 4,
    });
    for (const task of [taskA, taskB]) {
      const taskReports = reports.filter((report) => report.talk_id === task.taskId);
      expect(taskReports.filter((report) => report.element_name === "agent_step")).toHaveLength(2);
      expect(
        taskReports.filter((report) => report.element_name === "message_completion"),
      ).toHaveLength(2);
      for (const report of taskReports.filter(
        (candidate) =>
          candidate.element_name === "agent_step" ||
          candidate.element_name === "message_completion",
      )) {
        expect(report.event_extra_detail).toMatchObject({
          workspace_kind: "remote",
          remote_kind: "server",
        });
      }
    }
    process.stdout.write(
      `[${CASE_MARKER}] telemetry ${JSON.stringify(
        [taskA, taskB].map((task) => {
          const taskReports = reports.filter((report) => report.talk_id === task.taskId);
          return {
            agentStepCount: taskReports.filter((report) => report.element_name === "agent_step")
              .length,
            completionCount: taskReports.filter(
              (report) => report.element_name === "message_completion",
            ).length,
            taskId: task.taskId,
          };
        }),
      )}\n`,
    );
    expect(runningRowMismatches).toEqual([]);
  });
});

async function readProvisioningRecordCount(config: SSHRuntimeConfig): Promise<number> {
  const result = await runSSHCommand(
    config,
    'if [ -f "$HOME/.cf/v2/runtime/provider/provisioning.json" ]; then cat "$HOME/.cf/v2/runtime/provider/provisioning.json"; else printf \'{"records":[]}\'; fi',
  );
  if (result.code !== 0) {
    throw new Error(`${CASE_MARKER}: Read远端 Provisioning StatusFailed：${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as { records?: unknown };
  if (!Array.isArray(parsed.records)) {
    throw new Error(`${CASE_MARKER}: 远端 Provisioning StatusMissing records`);
  }
  return parsed.records.length;
}

async function waitForProvisioningRecordCountGreaterThan(
  config: SSHRuntimeConfig,
  baseline: number,
): Promise<number> {
  let observed = baseline;
  await browser.waitUntil(
    async () => {
      observed = await readProvisioningRecordCount(config);
      return observed > baseline;
    },
    {
      timeout: 30_000,
      interval: 500,
      timeoutMsg: `${CASE_MARKER}: 首个远端 Workspace 没有Completed Provisioning`,
    },
  );
  return observed;
}

function readSSHRuntimeConfig(): SSHRuntimeConfig {
  const host = requireSecretEnv("CF_E2E_SSH_HOST");
  const username = requireSecretEnv("CF_E2E_SSH_USERNAME");
  const password = requireSecretEnv("CF_E2E_SSH_PASSWORD");
  const portText = process.env.CF_E2E_SSH_PORT?.trim() || "22";
  const port = Number.parseInt(portText, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${CASE_MARKER}: CF_E2E_SSH_PORT 必须Yes 1..65535 的整Count`);
  }

  const workspacePaths = (
    process.env.CF_E2E_SSH_WORKSPACE_PATHS?.split(",") ?? ["/root", "/home"]
  )
    .map((value) => value.trim())
    .filter(Boolean);
  if (
    workspacePaths.length !== 2 ||
    workspacePaths.some((value) => !value.startsWith("/")) ||
    workspacePaths[0] === workspacePaths[1]
  ) {
    throw new Error(`${CASE_MARKER}: CF_E2E_SSH_WORKSPACE_PATHS 必须Yes两个不同的绝对路径`);
  }

  return {
    host,
    password,
    port,
    username,
    workspacePaths: [workspacePaths[0]!, workspacePaths[1]!],
  };
}

function requireSecretEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${CASE_MARKER}: Missing ${name}`);
  }
  return value;
}

async function connectWorkspaceAndSendFirstTurn(options: {
  config: SSHRuntimeConfig;
  label: "A" | "B";
  provider: { id: string; name: string };
  workspacePath: string;
}): Promise<TaskCase> {
  await openSSHRemoteDialog(CASE_MARKER);
  await fillSSHPasswordSettings(options.config);
  await clickLastEnabledSSHDialogButton(CASE_MARKER);
  const flow = await waitForSSHDirectoryStep(CASE_MARKER);
  if (flow === "closed") {
    await openSSHSourceDirectory(options.config, CASE_MARKER);
  }
  await selectSSHRemoteDirectory(options.workspacePath, CASE_MARKER);
  await waitForWorkspaceApp(options.workspacePath, WORKSPACE_READY_TIMEOUT_MS);
  const tab = await waitForRemoteTab({
    expectedPath: options.workspacePath,
  });
  expect(tab.remoteKind).toBe("ssh");
  expect(tab.remoteHost).toBe(options.config.host);
  expect(tab.secretPersistedInTab).toBe(false);
  if (!tab.remoteSessionId) {
    throw new Error(`${CASE_MARKER}: workspace ${options.label} Missing remoteSessionId`);
  }
  if (!tab.workspaceIdentity) {
    throw new Error(`${CASE_MARKER}: workspace ${options.label} Missing稳定 workspaceIdentity`);
  }

  await selectUpstreamProviderModelById(MODEL_ID, {
    includePlainModelFallback: false,
    providerId: options.provider.id,
    providerName: options.provider.name,
  });
  await selectUpstreamThoughtLevelValue("disabled");
  const draft = await readRemoteTabSnapshot(tab.workspaceIdentity, options.workspacePath);
  expect(draft.activeWorkspaceIdentity).toBe(tab.workspaceIdentity);
  expect(draft.activeWorkspacePath).toBe(options.workspacePath);

  const firstPrompt = `${PROMPT_MARKER}_${options.label}_FIRST_PROMPT`;
  const firstReply = `${PROMPT_MARKER}_${options.label}_FIRST_REPLY`;
  const followPrompt = `${PROMPT_MARKER}_${options.label}_FOLLOW_PROMPT`;
  const followReply = `${PROMPT_MARKER}_${options.label}_FOLLOW_REPLY`;
  const requestStart = await getUpstreamRequestRecordCount();
  await sendV4PromptAndWaitAccepted(
    `${firstPrompt}: 只Reply ${firstReply}`,
    firstPrompt,
    `${options.label} Initial turn没有进入远端 task`,
  );
  const running = await waitForV4ConversationState(
    (snapshot) =>
      Boolean(snapshot.taskId && snapshot.taskId !== "draft") && snapshot.state === "streaming",
    `${options.label} Initial turn没有进入 running`,
    TURN_TIMEOUT_MS,
  );
  if (!running.taskId) {
    throw new Error(`${CASE_MARKER}: workspace ${options.label} Initial turn没有 taskId`);
  }
  const task: TaskCase = {
    firstPrompt,
    firstReply,
    followPrompt,
    followReply,
    identity: tab.workspaceIdentity,
    label: options.label,
    remoteSessionId: tab.remoteSessionId,
    taskId: running.taskId,
    workspacePath: options.workspacePath,
  };
  await assertTaskRow(task, { active: true, running: true });
  await releaseControlledReplay(`ssh-remote-p0-${task.label.toLowerCase()}-first`);
  await waitForUpstreamRequest(
    {
      lastUserMessageIncludes: [firstPrompt],
    },
    `${options.label} Initial turnRequest没有到达 provider`,
    TURN_TIMEOUT_MS,
    { afterIndex: requestStart - 1 },
  );
  await waitForV4AssistantMessageContaining(firstReply, TURN_TIMEOUT_MS);
  await waitForV4ConversationState(
    (snapshot) =>
      snapshot.taskId === task.taskId && snapshot.state === "idle" && snapshot.queueCount === 0,
    `${options.label} Initial turnCompleted后没有回到 idle`,
    TURN_TIMEOUT_MS,
  );
  await assertTaskRow(task, { active: true, running: false });
  return task;
}

async function switchTaskAndSendFollowTurn(
  task: TaskCase,
  foreignFirstPrompt: string,
): Promise<void> {
  await selectV4TaskById(task.taskId, 30_000);
  await waitForRemoteTab({
    expectedIdentity: task.identity,
    expectedPath: task.workspacePath,
    expectedRemoteSessionId: task.remoteSessionId,
  });
  await assertTaskRow(task, { active: true, running: false });
  const requestStart = await getUpstreamRequestRecordCount();
  await sendV4PromptAndWaitAccepted(
    `${task.followPrompt}: 只Reply ${task.followReply}`,
    task.followPrompt,
    `${task.label} 续发没有进入原 task`,
  );
  await assertTaskRow(task, { active: true, running: true });
  await releaseControlledReplay(`ssh-remote-p0-${task.label.toLowerCase()}-follow`);
  await waitForUpstreamRequest(
    {
      excludes: [foreignFirstPrompt],
      includes: [task.firstPrompt],
      lastUserMessageIncludes: [task.followPrompt],
    },
    `${task.label} 续发Request没有携带本 task 历史，or混入另One workspace`,
    TURN_TIMEOUT_MS,
    { afterIndex: requestStart - 1 },
  );
  await waitForV4AssistantMessageContaining(task.followReply, TURN_TIMEOUT_MS);
  await waitForV4ConversationState(
    (snapshot) =>
      snapshot.taskId === task.taskId && snapshot.state === "idle" && snapshot.queueCount === 0,
    `${task.label} 续发Completed后没有回到 idle`,
    TURN_TIMEOUT_MS,
  );
  await assertTaskRow(task, { active: true, running: false });
}

async function assertTaskRow(
  task: TaskCase,
  expected: { active: boolean; running: boolean },
): Promise<void> {
  let latest: ProjectTaskRowState | null = null;
  await browser
    .waitUntil(
      async () => {
        latest = await readProjectTaskRowState(task.taskId, task.workspacePath);
        return (
          latest.exists &&
          latest.inProject &&
          latest.active === expected.active &&
          latest.running === expected.running &&
          !latest.error
        );
      },
      {
        timeout: 30_000,
        interval: 100,
        timeoutMsg: `${CASE_MARKER}: task ${task.label} listStatus不正确`,
      },
    )
    .catch((cause: unknown) => {
      if (
        expected.running &&
        latest?.exists &&
        latest.inProject &&
        latest.active === expected.active &&
        !latest.error &&
        !latest.running
      ) {
        runningRowMismatches.push({ taskId: task.taskId, label: task.label, observed: latest });
        process.stdout.write(
          `[${CASE_MARKER}] running-row-mismatch ${JSON.stringify(runningRowMismatches.at(-1))}\n`,
        );
        return;
      }
      throw new Error(
        `${CASE_MARKER}: task ${task.label} listStatus不正确 expected=${JSON.stringify(expected)} latest=${JSON.stringify(latest)}`,
        { cause },
      );
    });
}

async function createReplayTunnel(config: SSHRuntimeConfig): Promise<ReplayTunnel> {
  return createSSHReplayTunnel(config, CASE_MARKER);
}

async function waitForRemoteTab(options: {
  expectedIdentity?: string;
  expectedPath: string;
  expectedRemoteSessionId?: string | null;
  timeoutMs?: number;
}): Promise<RemoteTabSnapshot> {
  let snapshot: RemoteTabSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        try {
          snapshot = await readRemoteTabSnapshot(options.expectedIdentity, options.expectedPath);
          const parsedIdentity = snapshot.workspaceIdentity
            ? parseRemoteWorkspaceIdentity(snapshot.workspaceIdentity)
            : null;
          const expectedIdentityMatches = options.expectedIdentity
            ? snapshot.workspaceIdentity === options.expectedIdentity
            : parsedIdentity?.kind === "server" &&
              parsedIdentity.workspacePath === options.expectedPath;
          return (
            snapshot.workspacePath === options.expectedPath &&
            snapshot.activeWorkspacePath === options.expectedPath &&
            expectedIdentityMatches &&
            snapshot.activeWorkspaceIdentity === snapshot.workspaceIdentity &&
            Boolean(snapshot.remoteSessionId) &&
            (!options.expectedRemoteSessionId ||
              snapshot.remoteSessionId === options.expectedRemoteSessionId)
          );
        } catch {
          return false;
        }
      },
      {
        timeout: options.timeoutMs ?? WORKSPACE_READY_TIMEOUT_MS,
        interval: 1_000,
        timeoutMsg: `${CASE_MARKER}: remote tab identity/session 没有收敛`,
      },
    );
  } catch (error) {
    throw new Error(
      `${CASE_MARKER}: remote tab identity/session 没有收敛，latest=${JSON.stringify(snapshot)}`,
      { cause: error },
    );
  }
  if (!snapshot) throw new Error(`${CASE_MARKER}: remote tab snapshot 缺失`);
  return snapshot;
}

function readRemoteTabSnapshot(
  expectedIdentity?: string,
  expectedPath?: string,
): Promise<RemoteTabSnapshot> {
  return browser.execute(
    (identity, workspacePath) => {
      type RemoteTab = {
        id: string;
        kind: string;
        remoteSessionId?: string;
        remoteTarget?: Record<string, unknown>;
        workspaceIdentity?: string;
        workspacePath?: string;
      };
      const store = (
        window as Window & {
          __cfTabStoreE2E?: {
            getState?: () => {
              activeTabId?: string | null;
              activeWorkspaceIdentity?: string | null;
              activeWorkspacePath?: string | null;
              tabs?: RemoteTab[];
            };
          };
        }
      ).__cfTabStoreE2E;
      const state = store?.getState?.();
      const matchingRemoteTab = state?.tabs?.find((tab) =>
        identity ? tab.workspaceIdentity === identity : tab.workspacePath === workspacePath,
      );
      const remoteTarget = matchingRemoteTab?.remoteTarget;
      return {
        activeWorkspaceIdentity: state?.activeWorkspaceIdentity ?? null,
        activeWorkspacePath: state?.activeWorkspacePath ?? null,
        remoteHost: typeof remoteTarget?.host === "string" ? remoteTarget.host : null,
        remoteKind: typeof remoteTarget?.kind === "string" ? remoteTarget.kind : null,
        remoteSessionId: matchingRemoteTab?.remoteSessionId ?? null,
        secretPersistedInTab: Boolean(
          remoteTarget && ("password" in remoteTarget || "privateKeyPassphrase" in remoteTarget),
        ),
        workspaceIdentity: matchingRemoteTab?.workspaceIdentity ?? null,
        workspacePath: matchingRemoteTab?.workspacePath ?? null,
      };
    },
    expectedIdentity ?? null,
    expectedPath ?? null,
  );
}
