import { type AppToolSearchMode } from "@origin-ai/cf-shared";
import {
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  TID_SETTINGS_TOOL_SEARCH_SELECT,
  TID_SETTINGS_TOOL_SEARCH_OPTION,
  TID_TASK_SETTINGS_BUTTON,
  TID_TOOL_SUMMARY_TRIGGER,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  getActiveWorkspacePath,
  readSettings,
} from "../helpers/desktop-app.js";
import { restartIntoWorkspaceRestoringPreferences } from "../helpers/model-provider-restart-runtime.js";
import {
  getV4PaneSnapshot,
  selectV4TaskById,
  switchV4Model,
  waitForV4Pane,
} from "../helpers/v4-conversation.js";
import {
  setupToolSearchDesktop,
  newToolSearchTask,
  toolSearchTurn,
  expectToolSearchDisabled,
  expectToolSearchLoaded,
  expectToolSearchUnloaded,
  expectToolResultPair,
  TOOLSEARCH_MODEL,
  TOOLSEARCH_PLAIN_PROVIDER,
  TOOLSEARCH_PLAN_PROVIDER,
} from "../helpers/toolsearch-desktop.js";
import { toolSearchBlocks, type ToolSearchRecord } from "../helpers/toolsearch-provider.js";
import { waitForToolCallBlockByToolCallId } from "../helpers/conversation-session-tool.js";

describe("ToolSearch Settings 的启动与恢复策略", () => {
  before(async () => setupToolSearchDesktop());
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("TS11: Tri-state settings, Auto provider branching, Local execution, hot session pinning, and cold recovery", async function () {
    this.timeout(360_000);
    await newToolSearchTask();
    await openSettings();
    expect(await browser.$(`[data-testid="${TID_SETTINGS_TOOL_SEARCH_SELECT}"]`).getText()).toMatch(
      /^(Close|Off)$/u,
    );
    expect((await readSettings()).toolSearchMode ?? "off").toBe("off");
    const select = await browser.$(`[data-testid="${TID_SETTINGS_TOOL_SEARCH_SELECT}"]`);
    const notice = await select.$("./ancestor::div[contains(@class, 'border-t')][1]/div[last()]/p");
    await notice.scrollIntoView();
    await notice.waitForDisplayed({ timeout: 10_000 });
    expect(await notice.getText()).toMatch(
      /实验性功能。.*原生 ToolSearch.*CacheInvalid.*Token 用量|Experimental feature\..*native ToolSearch.*prompt caching.*token usage/u,
    );
    expect(await notice.getLocation("y")).toBeGreaterThanOrEqual(
      (await select.getLocation("y")) + (await select.getSize("height")),
    );
    await closeSettings();
    const [off] = await toolSearchTurn("E2E_TOOLSEARCH_SETTINGS_DEFAULT 检查默认模式。");
    expectToolSearchDisabled(off!);
    const offSession = (await getV4PaneSnapshot()).sessionId!;

    await setMode("auto", offSession);
    const [stillOff] = await toolSearchTurn("E2E_TOOLSEARCH_SETTINGS_ACTIVE Current session does not hot update.");
    expectToolSearchDisabled(stillOff!);
    await newToolSearchTask();
    const native = await toolSearchTurn(
      "E2E_TOOLSEARCH_SETTINGS_SEARCH Search TodoWrite and record completion.",
    );
    expect(native).toHaveLength(3);
    expectToolSearchUnloaded(native[0]!);
    expectToolSearchLoaded(native[1]!);
    expectSuccessfulTodo(native[2]!);
    await expectSearchSummary();
    const autoSession = (await getV4PaneSnapshot()).sessionId!;

    await switchV4Model(TOOLSEARCH_PLAIN_PROVIDER, TOOLSEARCH_MODEL, "");
    const [autoLocal] = await toolSearchTurn(
      "E2E_TOOLSEARCH_SETTINGS_PLAIN Plain provider uses local search.",
    );
    expectLocal(autoLocal!);
    expect(JSON.stringify(autoLocal!.requestJson.messages)).toContain("<functions>");
    await switchV4Model(TOOLSEARCH_PLAN_PROVIDER, TOOLSEARCH_MODEL, "");

    await setMode("local", autoSession);
    const [stillAuto] = await toolSearchTurn(
      "E2E_TOOLSEARCH_SETTINGS_ACTIVE_AUTO Current policy is still Auto.",
    );
    expectToolSearchLoaded(stillAuto!);
    await newToolSearchTask();
    const local = await toolSearchTurn(
      "E2E_TOOLSEARCH_SETTINGS_SEARCH After searching, record completion via wrapper entry.",
    );
    expect(local).toHaveLength(3);
    for (const request of local) {
      expectLocal(request);
      expect(request.requestJson.tools).toEqual(local[0]!.requestJson.tools);
    }
    expect(JSON.stringify(local[1]!.requestJson.messages)).toContain("<functions>");
    expectSuccessfulTodo(local[2]!);
    await expectSearchSummary();
    expect(toolSearchBlocks(local[2]!.requestJson)).toContainEqual(
      expect.objectContaining({
        type: "tool_use",
        id: "toolu_settings_todo",
        name: "DeferredToolCall",
      }),
    );
    const localSession = (await getV4PaneSnapshot()).sessionId!;

    await setMode("off", localSession);
    const [stillLocal] = await toolSearchTurn(
      "E2E_TOOLSEARCH_SETTINGS_ACTIVE_LOCAL 当前会话继续 Local。",
    );
    expectLocal(stillLocal!);
    const localWorkspacePath = await getActiveWorkspacePath();
    expect(localWorkspacePath).toBeTruthy();
    await restartIntoWorkspaceRestoringPreferences(localWorkspacePath!);
    await selectV4TaskById(localSession);
    await expectSearchSummary();
    const [coldOff] = await toolSearchTurn("E2E_TOOLSEARCH_SETTINGS_COLD_OFF 冷恢复读取 Off。");
    expectToolSearchDisabled(coldOff!);
    expectToolResultPair(coldOff!, "toolu_settings_search");
    expectToolResultPair(coldOff!, "toolu_settings_todo");
    expect(JSON.stringify(coldOff!.requestJson.messages)).not.toContain("<functions>");

    await setMode("auto", localSession);
    await restartIntoWorkspaceRestoringPreferences(localWorkspacePath!);
    await selectV4TaskById(localSession);
    const [coldAuto] = await toolSearchTurn("E2E_TOOLSEARCH_SETTINGS_COLD_AUTO Restore real search discoveries.");
    expectToolSearchLoaded(coldAuto!);
    expectToolResultPair(coldAuto!, "toolu_settings_search");
    expect(JSON.stringify(coldAuto!.requestJson.messages)).toContain('"type":"tool_reference"');
  });
});

async function expectSearchSummary() {
  const callId = "toolu_settings_search";
  const snapshot = await waitForToolCallBlockByToolCallId(callId);
  expect(snapshot.text).toMatch(/Search tools:TodoWrite|Search tools: TodoWrite/u);
  const block = await browser.$(`[data-testid="${snapshot.testId}"]`);
  const summary = await block.$(`[data-testid="${testId(TID_TOOL_SUMMARY_TRIGGER, callId)}"]`);
  expect(await summary.getAttribute("role")).not.toBe("button");
  expect(await summary.getAttribute("aria-expanded")).toBeNull();
  await summary.click();
  expect(await summary.getAttribute("aria-expanded")).toBeNull();
  expect(await block.$("pre").isExisting()).toBe(false);
  expect(await block.getText()).not.toMatch(/select:|max_results|Tool loaded\.|<functions>/u);
}

async function openSettings() {
  await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON, { timeout: 15_000 });
  await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"), { timeout: 15_000 });
  await browser
    .$(`[data-testid="${TID_SETTINGS_TOOL_SEARCH_SELECT}"]`)
    .waitForExist({ timeout: 15_000 });
}

async function closeSettings(sessionId?: string) {
  await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON, { timeout: 15_000 });
  await waitForV4Pane(
    (s) => (sessionId ? s.sessionId === sessionId : !!s.sessionId),
    "Settings failed to return session",
    30_000,
  );
}

async function setMode(mode: AppToolSearchMode, sessionId: string) {
  await openSettings();
  const select = await browser.$(`[data-testid="${TID_SETTINGS_TOOL_SEARCH_SELECT}"]`);
  await select.scrollIntoView();
  await select.click();
  const option = await browser.$(
    `[data-testid="${testId(TID_SETTINGS_TOOL_SEARCH_OPTION, mode)}"]`,
  );
  await option.waitForDisplayed({ timeout: 10_000 });
  await option.click();
  const labels = { auto: ["自动", "Auto"], local: ["本地", "Local"], off: ["关闭", "Off"] };
  await browser.waitUntil(
    async () =>
      (await readSettings()).toolSearchMode === mode &&
      labels[mode].includes(await select.getText()),
    { timeout: 15_000, timeoutMsg: `ToolSearch ${mode} Settings未CompletedSaveorRefresh` },
  );
  await closeSettings(sessionId);
}

function expectLocal(record: ToolSearchRecord) {
  expect(record.requestJson.tools?.some((tool) => tool.name === "ToolSearch")).toBe(true);
  expect(record.requestJson.tools?.some((tool) => tool.name === "DeferredToolCall")).toBe(true);
  expect(record.requestJson.tools?.some((tool) => tool.name === "TodoWrite")).toBe(false);
  expect(record.requestJson.tools?.some((tool) => "defer_loading" in tool)).toBe(false);
  expect(record.requestHeaders["anthropic-beta"] ?? "").not.toContain("advanced-tool-use");
  expect(JSON.stringify(record.requestJson.messages)).not.toContain('"type":"tool_reference"');
}

function expectSuccessfulTodo(record: ToolSearchRecord) {
  expectToolResultPair(record, "toolu_settings_search");
  expectToolResultPair(record, "toolu_settings_todo");
  const result = toolSearchBlocks(record.requestJson).find(
    (block) => block.tool_use_id === "toolu_settings_todo",
  );
  expect(result).toBeDefined();
  expect(result?.is_error).not.toBe(true);
  expect(JSON.parse(String(result?.content))).toMatchObject({
    todos: [
      { content: "E2E settings tool search verified", status: "completed", priority: "medium" },
    ],
  });
}
