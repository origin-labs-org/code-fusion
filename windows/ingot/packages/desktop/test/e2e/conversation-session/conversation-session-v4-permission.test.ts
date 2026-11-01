import { access, mkdir, rm } from "node:fs/promises";
import { clearAppData } from "../helpers/desktop-app.js";
import { resolveE2ERuntimePath, resolveE2EToolPath } from "../helpers/e2e-runtime-paths.js";
import {
  approveV4Permission,
  denyV4PermissionWithFeedback,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4PermissionDialogInComposerDock,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";
import { getLatestUpstreamToolResultByToolCallId } from "../helpers/conversation-session-network.js";

const V4_PERMISSION_CASE = "conversation-session-v4-permission";
const V4_PERMISSION_DIR = resolveE2ERuntimePath(V4_PERMISSION_CASE);
const V4_PERMISSION_OUTPUT_PATH = resolveE2EToolPath(V4_PERMISSION_CASE, "write-output.txt");
const V4_PERMISSION_ALLOW_FEEDBACK_OUTPUT_PATH = resolveE2EToolPath(
  V4_PERMISSION_CASE,
  "allow-feedback-output.txt",
);
const V4_PERMISSION_DENY_OUTPUT_PATH = resolveE2EToolPath(V4_PERMISSION_CASE, "deny-output.txt");
const V4_PERMISSION_DENY_BLANK_OUTPUT_PATH = resolveE2EToolPath(
  V4_PERMISSION_CASE,
  "deny-blank-output.txt",
);
const V4_PERMISSION_ALLOW_FEEDBACK = "This note must be ignored when allowing the tool.";
const V4_PERMISSION_DENY_FEEDBACK =
  "Do not write the file; explain that the requested change needs clarification first. " +
  "Additional context: " +
  "x".repeat(600);
const V4_PERMISSION_DENY_BASE_CONTENT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

describe("v4 M4 门禁：resolveInteraction 收口权限请求", () => {
  before(async () => {
    await rm(V4_PERMISSION_DIR, { recursive: true, force: true });
    await mkdir(V4_PERMISSION_DIR, { recursive: true });
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
    await rm(V4_PERMISSION_DIR, { recursive: true, force: true });
  });

  it("默认模式 Write 工具触发权限弹窗，批准后工具执行并出终态文本", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt(`E2E_V4_PERMISSION_WRITE 请WriteFile ${V4_PERMISSION_OUTPUT_PATH}`);

    const dockState = await waitForV4PermissionDialogInComposerDock();
    await expect($('[data-testid="v4-pending-interaction-top-notice"]')).not.toExist();
    expect(dockState.inDock).toBe(true);
    expect(dockState.composerHidden).toBe(true);
    expect(dockState.interactionBeforeComposer).toBe(true);
    expect(await readPermissionFeedbackTextareaSemantics()).toEqual({
      tagName: "TEXTAREA",
      rows: "1",
      autoSizing: true,
      maxRows: true,
      index: "5.",
      indexCenteredOnFirstLine: true,
      rowGaps: [4, 4, 4, 4],
    });

    const dismissed = await approveV4Permission();
    expect(dismissed).toBe(true);

    await waitForV4TimelineContaining("V4_PERMISSION_DONE", 60000);
  });

  it("批准时填写的反馈被忽略，工具仍按 Allow once 执行", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt(
      `E2E_V4_PERMISSION_ALLOW_FEEDBACK 请WriteFile ${V4_PERMISSION_ALLOW_FEEDBACK_OUTPUT_PATH}`,
    );
    await waitForV4PermissionDialogInComposerDock();

    expect(await approveV4Permission(V4_PERMISSION_ALLOW_FEEDBACK)).toBe(true);
    await waitForV4TimelineContaining("V4_PERMISSION_ALLOW_FEEDBACK_DONE", 60000);

    const allowedResult = await getLatestUpstreamToolResultByToolCallId(
      "toolu_v4_permission_allow_feedback",
    );
    expect(allowedResult?.isError).toBe(false);
    expect(allowedResult?.content).not.toContain(V4_PERMISSION_ALLOW_FEEDBACK);
    await expectFileExists(V4_PERMISSION_ALLOW_FEEDBACK_OUTPUT_PATH);
  });

  for (const submitWithEnter of [true, false]) {
    it(`第 5 行填写Feedback并${submitWithEnter ? "回车" : "确认"}，Feedback进入同One个 provider-visible tool_result 且Tools不execute`, async () => {
      await prepareV4ConversationE2E();

      await sendV4Prompt(
        `E2E_V4_PERMISSION_DENY_FEEDBACK 请WriteFile ${V4_PERMISSION_DENY_OUTPUT_PATH}`,
      );
      await waitForV4PermissionDialogInComposerDock();

      const input = await $(
        'textarea[aria-label="拒绝时给模型的可选反馈"],textarea[aria-label="拒绝时给模型的可选反馈"]',
      );
      const allow = await $('[data-permission-option-kind="allowOnce"]');
      const deny = await $('[data-permission-option-kind^="reject"]');
      await expect(allow).toBeFocused();
      await browser.keys("ArrowUp");
      await expect(input).toBeFocused();
      expect((await readPermissionFeedbackTextareaSemantics()).index).toBe("5.");
      expect(await deny.getAttribute("aria-selected")).toBe("false");
      await browser.keys("ArrowUp");
      await expect(deny).toBeFocused();
      expect(
        await browser.execute(() =>
          document
            .querySelector(
              'textarea[aria-label="拒绝时给模型的可选反馈"],textarea[aria-label="拒绝时给模型的可选反馈"]',
            )
            ?.parentElement?.classList.contains("bg-selected"),
        ),
      ).toBe(false);
      await browser.keys("Tab");
      await expect(input).toBeFocused();
      await browser.keys(["Shift", "Tab"]);
      await expect(deny).toBeFocused();
      await browser.keys("ArrowDown");
      await expect(input).toBeFocused();

      expect(await denyV4PermissionWithFeedback(V4_PERMISSION_DENY_FEEDBACK, submitWithEnter)).toBe(
        true,
      );
      await waitForV4TimelineContaining("V4_PERMISSION_DENY_DONE", 60000);

      const deniedResult = await getLatestUpstreamToolResultByToolCallId(
        "toolu_v4_permission_deny_feedback",
      );
      expect(deniedResult?.isError).toBe(true);
      expect(deniedResult?.content).toBe(
        V4_PERMISSION_DENY_BASE_CONTENT +
          " To tell you how to proceed, the user said:\n" +
          V4_PERMISSION_DENY_FEEDBACK,
      );
      await expectFileMissing(V4_PERMISSION_DENY_OUTPUT_PATH);
    });
  }

  it("拒绝时只有空白反馈，provider-visible tool_result 保持基础 Deny 文案", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt(
      `E2E_V4_PERMISSION_DENY_BLANK 请WriteFile ${V4_PERMISSION_DENY_BLANK_OUTPUT_PATH}`,
    );
    await waitForV4PermissionDialogInComposerDock();

    expect(await denyV4PermissionWithFeedback("   ")).toBe(true);
    await waitForV4TimelineContaining("V4_PERMISSION_DENY_BLANK_DONE", 60000);

    const deniedResult = await getLatestUpstreamToolResultByToolCallId(
      "toolu_v4_permission_deny_blank",
    );
    expect(deniedResult?.isError).toBe(true);
    expect(deniedResult?.content).toBe(V4_PERMISSION_DENY_BASE_CONTENT);
    expect(deniedResult?.content).not.toContain("To tell you how to proceed");
    await expectFileMissing(V4_PERMISSION_DENY_BLANK_OUTPUT_PATH);
  });
});

async function expectFileExists(path: string) {
  const exists = await access(path)
    .then(() => true)
    .catch(() => false);
  expect(exists).toBe(true);
}

async function expectFileMissing(path: string) {
  const exists = await access(path)
    .then(() => true)
    .catch(() => false);
  expect(exists).toBe(false);
}

async function readPermissionFeedbackTextareaSemantics() {
  return browser.execute(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="拒绝时给模型的可选反馈"],textarea[aria-label="拒绝时给模型的可选反馈"]',
    );
    const style = textarea ? getComputedStyle(textarea) : null;
    const indexRect = textarea?.previousElementSibling?.getBoundingClientRect();
    const feedbackRow = textarea?.parentElement;
    const rowRects = [
      ...Array.from(
        feedbackRow?.previousElementSibling?.querySelectorAll("[data-permission-option-kind]") ??
          [],
      ),
      ...(feedbackRow ? [feedbackRow] : []),
    ].map((row) => row.getBoundingClientRect());
    return {
      tagName: textarea?.tagName ?? null,
      rows: textarea?.getAttribute("rows") ?? null,
      autoSizing: textarea?.classList.contains("field-sizing-content") ?? false,
      maxRows: textarea?.classList.contains("max-h-[5lh]") ?? false,
      index: textarea?.previousElementSibling?.textContent ?? null,
      rowGaps: rowRects.slice(1).map((rect, index) => rect.top - rowRects[index]!.bottom),
      indexCenteredOnFirstLine: Boolean(
        textarea &&
        style &&
        indexRect &&
        Math.abs(
          indexRect.top +
            indexRect.height / 2 -
            (textarea.getBoundingClientRect().top +
              parseFloat(style.borderTopWidth) +
              parseFloat(style.paddingTop) +
              parseFloat(style.lineHeight) / 2),
        ) <= 0.5,
      ),
    };
  });
}
