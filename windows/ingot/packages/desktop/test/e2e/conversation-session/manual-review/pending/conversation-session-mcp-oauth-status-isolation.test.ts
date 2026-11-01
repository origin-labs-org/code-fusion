import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  TID_CHAT_VIEW,
  TID_MCP_OPEN_AUTHORIZATION_BUTTON,
  TID_MCP_SERVER_ROW,
  TID_PLUGIN_MCP_SERVER_ROW,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_PAGE,
  TID_SETTINGS_SECTION_NAV,
  TID_TASK_SETTINGS_BUTTON,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getE2EAppDataPaths,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import {
  E2E_REPLY_TOKEN,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUpstreamRequest,
  waitForToolCallBlockByToolName,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";
import { ensureToolCrossProductFullAccessMode } from "../../../helpers/conversation-session-tool-cross-product.js";
import {
  startMcpOAuthStatusIsolationServer,
  type McpOAuthStatusIsolationServer,
} from "../../../helpers/mcp-oauth-status-isolation.js";

const CASE_TIMEOUT_MS = 180_000;
const DIRECT_MCP_NAME = "everything";
const DIRECT_MCP_TOOL_NAME = "mcp__everything__ping";
const PLAIN_HTTP_MCP_NAME = "plain_http";
const PLAIN_HTTP_MCP_TOOL_NAME = "mcp__plain_http__ping";
const PLUGIN_ID = "e2e-plugin-mcp-oauth@e2e-fixture";
const PLUGIN_NAME = "e2e-plugin-mcp-oauth";
const PLUGIN_RUNTIME_MCP_NAME = `plugin:${PLUGIN_NAME}:canva`;
const PROMPT_MARKER = "E2E_MCP_OAUTH_STATUS_ISOLATION";
const DIRECT_RESULT = `E2E_MCP_DIRECT_PONG:${PROMPT_MARKER}`;
const PLAIN_HTTP_RESULT = `E2E_MCP_HTTP_PONG:${PROMPT_MARKER}`;
const E2E_PATHS = getE2EAppDataPaths();
const CLI_CONFIG_FILE = join(E2E_PATHS.homeDir, ".cf", "cli", "config.json");
const INSTALLED_PLUGINS_FILE = join(
  E2E_PATHS.homeDir,
  ".cf",
  "cli",
  "plugins",
  "installed_plugins.json",
);
const PLUGIN_ROOT = join(E2E_PATHS.homeDir, ".cf", "cli", "e2e-fixtures", PLUGIN_NAME);
const PLUGIN_MANIFEST_FILE = join(PLUGIN_ROOT, ".cf-plugin", "plugin.json");
const CASE_ROOT = join(E2E_PATHS.workspace, "mcp-oauth-status-isolation-e2e");
const DIRECT_MCP_CALL_LOG = join(CASE_ROOT, "direct-mcp-calls.ndjson");
const DIRECT_MCP_SERVER_SCRIPT = resolve(
  process.cwd(),
  "test/e2e/fixtures/mcp/oauth-status-isolation-direct-server.mjs",
);

describe("Chat area MCP OAuth status refresh isolation E2E", () => {
  let oauthServer: McpOAuthStatusIsolationServer | null = null;

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await oauthServer?.close();
  });

  it("MO01/MO03: Plugin OAuth status refresh will not disconnect stdio and normal HTTP MCP", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareConversationE2E();
    oauthServer = await startMcpOAuthStatusIsolationServer();
    await writeMcpFixtures(oauthServer.mcpUrl, oauthServer.plainHttpMcpUrl);
    const openExternalMock = await browser.electron.mock("shell", "openExternal");
    await openExternalMock.mockResolvedValue(undefined);

    await openMcpSettings();
    await waitForMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, DIRECT_MCP_NAME),
      toolCount: 1,
    });
    await waitForMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, PLAIN_HTTP_MCP_NAME),
      toolCount: 1,
    });
    await waitForMcpRow({
      status: "connecting",
      testIdValue: testId(TID_PLUGIN_MCP_SERVER_ROW, PLUGIN_RUNTIME_MCP_NAME),
      toolCount: 0,
    });
    const directMcpPid = await waitForDirectMcpProcessStarted(30_000);
    await waitForTestIdByDom(testId(TID_MCP_OPEN_AUTHORIZATION_BUTTON, PLUGIN_RUNTIME_MCP_NAME), {
      timeout: 30_000,
      timeoutMsg: "Plugin MCP did not display OAuth authorization entry",
    });

    const pendingSnapshot = oauthServer.snapshot();
    expect(pendingSnapshot.unauthorizedMcpRequestCount).toBeGreaterThan(0);

    await browser.pause(2_500);
    expect(oauthServer.snapshot()).toMatchObject({
      plainHttpInitializeCount: pendingSnapshot.plainHttpInitializeCount,
      unauthorizedMcpRequestCount: pendingSnapshot.unauthorizedMcpRequestCount,
    });
    await expectMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, DIRECT_MCP_NAME),
      toolCount: 1,
    });
    expectProcessAlive(directMcpPid, "status-only poll 期间用户级 MCP 被断开");
    await expectMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, PLAIN_HTTP_MCP_NAME),
      toolCount: 1,
    });

    await clickTestIdByDom(testId(TID_MCP_OPEN_AUTHORIZATION_BUTTON, PLUGIN_RUNTIME_MCP_NAME), {
      timeout: 15_000,
      timeoutMsg: "插件 MCP OAuth 授权按钮不可点击",
    });
    const authorizationUrl = await waitForOpenedAuthorizationUrl(openExternalMock);
    await oauthServer.completeAuthorization(authorizationUrl);

    await waitForMcpRow({
      status: "connected",
      testIdValue: testId(TID_PLUGIN_MCP_SERVER_ROW, PLUGIN_RUNTIME_MCP_NAME),
      toolCount: 1,
    });
    await expectMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, DIRECT_MCP_NAME),
      toolCount: 1,
    });
    await expectMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, PLAIN_HTTP_MCP_NAME),
      toolCount: 1,
    });
    expect(oauthServer.snapshot()).toMatchObject({
      authorizationRequestCount: 1,
      authorizedInitializeCount: 1,
      plainHttpInitializeCount: pendingSnapshot.plainHttpInitializeCount,
      registrationRequestCount: 1,
      tokenRequestCount: 1,
    });

    await verifyConfigLoadFailureKeepsMcpRuntime(directMcpPid, oauthServer);

    await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
      timeout: 15_000,
      timeoutMsg: "MCP 设置页返回按钮没有出现",
    });
    await waitForTestIdByDom(TID_CHAT_VIEW, {
      timeout: 15_000,
      timeoutMsg: "完成 MCP OAuth 后没有回到工作区",
    });
    await ensureToolCrossProductFullAccessMode();
    await startNewTask();

    const prompt = `${PROMPT_MARKER}: Call ${DIRECT_MCP_TOOL_NAME} exactly once with marker "${PROMPT_MARKER}", then call ${PLAIN_HTTP_MCP_TOOL_NAME} exactly once with the same marker, then reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
    await sendPrompt(prompt);
    await waitForComposerText("", "Input box was not cleared after initial send in MCP OAuth isolation case");
    await waitForUserMessageContaining(PROMPT_MARKER);
    await waitForUpstreamRequest(
      {
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
        includes: [PROMPT_MARKER, DIRECT_MCP_TOOL_NAME, PLAIN_HTTP_MCP_TOOL_NAME],
      },
      "First-round provider request did not expose both stdio and normal HTTP MCP tools",
      60_000,
    );
    await waitForToolCallBlockByToolName(DIRECT_MCP_TOOL_NAME, 60_000);
    await waitForDirectMcpCall(PROMPT_MARKER, 60_000);
    await waitForUpstreamRequest(
      {
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
        includes: [PROMPT_MARKER, DIRECT_MCP_TOOL_NAME, DIRECT_RESULT],
      },
      "用户级 MCP tool_result 没有进入 provider continuation",
      60_000,
    );
    await waitForToolCallBlockByToolName(PLAIN_HTTP_MCP_TOOL_NAME, 60_000);
    await waitForPlainHttpMcpCall(oauthServer, PROMPT_MARKER, 60_000);
    await waitForUpstreamRequest(
      {
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
        includes: [
          PROMPT_MARKER,
          DIRECT_RESULT,
          PLAIN_HTTP_MCP_TOOL_NAME,
          PLAIN_HTTP_RESULT,
        ],
      },
      "Normal HTTP MCP tool_result did not enter provider continuation",
      60_000,
    );
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "Chat did not return to idle after MCP OAuth isolation case completed",
      60_000,
    );
  });
});

async function openMcpSettings(): Promise<void> {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "Could not find settings entry button",
  });
  await waitForTestIdByDom(TID_SETTINGS_PAGE, {
    timeout: 15_000,
    timeoutMsg: "设置页没有渲染",
  });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "mcp"), {
    timeout: 15_000,
    timeoutMsg: "设置页没有出现 MCP 分区入口",
  });
}

interface McpRowExpectation {
  status: string;
  testIdValue: string;
  toolCount: number;
}

interface McpRowSnapshot {
  exists: boolean;
  status: string | null;
  text: string;
  toolCount: number | null;
}

async function waitForMcpRow(expectation: McpRowExpectation): Promise<void> {
  let latest: McpRowSnapshot = {
    exists: false,
    status: null,
    text: "",
    toolCount: null,
  };
  await browser.waitUntil(
    async () => {
      latest = await readMcpRow(expectation.testIdValue);
      return matchesMcpRow(latest, expectation);
    },
    {
      timeout: 45_000,
      timeoutMsg: `MCP 行Status未收敛: expected=${JSON.stringify(expectation)} latest=${JSON.stringify(latest)}`,
    },
  );
}

async function expectMcpRow(expectation: McpRowExpectation): Promise<void> {
  expect(await readMcpRow(expectation.testIdValue)).toMatchObject({
    exists: true,
    status: expectation.status,
    toolCount: expectation.toolCount,
  });
}

function matchesMcpRow(snapshot: McpRowSnapshot, expectation: McpRowExpectation): boolean {
  return (
    snapshot.exists &&
    snapshot.status === expectation.status &&
    snapshot.toolCount === expectation.toolCount
  );
}

async function readMcpRow(testIdValue: string): Promise<McpRowSnapshot> {
  return (await browser.execute((targetTestId) => {
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
      (item) => item.dataset.testid === targetTestId,
    );
    if (!element) {
      return { exists: false, status: null, text: "", toolCount: null };
    }
    const rawToolCount = element.dataset.mcpToolCount;
    return {
      exists: true,
      status: element.dataset.mcpStatus ?? null,
      text: element.innerText,
      toolCount: rawToolCount === undefined || rawToolCount === "" ? null : Number(rawToolCount),
    };
  }, testIdValue)) as McpRowSnapshot;
}

async function waitForOpenedAuthorizationUrl(
  openExternalMock: Awaited<ReturnType<typeof browser.electron.mock>>,
): Promise<string> {
  let authorizationUrl = "";
  await browser.waitUntil(
    async () => {
      await openExternalMock.update();
      authorizationUrl =
        openExternalMock.mock.calls
          .map((call) => call[0])
          .find(
            (value): value is string => typeof value === "string" && value.includes("/authorize?"),
          ) ?? "";
      return Boolean(authorizationUrl);
    },
    {
      timeout: 15_000,
      timeoutMsg: "Did not capture platform openExternal MCP OAuth URL",
    },
  );
  return authorizationUrl;
}

async function writeMcpFixtures(mcpUrl: string, plainHttpMcpUrl: string): Promise<void> {
  await mkdir(CASE_ROOT, { recursive: true });
  await rm(DIRECT_MCP_CALL_LOG, { force: true });
  await mkdir(join(PLUGIN_ROOT, ".cf-plugin"), { recursive: true });
  await mkdir(join(E2E_PATHS.homeDir, ".cf", "cli", "plugins"), {
    recursive: true,
  });

  await writeFile(
    PLUGIN_MANIFEST_FILE,
    `${JSON.stringify(
      {
        author: { name: "CodeFusion E2E" },
        description: "E2E fixture plugin with an OAuth-protected MCP server.",
        license: "MIT",
        mcpServers: {
          canva: {
            oauth: {
              clientName: "CodeFusion MCP OAuth E2E",
              scope: "mcp:tools",
              type: "authorization_code",
            },
            timeoutMs: 30_000,
            type: "http",
            url: mcpUrl,
          },
        },
        name: PLUGIN_NAME,
        version: "0.0.0",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    INSTALLED_PLUGINS_FILE,
    `${JSON.stringify(
      {
        plugins: [
          {
            id: PLUGIN_ID,
            installPath: PLUGIN_ROOT,
            installedAt: "2026-07-10T00:00:00.000Z",
            marketplace: "e2e-fixture",
            name: PLUGIN_NAME,
            scope: "user",
            updatedAt: "2026-07-10T00:00:00.000Z",
            version: "0.0.0",
          },
        ],
        version: 1,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const config = await readJsonRecord(CLI_CONFIG_FILE);
  const mcp = asRecord(config.mcp);
  const servers = asRecord(mcp.servers);
  const plugins = asRecord(config.plugins);
  const enabledPlugins = asRecord(plugins.enabledPlugins);
  enabledPlugins[PLUGIN_ID] = true;
  plugins.enabledPlugins = enabledPlugins;
  servers[DIRECT_MCP_NAME] = {
    args: [DIRECT_MCP_SERVER_SCRIPT],
    command: process.execPath,
    env: {
      E2E_MCP_DIRECT_CALL_LOG: DIRECT_MCP_CALL_LOG,
    },
    timeoutMs: 30_000,
    type: "stdio",
  };
  servers[PLAIN_HTTP_MCP_NAME] = {
    timeoutMs: 30_000,
    type: "http",
    url: plainHttpMcpUrl,
  };
  mcp.servers = servers;
  config.mcp = mcp;
  config.plugins = plugins;
  await writeFile(CLI_CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function waitForDirectMcpCall(marker: string, timeoutMs: number): Promise<void> {
  let latest: DirectMcpLogEntry[] = [];
  await browser.waitUntil(
    async () => {
      latest = await readDirectMcpCalls();
      return latest.some((call) => call.tool === "ping" && call.marker === marker);
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `User级 MCP ping 没有真实execute: ${JSON.stringify(latest)}`,
    },
  );
}

async function waitForPlainHttpMcpCall(
  server: McpOAuthStatusIsolationServer,
  marker: string,
  timeoutMs: number,
): Promise<void> {
  let latest: string[] = [];
  await browser.waitUntil(
    async () => {
      latest = server.snapshot().plainHttpToolCallMarkers;
      return latest.includes(marker);
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `普通 HTTP MCP ping 没有真实execute: ${JSON.stringify(latest)}`,
    },
  );
}

interface DirectMcpLogEntry {
  event?: "started";
  marker?: string;
  pid?: number;
  tool?: string;
}

async function waitForDirectMcpProcessStarted(timeoutMs: number): Promise<number> {
  let latest: DirectMcpLogEntry[] = [];
  let pid = 0;
  await browser.waitUntil(
    async () => {
      latest = await readDirectMcpCalls();
      pid = [...latest].reverse().find((entry) => entry.event === "started")?.pid ?? 0;
      return pid > 0;
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `User级 MCP 没有记录Start PID: ${JSON.stringify(latest)}`,
    },
  );
  return pid;
}

function expectProcessAlive(pid: number, message: string): void {
  try {
    process.kill(pid, 0);
  } catch (error) {
    throw new Error(`${message}: pid=${pid}`, { cause: error });
  }
}

async function verifyConfigLoadFailureKeepsMcpRuntime(
  directMcpPid: number,
  server: McpOAuthStatusIsolationServer,
): Promise<void> {
  const validConfig = await readFile(CLI_CONFIG_FILE, "utf8");
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "Cannot return to workspace before inducing MCP configuration read failure",
  });
  await waitForTestIdByDom(TID_CHAT_VIEW, {
    timeout: 15_000,
    timeoutMsg: "Workspace was not restored before inducing MCP configuration read failure",
  });
  await writeFile(CLI_CONFIG_FILE, "{ invalid e2e mcp config", "utf8");
  const plainHttpInitializeCount = server.snapshot().plainHttpInitializeCount;

  try {
    await openMcpSettings();
    await browser.pause(2_500);
    await expectMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, DIRECT_MCP_NAME),
      toolCount: 1,
    });
    expectProcessAlive(directMcpPid, "User-level MCP was disconnected by empty list replace after configuration read failure");
    await expectMcpRow({
      status: "connected",
      testIdValue: testId(TID_MCP_SERVER_ROW, PLAIN_HTTP_MCP_NAME),
      toolCount: 1,
    });
    expect(server.snapshot().plainHttpInitializeCount).toBe(plainHttpInitializeCount);
  } finally {
    await writeFile(CLI_CONFIG_FILE, validConfig, "utf8");
  }

  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, {
    timeout: 15_000,
    timeoutMsg: "Cannot return to workspace before restoring MCP configuration",
  });
  await waitForTestIdByDom(TID_CHAT_VIEW, {
    timeout: 15_000,
    timeoutMsg: "Workspace did not appear before restoring MCP configuration",
  });
  await openMcpSettings();
  await waitForMcpRow({
    status: "connected",
    testIdValue: testId(TID_MCP_SERVER_ROW, DIRECT_MCP_NAME),
    toolCount: 1,
  });
  await waitForMcpRow({
    status: "connected",
    testIdValue: testId(TID_PLUGIN_MCP_SERVER_ROW, PLUGIN_RUNTIME_MCP_NAME),
    toolCount: 1,
  });
  await waitForMcpRow({
    status: "connected",
    testIdValue: testId(TID_MCP_SERVER_ROW, PLAIN_HTTP_MCP_NAME),
    toolCount: 1,
  });
}

async function readDirectMcpCalls(): Promise<DirectMcpLogEntry[]> {
  try {
    const raw = await readFile(DIRECT_MCP_CALL_LOG, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DirectMcpLogEntry);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
