import { getUpstreamRequestEvidence } from "../helpers/conversation-session-network.js";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  TID_WORKSPACE_FILE_TREE_ROW,
  TID_V4_COMPOSER_INPUT,
  TID_V4_SESSION_PANE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, DEFAULT_WORKSPACE } from "../helpers/desktop-app.js";
import { resolveE2ERuntimePath } from "../helpers/e2e-runtime-paths.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";
import { openProjectFileTree } from "../helpers/project-sidebar.js";

const filePath = resolveE2ERuntimePath("markdown-preview-selection", "selection.md");
const marker = "E2E_MARKDOWN_PREVIEW_SELECTED_PARAGRAPH";
describe("Markdown preview selection", () => {
  after(async () => {
    await rm(dirname(filePath), { recursive: true, force: true });
    await clearAppData();
  });
  it("MPS01/02/06/08/09: Add preview selection to draft, deduplicate, remove, and do not send automatically", async function () {
    this.timeout(120000);
    await prepareV4ConversationE2E();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `# Preview\n\n${marker}\n`, "utf8");
    await openProjectFileTree(DEFAULT_WORKSPACE, {
      timeoutMsg: "Workspace file tree action did not mount after hover",
    });
    for (const path of [dirname(filePath), filePath]) {
      const row = await $(`[data-testid="${testId(TID_WORKSPACE_FILE_TREE_ROW, path)}"]`);
      await row.waitForDisplayed({ timeout: 15000 });
      await row.click();
    }
    const preview = await $("[data-markdown-preview]");
    await preview.waitForDisplayed({ timeout: 15000 });
    const paneId = testId(TID_V4_SESSION_PANE, "workspace-main");
    await browser.execute(
      (paneTestId, inputTestId) => {
        const input = document.querySelector(
          `[data-testid="${paneTestId}"] [data-testid="${inputTestId}"]`,
        ) as HTMLElement & { __cfLexicalInputE2E?: { setText: (text: string) => void } };
        if (!input?.__cfLexicalInputE2E) throw new Error("Composer bridge missing");
        input.__cfLexicalInputE2E.setText("E2E_MARKDOWN_DRAFT_KEEP");
      },
      paneId,
      TID_V4_COMPOSER_INPUT,
    );
    for (let i = 0; i < 2; i++) {
      await browser.execute((text) => {
        const root = document.querySelector("[data-markdown-preview]")!;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.includes(text)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          node.parentElement!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return;
        }
        throw new Error("Preview text missing");
      }, marker);
      const action = await $('[data-conversation-selection-action="add-to-task"]');
      await action.waitForDisplayed({ timeout: 5000 });
      const layout = await browser.execute(() => {
        const menu = document.querySelector<HTMLElement>("[data-conversation-selection-tooltip]")!;
        const [add, side] = Array.from(menu.querySelectorAll("button")).map((button) =>
          button.getBoundingClientRect(),
        );
        if (!add || !side) throw new Error("Selection actions missing");
        const rect = menu.getBoundingClientRect();
        return {
          horizontal: Math.abs(add.top - side.top) < 1 && side.left >= add.right,
          adaptive: menu.style.width === "max-content",
          inside: rect.left >= 11 && rect.right <= innerWidth - 11,
        };
      });
      expect(layout).toEqual({ horizontal: true, adaptive: true, inside: true });
      if (i === 0 && process.env.CF_E2E_ARTIFACT_DIR) {
        await browser.saveScreenshot(
          join(process.env.CF_E2E_ARTIFACT_DIR, "markdown-selection-tooltip.png"),
        );
      }
      await action.click();
    }
    const chip = await $(
      `[data-testid="${paneId}"] [data-conversation-selection-reference-count="1"]`,
    );
    await chip.waitForDisplayed();
    expect(await chip.getText()).toContain("selection.md");
    if (process.env.CF_E2E_ARTIFACT_DIR) {
      await browser.saveScreenshot(
        join(process.env.CF_E2E_ARTIFACT_DIR, "markdown-selection-composer.png"),
      );
    }
    const state = await browser.execute(
      (paneTestId, inputTestId) => {
        const pane = document.querySelector(`[data-testid="${paneTestId}"]`)!;
        const input = pane.querySelector(`[data-testid="${inputTestId}"]`) as HTMLElement & {
          __cfLexicalInputE2E?: { getText: () => string };
        };
        return {
          session: pane.getAttribute("data-session-id"),
          text: input.__cfLexicalInputE2E?.getText(),
        };
      },
      paneId,
      TID_V4_COMPOSER_INPUT,
    );
    expect(state).toEqual({ session: "draft", text: "E2E_MARKDOWN_DRAFT_KEEP" });
    const remove = await $(
      `[data-testid="${paneId}"] button[aria-label="移除对话引用"], [data-testid="${paneId}"] button[aria-label="Remove conversation selection"]`,
    );
    await remove.click();
    await chip.waitForExist({ reverse: true });
    await browser.execute(() => {
      const paragraph = document.querySelector("[data-markdown-preview] p")!;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const addAgain = await $('[data-conversation-selection-action="add-to-task"]');
    await addAgain.waitForDisplayed();
    await addAgain.click();
    await sendV4Prompt("E2E_MARKDOWN_SIDE_PARENT Reply with a short acknowledgment.");
    await waitForV4TimelineContaining("E2E_MARKDOWN_SIDE_READY", 30000);
    const evidence = await getUpstreamRequestEvidence({
      lastUserMessageIncludes: ["E2E_MARKDOWN_SIDE_PARENT", "<conversation_quote>"],
      excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
    });
    expect(evidence.length).toBeGreaterThan(0);
    for (const record of evidence) {
      const { messages } = record.requestJson as {
        messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
      };
      const selections = messages
        .filter((message) => message.role === "user")
        .flatMap((message) =>
          typeof message.content === "string"
            ? [message.content]
            : message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text ?? ""),
        )
        .filter((text) => text.includes("E2E_MARKDOWN_SIDE_PARENT"))
        .flatMap((text) =>
          Array.from(
            text.matchAll(/<conversation_quote>\n([^]*?)\n<\/conversation_quote>/g),
            (match) => JSON.parse(match[1]!) as unknown,
          ),
        );
      expect(selections).toEqual([[{ path: filePath, text: marker }]]);
    }
    const historyChip = await $(
      `[data-testid="${paneId}"] [data-conversation-selection-reference-count="1"]`,
    );
    await historyChip.waitForDisplayed();
    expect(await historyChip.getText()).toContain("selection.md");
    await $(`[data-testid="${testId(TID_WORKSPACE_FILE_TREE_ROW, filePath)}"]`).click();
    await preview.waitForDisplayed({ timeout: 15000 });
    await browser.execute(
      (paneTestId, inputTestId) => {
        const input = document.querySelector(
          `[data-testid="${paneTestId}"] [data-testid="${inputTestId}"]`,
        ) as HTMLElement & { __cfLexicalInputE2E: { setText: (text: string) => void } };
        input.__cfLexicalInputE2E.setText("E2E_MARKDOWN_MAIN_KEEP");
      },
      paneId,
      TID_V4_COMPOSER_INPUT,
    );
    await browser.executeAsync((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    await browser.execute(() => {
      const paragraph = document.querySelector("[data-markdown-preview] p")!;
      const range = document.createRange();
      range.selectNodeContents(paragraph);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      paragraph.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    const sideAction = await $('[data-conversation-selection-action="ask-in-side-chat"]');
    await sideAction.waitForEnabled({ timeout: 15000 });
    await sideAction.click();
    const sideChip = await $(
      '[data-testid^="v4-session-pane-selection-side-chat:"] [data-conversation-selection-reference-count="1"]',
    );
    await sideChip.waitForDisplayed({ timeout: 30000 });
    expect(await sideChip.getText()).toContain("selection.md");
    const sideState = await browser.execute((inputTestId) => {
      const pane = document.querySelector('[data-testid^="v4-session-pane-selection-side-chat:"]')!;
      const input = pane.querySelector(`[data-testid="${inputTestId}"]`) as HTMLElement & {
        __cfLexicalInputE2E?: { getText: () => string };
      };
      const main = document.querySelector('[data-testid="v4-session-pane-workspace-main"]')!;
      const mainInput = main.querySelector(`[data-testid="${inputTestId}"]`) as typeof input;
      return {
        sideText: input.__cfLexicalInputE2E?.getText(),
        mainText: mainInput.__cfLexicalInputE2E?.getText(),
        distinct: pane.getAttribute("data-session-id") !== main.getAttribute("data-session-id"),
      };
    }, TID_V4_COMPOSER_INPUT);
    expect(sideState).toEqual({ sideText: "", mainText: "E2E_MARKDOWN_MAIN_KEEP", distinct: true });
    if (process.env.CF_E2E_ARTIFACT_DIR)
      await browser.saveScreenshot(
        join(process.env.CF_E2E_ARTIFACT_DIR, "markdown-side-conversation.png"),
      );
  });
});
