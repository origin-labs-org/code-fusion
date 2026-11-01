import {
  TID_V4_EDIT_ATTACHMENT_REMOVE,
  TID_V4_EDIT_SUBMIT,
  TID_V4_ROW_ATTACHMENTS,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, clickTestIdByDom } from "../helpers/desktop-app.js";
import {
  beginFirstV4UserQueryEdit,
  clickV4Send,
  pasteV4ComposerImageAttachment,
  prepareV4ConversationE2E,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 T06 + D12: Attachment-only sending and deleting attachments via edit", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Attachment-only initial send → edit delete one → active branch and provider only retain remaining refs", async () => {
    await prepareV4ConversationE2E();

    const removedFilename = await pasteV4ComposerImageAttachment("e2e-remove-me.png");
    const keptFilename = await pasteV4ComposerImageAttachment("e2e-keep-me.png");

    await clickV4Send();

    await waitForV4TimelineContaining("V4_ATTACHMENT_ONLY_SEND_OK", 45000);
    await waitForV4Pane(
      (s) => !s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "仅附件首发后没有回到空闲态且绑定 session",
      45000,
    );

    await waitForV4ImageAttachments([removedFilename, keptFilename], 30000);

    const clickedPreview = await browser.execute(
      (attachmentsPrefix, filename) => {
        const cards = Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-testid^="${attachmentsPrefix}-"] [data-v4-user-input-media-attachment="true"]`,
          ),
        );
        const target = cards.find(
          (candidate) => candidate.querySelector<HTMLImageElement>("img")?.alt === filename,
        );
        target?.click();
        return Boolean(target);
      },
      TID_V4_ROW_ATTACHMENTS,
      keptFilename,
    );
    expect(clickedPreview).toBe(true);
    await browser.waitUntil(
      async () =>
        browser.execute((filename) => {
          const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
          const image = dialog?.querySelector<HTMLImageElement>(`img[alt="${filename}"]`);
          return Boolean(image?.src.startsWith("blob:"));
        }, keptFilename),
      { timeout: 15000, timeoutMsg: "Blob image preview did not open upon clicking sent image" },
    );
    await browser.keys(["Escape"]);

    const rowId = await beginFirstV4UserQueryEdit("");
    await clickTestIdByDom(testId(TID_V4_EDIT_ATTACHMENT_REMOVE, `${rowId}-0`), {
      timeout: 15000,
      timeoutMsg: `v4 edit 第One个AttachmentDelete按钮没有出现: rowId=${rowId}`,
    });
    await clickTestIdByDom(testId(TID_V4_EDIT_SUBMIT, rowId), {
      timeout: 15000,
      timeoutMsg: `v4 仅Attachment edit Submit按钮不可点击: rowId=${rowId}`,
    });

    await waitForV4TimelineContaining("V4_ATTACHMENT_EDIT_ONE_OK", 45000);
    await waitForV4ImageAttachments([keptFilename], 30000);
  });
});

async function waitForV4ImageAttachments(expectedFilenames: string[], timeout: number) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (attachmentsPrefix, expected) => {
          const cards = Array.from(
            document.querySelectorAll<HTMLElement>(
              `[data-testid^="${attachmentsPrefix}-"] [data-v4-user-input-media-attachment="true"]`,
            ),
          );
          return (
            cards.length === expected.length &&
            cards.every((card, index) => {
              const image = card.querySelector<HTMLImageElement>("img");
              return (
                card.getAttribute("role") === "button" &&
                image?.alt === expected[index] &&
                image?.src.startsWith("blob:") === true
              );
            })
          );
        },
        TID_V4_ROW_ATTACHMENTS,
        expectedFilenames,
      ),
    { timeout, timeoutMsg: `user 行ImageAttachment没有按原顺序收敛: ${expectedFilenames.join(", ")}` },
  );
}
