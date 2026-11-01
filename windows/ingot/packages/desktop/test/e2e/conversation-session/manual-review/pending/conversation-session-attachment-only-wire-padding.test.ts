import { TID_V4_COMPOSER_INPUT } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../../../helpers/desktop-app.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";
import {
  clickV4Send,
  prepareV4ConversationE2E,
  waitForV4Pane,
  waitForV4RowAttachments,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const CASE_TIMEOUT_MS = 120_000;
const FILENAME = "e2e-attachment-wire-padding.txt";
const ATTACHMENT_CONTENT = "E2E_ATTACHMENT_WIRE_CONTEXT";
const REPLY_MARKER = "ATTACHMENT_WIRE_PADDING_OK";

describe("T06W：attachment-only provider wire padding", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Empty body attachment initial send only appends a single space in provider wire user content", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await prepareV4ConversationE2E();
    expect(await pasteTextAttachment()).toBe(true);
    await clickV4Send();

    const capture = await waitForUpstreamNetworkCapture(ATTACHMENT_CONTENT);
    expect(readUserWireTextParts(capture.requestJson)).toContain(" ");
    await waitForV4TimelineContaining(REPLY_MARKER, 60_000);
    await waitForV4Pane(
      (snapshot) =>
        !snapshot.canStop && Boolean(snapshot.sessionId && snapshot.sessionId !== "draft"),
      "T06W did not return to completed session after attachment-only initial send",
      60_000,
    );

    const attachmentsText = await waitForV4RowAttachments(30_000);
    expect(attachmentsText).toContain(FILENAME);
  });
});

async function pasteTextAttachment(): Promise<boolean> {
  return browser.execute(
    (inputTestId, filename, content) => {
      const input = document.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
      const editable =
        input?.querySelector<HTMLElement>('[contenteditable="true"]') ??
        (input?.getAttribute("contenteditable") === "true" ? input : null);
      if (!editable) return false;

      const clipboard = new DataTransfer();
      clipboard.items.add(new File([content], filename, { type: "text/plain" }));
      editable.focus();
      editable.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: clipboard,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    },
    TID_V4_COMPOSER_INPUT,
    FILENAME,
    ATTACHMENT_CONTENT,
  );
}

function readUserWireTextParts(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];

  const parts: string[] = [];
  for (const message of messages) {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { role?: unknown }).role !== "user"
    ) {
      continue;
    }
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      parts.push(content);
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        parts.push((part as { text: string }).text);
      }
    }
  }
  return parts;
}
