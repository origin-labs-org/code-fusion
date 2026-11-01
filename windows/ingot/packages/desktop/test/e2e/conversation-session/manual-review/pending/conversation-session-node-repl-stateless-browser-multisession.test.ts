import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, getE2EAppDataPaths } from "../../../helpers/desktop-app.js";
import { listToolCallBlocks } from "../../../helpers/conversation-session-tool.js";
import {
  collectProcessTreeByRootPids,
  listSystemProcesses,
} from "../../../helpers/e2e-process-cleanup.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";
import { isV4TurnCompleted } from "../../../helpers/v4-turn-completion.js";

const NODE_REPL_TOOL = "mcp__node_repl__js";
const NODE_REPL_SERVER = "node_repl";
const NODE_REPL_PROCESS_TITLE = "cf-node-repl-mcp";
const SESSION_A_MARKER = "E2E_NODE_REPL_BROWSER_STATELESS_A";
const SESSION_B_MARKER = "E2E_NODE_REPL_BROWSER_STATELESS_B";
const SESSION_A_DONE = "E2E_NODE_REPL_BROWSER_STATELESS_A_DONE";
const SESSION_B_DONE = "E2E_NODE_REPL_BROWSER_STATELESS_B_DONE";
const E2E_PATHS = getE2EAppDataPaths();

interface McpLogContext extends Record<string, unknown> {
  event?: string;
  mcpConnectionId?: string;
  mcpIsolation?: string;
  mcpProtocolEra?: string;
  mcpProtocolVersion?: string;
  mcpServerName?: string;
  mcpTransportPid?: number;
  mcpVersionNegotiationMode?: string;
  sessionId?: string;
  workspaceKey?: string;
}

describe("Node REPL Browser Use 无状态多 Session E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("BSM01/BSM02: fresh kernel, sequential BrowserControl, and both sessions share modern child", async function () {
    this.timeout(240_000);
    await prepareV4ConversationE2E();

    const runId = Date.now();
    await sendV4Prompt(
      `${SESSION_A_MARKER}_${runId}: use ${NODE_REPL_TOOL} for Browser Use twice and report only the fixture result.`,
    );
    const sessionAFirstCallId = await approveNodeReplCall();
    await approveNodeReplCall(sessionAFirstCallId);
    const sessionA = await waitForCompletedSession(
      SESSION_A_DONE,
      "Two Browser Use calls for Session A did not complete",
    );

    await startNewV4Draft();
    await sendV4Prompt(
      `${SESSION_B_MARKER}_${runId}: use ${NODE_REPL_TOOL} for Browser Use once and report only the fixture result.`,
    );
    await approveNodeReplCall();
    const sessionB = await waitForCompletedSession(
      SESSION_B_DONE,
      "Browser Use call for Session B did not complete",
    );
    expect(sessionB).not.toBe(sessionA);

    const runtime = await waitForSharedNodeReplRuntime(sessionA, sessionB);
    await expectSingleNodeReplProcess(runtime.pid);

    await selectV4TaskById(sessionA);
    await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId === sessionA &&
        snapshot.timelineText.includes(SESSION_A_DONE) &&
        !snapshot.timelineText.includes(SESSION_B_DONE),
      "切回 Session A 后出现了 Session B 的结果",
    );
    await selectV4TaskById(sessionB);
    await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId === sessionB &&
        snapshot.timelineText.includes(SESSION_B_DONE) &&
        !snapshot.timelineText.includes(SESSION_A_DONE),
      "切回 Session B 后出现了 Session A 的结果",
    );
  });
});

async function approveNodeReplCall(previousCallId?: string): Promise<string> {
  let callId = "";
  let callStatus: string | null = null;
  let blocks = await listToolCallBlocks();
  await browser.waitUntil(
    async () => {
      blocks = await listToolCallBlocks();
      const candidate = [...blocks]
        .reverse()
        .find((block) => block.toolName === NODE_REPL_TOOL && block.toolCallId !== previousCallId);
      callId = candidate?.toolCallId ?? "";
      callStatus = candidate?.status ?? null;
      return callId.length > 0 && (callStatus === "pending" || callStatus === "completed");
    },
    {
      timeout: 60_000,
      timeoutMsg: `Node REPL tool call 没有进入待ApproveStatus: previousCallId=${previousCallId ?? "none"} blocks=${JSON.stringify(blocks)}`,
    },
  );
  if (callStatus === "completed") return callId;

  let latest = "";
  let completedWithoutPermission = false;
  await browser.waitUntil(
    async () => {
      const [state, latestBlocks] = await Promise.all([
        browser.execute(() => {
          const listboxes = Array.from(
            document.querySelectorAll<HTMLElement>('[role="listbox"]'),
          ).filter((element) => {
            const label = element.getAttribute("aria-label")?.trim();
            return label === "需要权限" || label === "Permission required";
          });
          return {
            allowOnceCount: listboxes.reduce(
              (count, listbox) =>
                count +
                listbox.querySelectorAll(
                  'button[role="option"][data-permission-option-kind="allowOnce"]',
                ).length,
              0,
            ),
            listboxCount: listboxes.length,
          };
        }),
        listToolCallBlocks(),
      ]);
      completedWithoutPermission = latestBlocks.some(
        (block) => block.toolCallId === callId && block.status === "completed",
      );
      latest = JSON.stringify({ state, blocks: latestBlocks });
      return completedWithoutPermission || (state.listboxCount === 1 && state.allowOnceCount === 1);
    },
    {
      timeout: 60_000,
      timeoutMsg: `Node REPL Permission request没有出现: toolName=${NODE_REPL_TOOL} latest=${latest}`,
    },
  );
  if (completedWithoutPermission) return callId;

  const clicked = await browser.execute(() => {
    const listboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).filter(
      (element) => {
        const label = element.getAttribute("aria-label")?.trim();
        return label === "需要权限" || label === "Permission required";
      },
    );
    const options = listboxes.flatMap((listbox) =>
      Array.from(
        listbox.querySelectorAll<HTMLButtonElement>(
          'button[role="option"][data-permission-option-kind="allowOnce"]',
        ),
      ),
    );
    if (listboxes.length !== 1 || options.length !== 1) return false;
    options[0]?.click();
    return true;
  });
  expect(clicked).toBe(true);
  return callId;
}

async function waitForCompletedSession(expectedText: string, timeoutMsg: string): Promise<string> {
  const snapshot = await waitForV4Pane(
    (candidate) => isV4TurnCompleted(candidate, expectedText),
    timeoutMsg,
    90_000,
  );
  if (!snapshot.sessionId || snapshot.sessionId === "draft") {
    throw new Error(`${timeoutMsg}: sessionId missing`);
  }
  return snapshot.sessionId;
}

async function waitForSharedNodeReplRuntime(
  sessionA: string,
  sessionB: string,
): Promise<{ pid: number }> {
  let latest: McpLogContext[] = [];
  let pid: number | undefined;
  await browser.waitUntil(
    async () => {
      latest = await readMcpLogContexts();
      const leases = latest.filter(
        (context) =>
          context.event === "mcp.pool.lease.acquired" &&
          context.mcpServerName === NODE_REPL_SERVER &&
          (context.sessionId === sessionA || context.sessionId === sessionB),
      );
      const leaseA = [...leases].reverse().find((context) => context.sessionId === sessionA);
      const leaseB = [...leases].reverse().find((context) => context.sessionId === sessionB);
      if (
        !leaseA?.mcpConnectionId ||
        leaseA.mcpConnectionId !== leaseB?.mcpConnectionId ||
        leaseA.mcpIsolation !== "workspace" ||
        leaseB.mcpIsolation !== "workspace" ||
        typeof leaseA.workspaceKey !== "string" ||
        leaseA.workspaceKey !== leaseB.workspaceKey
      ) {
        return false;
      }
      const connected = [...latest]
        .reverse()
        .find(
          (context) =>
            context.event === "mcp.server.connected" &&
            context.mcpServerName === NODE_REPL_SERVER &&
            context.mcpConnectionId === leaseA.mcpConnectionId,
        );
      if (
        connected?.mcpProtocolEra !== "modern" ||
        connected.mcpProtocolVersion !== "2026-07-28" ||
        connected.mcpVersionNegotiationMode !== "2026-07-28" ||
        typeof connected.mcpTransportPid !== "number"
      ) {
        return false;
      }
      pid = connected.mcpTransportPid;
      return true;
    },
    {
      timeout: 60_000,
      timeoutMsg: `Node REPL 多 session ConnectEvidence不Complete: ${JSON.stringify(latest)}`,
    },
  );
  if (pid === undefined) throw new Error("Node REPL 多 session PID 缺失");
  return { pid };
}

async function expectSingleNodeReplProcess(expectedPid: number): Promise<void> {
  const electron = await browser.electron.execute(() => ({ pid: process.pid }));
  let latest: Array<{ command: string; pid: number; ppid: number }> = [];
  await browser.waitUntil(
    async () => {
      const tree = collectProcessTreeByRootPids(await listSystemProcesses(), [electron.pid]);
      latest = tree.filter((entry) => entry.command.trim() === NODE_REPL_PROCESS_TITLE);
      return latest.length === 1 && latest[0]?.pid === expectedPid;
    },
    {
      interval: 250,
      timeout: 30_000,
      timeoutMsg: `Node REPL child 不YesLogs对应的唯One进程: expectedPid=${expectedPid} latest=${JSON.stringify(latest)}`,
    },
  );
}

async function readMcpLogContexts(): Promise<McpLogContext[]> {
  const logDirs = await resolveMcpLogDirs();
  const contexts: McpLogContext[] = [];
  for (const logDir of logDirs) {
    const files = await readdir(logDir).catch(() => []);
    for (const file of files) {
      const content = await readFile(join(logDir, file), "utf8").catch(() => "");
      for (const line of content.split("\n")) {
        const entry = parseRecord(line);
        const context = asRecord(entry?.context) as McpLogContext;
        const event =
          typeof entry?.event === "string"
            ? entry.event
            : typeof context.event === "string"
              ? context.event
              : undefined;
        const sessionId =
          typeof entry?.sessionId === "string" ? entry.sessionId : context.sessionId;
        if (event?.startsWith("mcp.")) contexts.push({ ...context, event, sessionId });
      }
    }
  }
  return contexts;
}

async function resolveMcpLogDirs(): Promise<string[]> {
  const explicit = process.env.CF_LOG_DIR?.trim();
  if (explicit) return [explicit];
  const artifactDir = process.env.CF_E2E_ARTIFACT_DIR?.trim();
  if (artifactDir) {
    const runtimeLogDir = join(artifactDir, "runtime-logs");
    const workers = await readdir(runtimeLogDir, { withFileTypes: true }).catch(() => []);
    const workerLogDirs = workers
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(runtimeLogDir, entry.name, "agent"));
    if (workerLogDirs.length > 0) return workerLogDirs;
  }
  return [join(E2E_PATHS.storageRoot, "cli", "log")];
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
