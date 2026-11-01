
import {
  clickRemoteHostConnect,
  projectSectionSelector,
  waitForProjectRowGone,
  waitForTaskRowInProject,
} from "./project-sidebar.js";
import { removeRemoteProjectEntryForRow } from "./remote-project-handoff-probe.js";
import { TID_TASK_SETTINGS_BUTTON } from "@origin-ai/cf-shared/test-ids";
import {
  waitForWorkspaceApp,
  switchToWorkspaceRendererWindow,
  waitForTestIdByDom,
} from "./desktop-app.js";
import {
  seedCustomOpenAIChatCompletionsProvider,
  refreshSeededOpenAIProvidersThroughSettings,
  seedCustomAnthropicMessagesProvider,
} from "./custom-openai-provider.js";
import {
  selectUpstreamProviderModelById,
  selectUpstreamThoughtLevelValue,
} from "./upstream-provider.js";
import {
  getUpstreamRequestEvidence,
  getUpstreamRequestRecordCount,
  waitForUpstreamRequest,
} from "./conversation-session-network.js";
import {
  prepareV4ConversationE2E,
  getV4Messages,
  selectV4TaskById,
  sendV4PromptAndWaitAccepted,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "./v4-conversation.js";
import { hasAssistantReplyForUserTurn } from "./conversation-turn-evidence.js";
import {
  clickLastEnabledSSHDialogButton,
  createSSHReplayTunnel,
  fillSSHPasswordSettings,
  openSSHRemoteDialog,
  readHostProcesses,
  readRemoteTabSnapshot,
  readSSHRuntimeConfig,
  runSSHCommand,
  selectSSHRemoteDirectory,
  ensureSSHProjectDirectoryStep,
  waitForRemoteTab,
  type ReplayTunnel,
  type SSHConnectionConfig,
  type SSHRuntimeConfig,
  SSH_WORKSPACE_READY_TIMEOUT_MS,
} from "./ssh-remote-p0.js";

export const SSH_LIFECYCLE_MODEL_ID = "e2e-ssh-remote-lifecycle-model";

export const SSH_LIFECYCLE_THOUGHT_LEVEL = "disabled";
export const SSH_LIFECYCLE_TURN_TIMEOUT_MS = 2 * 60_000;
let followTurnSequence = 0;

export interface SSHLifecycleTask {
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

export interface SSHLifecycleProvider {
  id: string;
  name: string;
  tunnel: ReplayTunnel;
}

export interface SSHLifecycleProviderOptions {
  apiType?: "openai-chat-completions" | "anthropic-messages";
  tunnelUsername?: string;
}

export async function createSSHLifecycleProvider(
  config: SSHConnectionConfig,
  caseMarker: string,
  options: SSHLifecycleProviderOptions = {},
): Promise<SSHLifecycleProvider> {
  const tunnel = await createSSHReplayTunnel(
    config,
    caseMarker,
    options.tunnelUsername ? { username: options.tunnelUsername } : {},
  );

  try {
    const provider =
      options.apiType === "anthropic-messages"
        ? await seedCustomAnthropicMessagesProvider({
            baseURL: `${tunnel.baseURL}/anthropic`,
            modelId: SSH_LIFECYCLE_MODEL_ID,
            providerId: `e2e-ssh-remote-lifecycle-${Date.now()}`,
            providerName: `SSH remote lifecycle ${Date.now()}`,
          })
        : await seedCustomOpenAIChatCompletionsProvider({
            baseURL: tunnel.baseURL,
            modelId: SSH_LIFECYCLE_MODEL_ID,
            providerId: `e2e-ssh-remote-lifecycle-${Date.now()}`,
            providerName: `SSH remote lifecycle ${Date.now()}`,
          });
    const beforeRefresh = await readRemoteTabSnapshot();
    await refreshSeededOpenAIProvidersThroughSettings([provider.name], {
      workspacePath: beforeRefresh.activeWorkspacePath,
    });
    return { ...provider, tunnel };
  } catch (error) {
    await tunnel.close();
    throw error;
  }
}

export async function connectSSHWorkspaceAndSendFirstTurn(options: {
  caseMarker: string;
  config: SSHConnectionConfig;
  provider: SSHLifecycleProvider;
  label: "A" | "B";
  workspacePath: string;
}): Promise<SSHLifecycleTask> {
  await openSSHRemoteDialog(options.caseMarker);
  await fillSSHPasswordSettings(options.config);
  await clickLastEnabledSSHDialogButton(options.caseMarker);
  await ensureSSHProjectDirectoryStep(options.config, options.caseMarker);
  await selectSSHRemoteDirectory(options.workspacePath, options.caseMarker);
  await waitForWorkspaceApp(options.workspacePath, SSH_WORKSPACE_READY_TIMEOUT_MS);

  const tab = await waitForRemoteTab({
    caseMarker: options.caseMarker,
    expectedPath: options.workspacePath,
  });
  expect(tab.remoteKind).toBe("ssh");
  expect(tab.remoteHost).toBe(options.config.host);
  expect(tab.secretPersistedInTab).toBe(false);
  if (!tab.remoteSessionId) {
    throw new Error(`${options.caseMarker}: workspace ${options.label} Missing remoteSessionId`);
  }
  if (!tab.workspaceIdentity) {
    throw new Error(`${options.caseMarker}: workspace ${options.label} Missing稳定 workspaceIdentity`);
  }

  await selectUpstreamProviderModelById(SSH_LIFECYCLE_MODEL_ID, {
    includePlainModelFallback: false,
    providerId: options.provider.id,
    providerName: options.provider.name,
  });
  await selectUpstreamThoughtLevelValue(SSH_LIFECYCLE_THOUGHT_LEVEL);
  const draft = await readRemoteTabSnapshot(tab.workspaceIdentity, options.workspacePath);
  expect(draft.activeWorkspaceIdentity).toBe(tab.workspaceIdentity);
  expect(draft.activeWorkspacePath).toBe(options.workspacePath);

  const marker = options.caseMarker.startsWith("E2E_")
    ? `${options.caseMarker}_${options.label}`
    : `E2E_${options.caseMarker}_${options.label}`;
  const replyMarker = options.caseMarker.startsWith("E2E_")
    ? options.caseMarker.slice("E2E_".length)
    : options.caseMarker;
  const task = {
    firstPrompt: `${marker}_FIRST_PROMPT`,
    firstReply: `${replyMarker}_REPLY`,
    followPrompt: `${marker}_FOLLOW_PROMPT`,
    followReply: `${replyMarker}_REPLY`,
  };
  const requestStart = await getUpstreamRequestRecordCount();
  await sendV4PromptAndWaitAccepted(
    `${task.firstPrompt}: 只Reply ${task.firstReply}`,
    task.firstPrompt,
    `${options.caseMarker}: workspace ${options.label} Initial turn没有被接受`,
  );
  const running = await waitForV4ConversationState(
    (snapshot) => Boolean(snapshot.taskId && snapshot.taskId !== "draft"),
    `${options.caseMarker}: workspace ${options.label} Initial turn没有建立Session`,
    SSH_LIFECYCLE_TURN_TIMEOUT_MS,
  );
  if (!running.taskId) {
    throw new Error(`${options.caseMarker}: workspace ${options.label} Initial turn没有 taskId`);
  }

  await waitForUpstreamRequest(
    { lastUserMessageIncludes: [task.firstPrompt] },
    `${options.caseMarker}: workspace ${options.label} Initial turn没有到达 provider`,
    SSH_LIFECYCLE_TURN_TIMEOUT_MS,
    { afterIndex: requestStart - 1 },
  );
  await waitForV4AssistantMessageContaining(task.firstReply, SSH_LIFECYCLE_TURN_TIMEOUT_MS);
  await waitForV4ConversationState(
    (snapshot) =>
      snapshot.taskId === running.taskId && snapshot.state === "idle" && snapshot.queueCount === 0,
    `${options.caseMarker}: workspace ${options.label} Initial turn没有回到 idle`,
    SSH_LIFECYCLE_TURN_TIMEOUT_MS,
  );

  return {
    ...task,
    identity: tab.workspaceIdentity,
    label: options.label,
    remoteSessionId: tab.remoteSessionId,
    taskId: running.taskId,
    workspacePath: options.workspacePath,
  };
}

export async function sendSSHFollowTurn(
  task: SSHLifecycleTask,
  caseMarker: string,
  foreignPrompt?: string,
): Promise<void> {
  await selectV4TaskById(task.taskId, 30_000);
  await waitForRemoteTab({
    caseMarker,
    expectedIdentity: task.identity,
    expectedPath: task.workspacePath,
    expectedRemoteSessionId: task.remoteSessionId,
  });
  const requestStart = await getUpstreamRequestRecordCount();
  const followMarker = `${task.followPrompt}:turn-${++followTurnSequence}:`;
  const requestQuery = {
    excludes: ["CRITICAL: Respond with TEXT ONLY", ...(foreignPrompt ? [foreignPrompt] : [])],
    includes: [task.firstPrompt],
    lastUserMessageIncludes: [followMarker],
  };
  await sendV4PromptAndWaitAccepted(
    `${followMarker} 只Reply ${task.followReply}`,
    followMarker,
    `${caseMarker}: workspace ${task.label} 续发没有被接受`,
  );
  await waitForUpstreamRequest(
    requestQuery,
    `${caseMarker}: workspace ${task.label} 续发历史orTarget workspace Error`,
    SSH_LIFECYCLE_TURN_TIMEOUT_MS,
    { afterIndex: requestStart - 1 },
  );
  await browser.waitUntil(
    async () => hasAssistantReplyForUserTurn(await getV4Messages(), followMarker, task.followReply),
    {
      timeout: SSH_LIFECYCLE_TURN_TIMEOUT_MS,
      timeoutMsg: `${caseMarker}: workspace ${task.label} 本次续发没有New assistant Reply`,
    },
  );
  await waitForV4ConversationState(
    (snapshot) =>
      snapshot.taskId === task.taskId && snapshot.state === "idle" && snapshot.queueCount === 0,
    `${caseMarker}: workspace ${task.label} 续发没有回到 idle`,
    SSH_LIFECYCLE_TURN_TIMEOUT_MS,
  );
  await browser.waitUntil(
    async () => {
      const requests = await getUpstreamRequestEvidence(requestQuery, {
        afterIndex: requestStart - 1,
      });
      return (
        requests.length === 1 &&
        requests[0]!.status === "complete" &&
        requests[0]!.statusCode === 200
      );
    },
    {
      timeout: 15_000,
      timeoutMsg: `${caseMarker}: workspace ${task.label} 续发不YesOne次Complete成功的Model request`,
    },
  );
}

export async function removeRemoteProjectEntry(
  workspacePath: string,
  caseMarker: string,
): Promise<void> {
  await removeRemoteProjectEntryForRow(projectSectionSelector(workspacePath));
  await waitForProjectRowGone(workspacePath, {
    timeout: 30_000,
    timeoutMsg: `${caseMarker}: 远端Project ${workspacePath} 移除后仍在Sidebar`,
  });
}

export type RemoteWorkspaceFaultOutcome = "retained-disconnected" | "self-healed";

export async function waitForRemoteWorkspaceFaultSettled(
  identity: string,
  caseMarker: string,
  staleSessionId: string | null,
  probeContext?: () => Promise<unknown>,
): Promise<RemoteWorkspaceFaultOutcome> {
  let outcome: RemoteWorkspaceFaultOutcome | null = null;
  let lastProbe: unknown = "not-probed";
  await browser
    .waitUntil(
      async () => {
        try {
          const snapshot = await readRemoteTabSnapshot(identity);
          lastProbe = {
            workspaceIdentity: snapshot.workspaceIdentity,
            remoteSessionId: snapshot.remoteSessionId,
          };
          if (snapshot.workspaceIdentity !== identity) return false;
          if (snapshot.remoteSessionId === null) {
            outcome = "retained-disconnected";
            return true;
          }
          if (staleSessionId !== null && snapshot.remoteSessionId !== staleSessionId) {
            outcome = "self-healed";
            return true;
          }
          return false;
        } catch (error) {
          lastProbe = { error: error instanceof Error ? error.message : String(error) };
          return false;
        }
      },
      { timeout: SSH_WORKSPACE_READY_TIMEOUT_MS },
    )
    .catch(async (error: unknown) => {
      const context = probeContext
        ? await probeContext().catch((probeError: unknown) => ({
            probeError: probeError instanceof Error ? probeError.message : String(probeError),
          }))
        : null;
      throw new Error(
        `${caseMarker}: 远端 server 故障后既没有进入 disconnected Retain态、也没有换成New session（stale=${staleSessionId ?? "unknown"}）；现场: ${JSON.stringify(lastProbe)}；Supplement: ${JSON.stringify(context)}`,
        { cause: error },
      );
    });
  if (outcome === null) {
    throw new Error(`${caseMarker}: 故障ProcessingResult未Triage`);
  }
  return outcome;
}

export async function waitForRemoteWorkspaceDisconnected(
  identity: string,
  caseMarker: string,
  probeContext?: () => Promise<unknown>,
): Promise<void> {
  let lastProbe: unknown = "not-probed";
  await browser
    .waitUntil(
      async () => {
        try {
          const snapshot = await readRemoteTabSnapshot(identity);
          lastProbe = {
            workspaceIdentity: snapshot.workspaceIdentity,
            remoteSessionId: snapshot.remoteSessionId,
          };
          return snapshot.workspaceIdentity === identity && snapshot.remoteSessionId === null;
        } catch (error) {
          lastProbe = { error: error instanceof Error ? error.message : String(error) };
          return false;
        }
      },
      { timeout: SSH_WORKSPACE_READY_TIMEOUT_MS },
    )
    .catch(async (error: unknown) => {
      const context = probeContext
        ? await probeContext().catch((probeError: unknown) => ({
            probeError: probeError instanceof Error ? probeError.message : String(probeError),
          }))
        : null;
      throw new Error(
        `${caseMarker}: remote workspace 没有进入 disconnected Retain态（expected identity=${identity}）；现场: ${JSON.stringify(lastProbe)}；Supplement: ${JSON.stringify(context)}`,
        { cause: error },
      );
    });
}

export async function reconnectRemoteProjectHost(
  workspacePath: string,
  caseMarker: string,
): Promise<void> {
  await clickRemoteHostConnect(workspacePath, {
    timeout: 30_000,
    timeoutMsg: `${caseMarker}: 远端Project ${workspacePath} 没有ShowAvailable的Reconnect按钮`,
  });
}

export async function listRemoteCfServerPids(config: SSHConnectionConfig): Promise<number[]> {
  const result = await runSSHCommand(config, "ps -eo pid=,args=");
  if (result.code !== 0) {
    throw new Error(`Read远端 cf-server PID Failed: ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+.*server-cli\.js\s+serve\b/u);
      return match ? [Number.parseInt(match[1]!, 10)] : [];
    })
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

async function listRemoteServerCorePids(
  config: SSHConnectionConfig,
  parentPid?: number,
): Promise<number[]> {
  const result = await runSSHCommand(config, "ps -eo pid=,ppid=,args=");
  if (result.code !== 0) {
    throw new Error(`Read远端 cf server core PID Failed: ${result.stderr}`);
  }
  return result.stdout
    .split("\n")
    .flatMap((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+.*server-core\.js\b/u);
      if (!match) return [];
      const pid = Number.parseInt(match[1]!, 10);
      const ppid = Number.parseInt(match[2]!, 10);
      if (parentPid !== undefined && ppid !== parentPid) return [];
      return [pid];
    })
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

export async function stopOwnedSSHServer(
  config: SSHConnectionConfig,
  beforePids: readonly number[],
  caseMarker: string,
): Promise<number> {
  const currentPids = await listRemoteCfServerPids(config);
  const owned = currentPids.filter((pid) => !beforePids.includes(pid));
  if (owned.length !== 1) {
    throw new Error(
      `${caseMarker}: 只AllowEnd止本 case New的One个 cf-server，before=${beforePids.join(",")}, current=${currentPids.join(",")}`,
    );
  }
  const pid = owned[0]!;
  const corePids = await listRemoteServerCorePids(config, pid);
  const result = await runSSHCommand(config, `kill -TERM -- ${pid}`);
  if (result.code !== 0) {
    throw new Error(`${caseMarker}: End止远端 cf-server ${pid} Failed: ${result.stderr}`);
  }
  if (corePids.length > 0) {
    await runSSHCommand(config, `kill -TERM -- ${corePids.join(" ")}`).catch(() => undefined);
  }
  await browser.waitUntil(
    async () => {
      const [daemons, cores] = await Promise.all([
        listRemoteCfServerPids(config),
        listRemoteServerCorePids(config),
      ]);
      return !daemons.includes(pid) && corePids.every((corePid) => !cores.includes(corePid));
    },
    {
      timeout: SSH_WORKSPACE_READY_TIMEOUT_MS,
      timeoutMsg: `${caseMarker}: 远端 cf-server ${pid}（core=${corePids.join(",") || "none"}）没有Exit`,
    },
  );
  return pid;
}

export async function waitForRendererAfterColdRestart(caseMarker: string): Promise<void> {
  await switchToWorkspaceRendererWindow("", 60_000);
  await waitForTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 60_000,
    timeoutMsg: `${caseMarker}: cold restart 后主Boundary面尚未就绪`,
  });
}

export async function readTaskRowInProject(
  task: SSHLifecycleTask,
  caseMarker: string,
): Promise<void> {
  await waitForTaskRowInProject(task.taskId, task.workspacePath, {
    timeout: 30_000,
    timeoutMsg: `${caseMarker}: task ${task.label} 没有恢复到正确Project`,
  });
}

export async function prepareSSHLifecycle(
  caseMarker: string,
  options: SSHLifecycleProviderOptions = {},
): Promise<{
  config: SSHRuntimeConfig;
  initialHosts: Array<{ name: string; pid: number }>;
  provider: SSHLifecycleProvider;
}> {
  const config = readSSHRuntimeConfig(caseMarker);
  await prepareV4ConversationE2E({ skipProvider: true });
  const initialHosts = await readHostProcesses();
  expect(initialHosts).toHaveLength(1);
  const provider = await createSSHLifecycleProvider(config, caseMarker, options);
  return { config, initialHosts, provider };
}

export interface RemoteProcessIdentity {
  pid: number;
  ppid?: number;
  startTicks: number;
  cwd?: string;
}

export async function readRemoteCoreIdentity(
  config: SSHConnectionConfig,
  caseMarker: string,
): Promise<{
  pid: number;
  supervisorPid: number;
  startTicks: number;
  state: string;
  generation: number;
}> {
  const statusResult = await runSSHCommand(config, 'cat "$HOME/.cf/server/run/status.json"');
  if (statusResult.code !== 0) {
    throw new Error(`${caseMarker}: Read远端 Core status Failed: ${statusResult.stderr}`);
  }
  const status = JSON.parse(statusResult.stdout) as {
    pid?: number;
    state?: string;
    generation?: number;
  };
  const corePid = status.pid;
  if (typeof corePid !== "number" || !Number.isSafeInteger(corePid) || corePid <= 0) {
    throw new Error(`${caseMarker}: Core status Missing有效 pid`);
  }
  const proc = await runSSHCommand(
    config,
    `pid=${corePid}; test -r /proc/$pid/stat && awk '{print $4" "$22}' /proc/$pid/stat`,
  );
  const [supervisorText, startTicksText] = proc.stdout.trim().split(/\s+/u);
  const supervisorPid = Number.parseInt(supervisorText ?? "", 10);
  const startTicks = Number.parseInt(startTicksText ?? "", 10);
  if (!Number.isSafeInteger(supervisorPid) || !Number.isSafeInteger(startTicks)) {
    throw new Error(`${caseMarker}: Core /proc identity 不Complete: ${proc.stdout.trim()}`);
  }
  return {
    pid: corePid,
    supervisorPid,
    startTicks,
    state: status.state ?? "unknown",
    generation: status.generation ?? 0,
  };
}

export async function listRemoteAgentProcesses(
  config: SSHConnectionConfig,
): Promise<Array<RemoteProcessIdentity & { cwd: string }>> {
  const result = await runSSHCommand(
    config,
    "for pid in $(ps -eo pid=,args= | awk '/app-server --stdio/ {print $1}'); do " +
      "ppid=$(ps -o ppid= -p \"$pid\" | tr -d ' '); " +
      "ticks=$(awk '{print $22}' /proc/$pid/stat 2>/dev/null); " +
      'cwd=$(readlink /proc/$pid/cwd 2>/dev/null); printf \'%s\\t%s\\t%s\\t%s\\n\' "$pid" "$ppid" "$ticks" "$cwd"; done',
  );
  if (result.code !== 0) throw new Error(`Read远端 Agent 进程Failed: ${result.stderr}`);
  return result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [pidText, ppidText, ticksText, ...cwdParts] = line.split("\t");
      const pid = Number.parseInt(pidText ?? "", 10);
      const startTicks = Number.parseInt(ticksText ?? "", 10);
      if (!Number.isSafeInteger(pid) || !Number.isSafeInteger(startTicks)) return [];
      const ppid = Number.parseInt(ppidText ?? "", 10);
      return [
        {
          pid,
          ...(Number.isSafeInteger(ppid) ? { ppid } : {}),
          startTicks,
          cwd: cwdParts.join("\t"),
        },
      ];
    });
}

export async function terminateRemoteProcess(
  config: SSHConnectionConfig,
  process: RemoteProcessIdentity,
  caseMarker: string,
): Promise<void> {
  const current = await runSSHCommand(
    config,
    `test -r /proc/${process.pid}/stat && awk '{print $22}' /proc/${process.pid}/stat || true`,
  );
  if (Number.parseInt(current.stdout.trim(), 10) !== process.startTicks) return;
  const killed = await runSSHCommand(config, `kill -TERM -- ${process.pid}`);
  if (killed.code !== 0)
    throw new Error(`${caseMarker}: End止远端进程 ${process.pid} Failed: ${killed.stderr}`);
  await browser.waitUntil(
    async () =>
      (
        await runSSHCommand(
          config,
          `test -r /proc/${process.pid}/stat && awk '{print $22}' /proc/${process.pid}/stat || true`,
        )
      ).stdout.trim() !== String(process.startTicks),
    {
      timeout: SSH_WORKSPACE_READY_TIMEOUT_MS,
      interval: 500,
      timeoutMsg: `${caseMarker}: 远端进程 ${process.pid} 没有Exit`,
    },
  );
}
