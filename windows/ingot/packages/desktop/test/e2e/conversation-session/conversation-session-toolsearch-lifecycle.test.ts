import { expandAssistantHistoriesWithContent } from "../helpers/conversation-session-tool-diagnostics.js";
import { clearAppData } from "../helpers/desktop-app.js";
import { restartIntoWorkspace } from "../helpers/model-provider-restart.js";
import {
  editFirstV4UserQuery,
  getV4PaneSnapshot,
  selectV4TaskById,
  switchV4Model,
  waitForV4Edit,
  waitForV4Fork,
  waitForV4Pane,
} from "../helpers/v4-conversation.js";
import {
  readToolSearchRequests,
  TOOLSEARCH_TODO_CALL_ID,
  TOOLSEARCH_NOTICE,
} from "../helpers/toolsearch-provider.js";
import {
  compactToolSearchTask,
  expectToolResultPair,
  expectToolSearchDisabled,
  newToolSearchTask,
  setupToolSearchDesktop,
  TOOLSEARCH_MODEL,
  TOOLSEARCH_PLAIN_PROVIDER,
  TOOLSEARCH_PLAN_PROVIDER,
  toolSearchTurn,
} from "../helpers/toolsearch-desktop.js";

describe("ToolSearch provider、续写和历史生命周期", () => {
  before(async () => {
    await setupToolSearchDesktop();
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("TS03: Switching providers both ways in the same session keeps ToolSearch disabled by default", async function () {
    this.timeout(180_000);
    await newToolSearchTask();
    await toolSearchTurn("E2E_TOOLSEARCH_INITIAL searches TodoWrite and executes.");
    const sessionId = (await getV4PaneSnapshot()).sessionId;
    await switchV4Model(TOOLSEARCH_PLAIN_PROVIDER, TOOLSEARCH_MODEL, "");
    const [off] = await toolSearchTurn("E2E_TOOLSEARCH_OFF Continue.");
    expectToolSearchDisabled(off!);
    expectToolResultPair(off!, TOOLSEARCH_TODO_CALL_ID);
    expect(JSON.stringify(off!.requestJson.messages)).not.toContain("tool_reference");
    await switchV4Model(TOOLSEARCH_PLAN_PROVIDER, TOOLSEARCH_MODEL, "");
    const [on] = await toolSearchTurn("E2E_TOOLSEARCH_ON Continue.");
    expectToolSearchDisabled(on!);
    expectToolResultPair(on!, TOOLSEARCH_TODO_CALL_ID);
    expect(JSON.stringify(on!.requestJson.messages)).not.toContain('"type":"tool_reference"');
    expect((await getV4PaneSnapshot()).sessionId).toBe(sessionId);
  });

  it("TS09: When disabled by default, neither three Continues nor cold recovery add new tool announcements", async function () {
    this.timeout(120_000);
    await newToolSearchTask();
    const requests = await toolSearchTurn("E2E_TOOLSEARCH_CONTINUE End after three continuations.");
    expect(requests).toHaveLength(4);
    for (const request of requests) expectToolSearchDisabled(request);
    const [next] = await toolSearchTurn("E2E_TOOLSEARCH_AFTER_CONTINUE Normal next round.");
    expectToolSearchDisabled(next!);
    const text = JSON.stringify(next!.requestJson.messages);
    expect(text).toContain("E2E_TOOLSEARCH_PARTIAL_1");
    expect(text).toContain("E2E_TOOLSEARCH_PARTIAL_3");
    expect(text).not.toContain("Output token limit hit. Resume directly");
    const sessionId = (await getV4PaneSnapshot()).sessionId!;
    await restartIntoWorkspace();
    await selectV4TaskById(sessionId);
    const [cold] = await toolSearchTurn("E2E_TOOLSEARCH_COLD_CONTINUE Check cold recovery of continuation.");
    expectToolSearchDisabled(cold!);
    const coldText = JSON.stringify(cold!.requestJson.messages);
    expect(coldText).toContain("E2E_TOOLSEARCH_PARTIAL_1");
    expect(coldText).toContain("E2E_TOOLSEARCH_PARTIAL_3");
    expect(coldText).not.toContain("Output token limit hit. Resume directly");
  });

  for (const disabledDuringCompact of [false, true]) {
    it(`TS04: ${disabledDuringCompact ? "普通 provider" : "Coding Plan"} DefaultClose期间 compact 后冷恢复`, async function () {
      this.timeout(240_000);
      await newToolSearchTask();
      await toolSearchTurn("E2E_TOOLSEARCH_INITIAL Search, execute, and compact.");
      const sessionId = (await getV4PaneSnapshot()).sessionId!;
      if (disabledDuringCompact)
        await switchV4Model(TOOLSEARCH_PLAIN_PROVIDER, TOOLSEARCH_MODEL, "");
      await compactToolSearchTask();
      const [after] = await toolSearchTurn("E2E_TOOLSEARCH_AFTER_COMPACT Verify requests after compact.");
      if (disabledDuringCompact) expectToolSearchDisabled(after!);
      else {
        expectToolSearchDisabled(after!);
      }
      expect(JSON.stringify(after!.requestJson.messages)).not.toContain(TOOLSEARCH_TODO_CALL_ID);
      await restartIntoWorkspace();
      await selectV4TaskById(sessionId);
      await switchV4Model(TOOLSEARCH_PLAN_PROVIDER, TOOLSEARCH_MODEL, "");
      const cold = await toolSearchTurn("E2E_TOOLSEARCH_COLD_COMPACT Check first request.");
      expect(cold).toHaveLength(1);
      expectToolSearchDisabled(cold[0]!);
      expect(JSON.stringify(cold[0]!.requestJson.messages)).not.toContain(TOOLSEARCH_TODO_CALL_ID);
    });
  }

  it("TS05: 默认关闭时 fork 旧稳定轮不继承未来工具调用", async function () {
    this.timeout(180_000);
    await newToolSearchTask();
    await toolSearchTurn("E2E_TOOLSEARCH_SEED Stable round before search.");
    const parentId = (await getV4PaneSnapshot()).sessionId!;
    await waitForV4Fork();
    const forkTestId = await browser.$('[data-testid^="v4-fork-"]').getAttribute("data-testid");
    await toolSearchTurn("E2E_TOOLSEARCH_INITIAL Now search TodoWrite.");
    await expandAssistantHistoriesWithContent();
    const forkButton = await browser.$(`[data-testid="${forkTestId}"]`);
    await forkButton.$("..").moveTo();
    await forkButton.click();
    await waitForV4Pane(
      (s) => !!s.sessionId && s.sessionId !== "draft" && s.sessionId !== parentId,
      "fork 未切换到子分支",
      30_000,
    );
    const [child] = await toolSearchTurn("E2E_TOOLSEARCH_FORK Check tool pool at fork point.");
    expectToolSearchDisabled(child!);
    await selectV4TaskById(parentId);
    const [parent] = await toolSearchTurn("E2E_TOOLSEARCH_AFTER_FORK Parent branch check.");
    expectToolSearchDisabled(parent!);
    expectToolResultPair(parent!, TOOLSEARCH_TODO_CALL_ID);
  });

  it("TS05: 默认关闭时编辑首轮不带回旧工具调用", async function () {
    this.timeout(120_000);
    await newToolSearchTask();
    await toolSearchTurn("E2E_TOOLSEARCH_INITIAL Original search round.");
    const before = (await readToolSearchRequests()).length;
    await waitForV4Edit();
    await editFirstV4UserQuery("E2E_TOOLSEARCH_EDITED New branch without search.");
    await browser.waitUntil(async () => (await readToolSearchRequests()).length > before, {
      timeout: 45_000,
    });
    await waitForV4Pane((s) => !s.canStop, "Edit rerun has not finished", 30_000);
    const edited = (await readToolSearchRequests())[before]!;
    expectToolSearchDisabled(edited);
    expect(JSON.stringify(edited.requestJson.messages)).not.toContain(TOOLSEARCH_TODO_CALL_ID);
    expect(JSON.stringify(edited.requestJson.messages)).not.toContain(TOOLSEARCH_NOTICE);
  });
});
