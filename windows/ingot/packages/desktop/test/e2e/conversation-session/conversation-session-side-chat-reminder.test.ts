import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  TID_V4_COMPOSER_INPUT,
  TID_V4_COMPOSER_SEND,
  TID_V4_SESSION_PANE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, getE2EAppDataPaths } from "../helpers/desktop-app.js";
import {
  getUpstreamRequestEvidence,
  waitForUpstreamRequest,
} from "../helpers/conversation-session-network.js";
import {
  buildReadonlyToolPrompt,
  ensureReadonlyToolFixtureFile,
  E2E_READONLY_TOOL_FILE_CONTENT,
} from "../helpers/conversation-session-readonly-tool.js";
import {
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Model,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "../helpers/v4-conversation.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
  ensureUpstreamModelForE2E,
} from "../helpers/upstream-provider.js";

const SCENARIOS = [
  { name: "non-mcs", model: UPSTREAM_MODEL, useMidConversationSystem: false },
  { name: "mcs", model: "claude-opus-4-8", useMidConversationSystem: true },
] as const;

const PARENT_MARKER = "E2E_SSC_REMINDER_SEED";
const CHILD_MARKER = "E2E_SSC_REMINDER_QUERY";
const CHILD_REPLY = "side-chat-ok";
const BOUNDARY_TEXT =
  "The preceding conversation was inherited from the parent task for reference only.";

describe("Side chat reminder E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  for (const scenario of SCENARIOS) {
    it(`SSC33: ${scenario.name} 下 side chat reminder 位于First messageIssue之前且仅出现One次`, async function () {
      this.timeout(240000);
      expect(process.env.E2E_PROVIDER_CAPTURE_MODE).toBe("replay");
      const parentMarker = `${PARENT_MARKER}_${scenario.name}`;
      const childPrompt = `${CHILD_MARKER}_${scenario.name}: 请只Reply ${CHILD_REPLY}，不使用Tools。`;
      await prepareV4ConversationE2E({ resetDraftBeforeProvider: true });
      await ensureUpstreamModelForE2E(scenario.model);
      await switchV4Model(UPSTREAM_PROVIDER_ID, scenario.model, "");
      await ensureReadonlyToolFixtureFile();
      await sendV4Prompt(buildReadonlyToolPrompt(parentMarker));
      const parent = await waitForV4Pane(
        (pane) =>
          Boolean(pane.sessionId && pane.sessionId !== "draft") &&
          !pane.canStop &&
          pane.timelineText.includes("upstream-e2e-ok"),
        "父会话未完成只读工具请求",
        120000,
      );
      if (!parent.sessionId) throw new Error("Parent session ID missing");
      await waitForUpstreamRequest(
        { includes: [parentMarker, E2E_READONLY_TOOL_FILE_CONTENT] },
        "Parent session did not return real read-only tool results",
      );
      const parentMessages = readMessages(parent.sessionId);

      const previousTabIds = await browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLElement>('[data-side-pane-tab-id^="selection-side-chat:"]'),
        ).map((tab) => tab.dataset.sidePaneTabId),
      );
      await openEmptySideChat();
      let childPaneId = "";
      await browser.waitUntil(
        async () => {
          childPaneId = await browser.execute(
            (previous) =>
              Array.from(
                document.querySelectorAll<HTMLElement>(
                  '[data-side-pane-tab-id^="selection-side-chat:"]',
                ),
              ).find((tab) => !previous.includes(tab.dataset.sidePaneTabId))?.dataset
                .sidePaneTabId ?? "",
            previousTabIds,
          );
          return Boolean(childPaneId);
        },
        { timeout: 30000, timeoutMsg: "Side chat tab was not created" },
      );
      const emptyChild = await waitForV4Pane(
        (pane) => Boolean(pane.sessionId && pane.sessionId !== "draft"),
        "Side chat session was not mounted",
        30000,
        childPaneId,
      );
      if (!emptyChild.sessionId) throw new Error("Child session ID missing");
      expect(readMessages(emptyChild.sessionId).at(-1)).toMatchObject({
        parts: [
          {
            synthetic: true,
            metadata: {
              source: "selection_side_chat",
              runtimeMessage: { source: "selection_side_chat" },
            },
          },
        ],
      });
      expect(emptyChild.sessionId).not.toBe(parent.sessionId);
      expect(emptyChild.rowCount).toBe(0);
      expect(emptyChild.timelineText).not.toContain(parentMarker);

      const childPane = $(`[data-testid="${testId(TID_V4_SESSION_PANE, childPaneId)}"]`);
      const childInput = childPane.$(`[data-testid="${TID_V4_COMPOSER_INPUT}"]`);
      await browser.waitUntil(
        async () => (await childInput.getAttribute("contenteditable")) === "true",
        {
          timeout: 15000,
          timeoutMsg: "Child composer 尚不可编辑",
        },
      );
      await childInput.click();
      await browser.keys(childPrompt);
      await browser.waitUntil(async () => (await childInput.getText()) === childPrompt, {
        timeout: 15000,
        timeoutMsg: "首条用户消息没有进入 child composer",
      });
      const childSend = childPane.$(`[data-testid="${TID_V4_COMPOSER_SEND}"]`);
      await childSend.waitForClickable();
      await childSend.click();
      await waitForUpstreamRequest(
        { lastUserMessageIncludes: [childPrompt] },
        "First user message in side chat did not reach provider",
        60000,
      );
      const childRequests = await getUpstreamRequestEvidence({
        lastUserMessageIncludes: [childPrompt],
      });
      const firstRequest = childRequests[0];
      if (!firstRequest) throw new Error("Child first request missing");
      const body = JSON.stringify(firstRequest.requestJson);
      expect(body).toContain(parentMarker);
      expect(body).toContain(E2E_READONLY_TOOL_FILE_CONTENT);
      expect(body).toContain(childPrompt);
      expect(body.split(BOUNDARY_TEXT)).toHaveLength(2);
      const request = firstRequest.requestJson as {
        model: string;
        messages: Array<{
          role: string;
          content: string | Array<{ type: string; text?: string }>;
        }>;
      };
      expect(request.model).toBe(scenario.model);
      const boundaryIndex = request.messages.findIndex((message) =>
        JSON.stringify(message.content).includes(BOUNDARY_TEXT),
      );
      const questionIndex = request.messages.findIndex((message) =>
        JSON.stringify(message.content).includes(childPrompt),
      );
      const boundaryMessage = request.messages[boundaryIndex]!;
      const { useMidConversationSystem } = scenario;
      const hasOtherSystemMessages = request.messages.some((message) => message.role === "system");
      expect(hasOtherSystemMessages).toBe(useMidConversationSystem);
      expect(boundaryMessage.role).toBe("user");
      expect(boundaryIndex).toBe(questionIndex);
      expect(boundaryMessage.content).toMatchObject([
        { type: "text", text: expect.stringContaining(`<system-reminder>\n${BOUNDARY_TEXT}`) },
        { type: "text", text: childPrompt },
      ]);
      expect(JSON.stringify(boundaryMessage.content)).toContain("</system-reminder>");

      await waitForV4AssistantMessageContaining(CHILD_REPLY, 120000, childPaneId);
      await waitForV4Pane(
        (pane) => !pane.canStop && pane.rowCount === 2,
        "Side chat first turn was not completed",
        120000,
        childPaneId,
      );
      expect(readMessages(parent.sessionId)).toEqual(parentMessages);
      expect((await getV4PaneSnapshot()).timelineText).not.toContain(childPrompt);
    });
  }
});

async function openEmptySideChat(): Promise<void> {
  const inputSelector = `[data-testid="${testId(TID_V4_SESSION_PANE, "workspace-main")}"] [data-testid="${TID_V4_COMPOSER_INPUT}"]`;
  await $(inputSelector).click();
  await browser.keys(["/", "b", "t", "w"]);
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const option = document.querySelector<HTMLElement>('[data-option-id="app-slash:btw"]');
        if (!option) return false;
        option.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }),
        );
        return true;
      }),
    { timeout: 15000, timeoutMsg: "Bare /btw did not show side chat options" },
  );
}

function readMessages(sessionId: string): unknown[] {
  const db = new DatabaseSync(
    join(getE2EAppDataPaths().homeDir, ".cf", "cli", "db", "db.sqlite"),
    { readOnly: true },
  );
  try {
    return db
      .prepare("select id, data from message where session_id = ? order by time_created, id")
      .all(sessionId)
      .map((message) => ({
        info: { id: message.id, ...JSON.parse(String(message.data)) },
        parts: db
          .prepare("select id, data from part where message_id = ? order by time_created, id")
          .all(String(message.id))
          .map((part) => ({ id: part.id, ...JSON.parse(String(part.data)) })),
      }));
  } finally {
    db.close();
  }
}
