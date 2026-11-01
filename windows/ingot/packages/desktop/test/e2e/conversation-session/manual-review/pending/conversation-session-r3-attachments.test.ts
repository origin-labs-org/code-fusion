import { mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  TID_V4_COMPOSER_INPUT,
  TID_CHAT_ATTACHMENT_BUTTON,
  TID_CHAT_ATTACHMENT_MENU_ITEM,
} from "@origin-ai/cf-shared/test-ids";
import { clearAppData, DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestRecordCount,
  getUpstreamRequestEvidence,
  waitForUpstreamRequest,
} from "../../../helpers/conversation-session-network.js";
import {
  connectSSHWorkspaceAndSendFirstTurn,
  prepareSSHLifecycle,
  type SSHLifecycleProvider,
} from "../../../helpers/ssh-remote-lifecycle.js";
import { readRemoteTabSnapshot, runSSHCommand } from "../../../helpers/ssh-remote-p0.js";
import {
  clickV4Send,
  pasteV4ComposerFileAttachment,
  setV4ComposerText,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
  waitForV4RowAttachments,
} from "../../../helpers/v4-conversation.js";

const CASE_MARKER = "E2E_R3_ATTACHMENTS";
const E2E_HOME_DIR = dirname(DEFAULT_WORKSPACE);
const artifactDir = resolve(process.env.CF_E2E_ARTIFACT_DIR ?? ".e2e-artifacts/r3-attachments");
const NATIVE_FILE = "r3-dev04-native.txt";
const NATIVE_MARKER = `R3_NATIVE_MARKER_${Math.random().toString(36).slice(2, 10)}`;
const nativePath = resolve(DEFAULT_WORKSPACE, ".cf-e2e/r3-attachments", NATIVE_FILE);
const TEXT_FILE = "r3-dev04-note.txt";
const IMAGE_FILE = "r3-dev04-image.png";
const PDF_FILE = "r3-dev04-doc.pdf";
const IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4AWMAAQAABQABNtCI3QAAAABJRU5ErkJggg==";
const TEXT_MARKER = `R3_DEV04_TEXT_MARKER_${Math.random().toString(36).slice(2, 10)}`;
const MINIMAL_PDF = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`;

async function readComposerAttachmentStatuses(): Promise<
  Array<{ name: string; kind: string | null; status: string | null }>
> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-composer-attachment-kind]")).map(
      (card) => ({
        name: (
          card.getAttribute("title") ??
          card.querySelector("img[alt]")?.getAttribute("alt") ??
          card.innerText.trim()
        ).slice(0, 80),
        kind: card.dataset.composerAttachmentKind ?? null,
        status: card.dataset.uploadStatus ?? null,
      }),
    ),
  );
}

async function localHomeContains(marker: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const { stdout } = await run("grep", ["-rl", "--exclude-dir=run-logs", marker, E2E_HOME_DIR], {
      maxBuffer: 1 << 22,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

describe(`${CASE_MARKER}: 远端 workspace Attachment上传、远端ToolsRead与 scope Isolated`, () => {
  let provider: SSHLifecycleProvider | null = null;
  const facts: Record<string, unknown> = {};

  after(async () => {
    await mkdir(artifactDir, { recursive: true });
    await writeFile(resolve(artifactDir, "attachments.json"), JSON.stringify(facts, null, 2));
    await provider?.tunnel.close().catch(() => undefined);
    provider = null;
    await browser.electron.restoreAllMocks();
    await rm(dirname(nativePath), { recursive: true, force: true });
    await clearAppData();
  });

  it("R3A-DEV-04 Text/image/PDF attachments uploaded to remote scope via UI; request references remote readable content; native local paths staged across machines; clear status on removal/failure", async function () {
    this.timeout(30 * 60_000);
    const prepared = await prepareSSHLifecycle(CASE_MARKER, {
      apiType: "anthropic-messages",
      tunnelUsername: "tunnel",
    });
    provider = prepared.provider;
    const [workspaceA] = prepared.config.workspacePaths;
    const taskA = await connectSSHWorkspaceAndSendFirstTurn({
      caseMarker: CASE_MARKER,
      config: prepared.config,
      label: "A",
      provider,
      workspacePath: workspaceA,
    });
    const remoteBefore = await runSSHCommand(
      prepared.config,
      `grep -rl "${TEXT_MARKER}" "$HOME" 2>/dev/null | head -n 5; echo __END__`,
    );
    expect(remoteBefore.stdout.split("__END__")[0]!.trim()).toBe("");

    await setV4ComposerText(`${CASE_MARKER}_ATTACH 请ReadAttachment并Reply`);
    await pasteV4ComposerFileAttachment(TEXT_FILE, {
      base64: Buffer.from(`${TEXT_MARKER}\nsecond line\n`, "utf8").toString("base64"),
      mimeType: "text/plain",
    });
    await pasteV4ComposerFileAttachment(IMAGE_FILE, { base64: IMAGE_BASE64 });
    await pasteV4ComposerFileAttachment(PDF_FILE, {
      base64: Buffer.from(MINIMAL_PDF, "latin1").toString("base64"),
      mimeType: "application/pdf",
    });
    await mkdir(dirname(nativePath), { recursive: true });
    await writeFile(nativePath, `${NATIVE_MARKER}\n`, "utf8");
    const picker = await browser.electron.mock("dialog", "showOpenDialog");
    await picker.mockResolvedValue({ canceled: false, filePaths: [nativePath] });
    const attachmentButton = $(`[data-testid="${TID_CHAT_ATTACHMENT_BUTTON}"]`);
    await attachmentButton.click();
    const attachmentMenu = $(`[data-testid="${TID_CHAT_ATTACHMENT_MENU_ITEM}"]`);
    await attachmentMenu.waitForDisplayed({ timeout: 15_000 });
    await attachmentMenu.click();
    let statuses = await readComposerAttachmentStatuses();
    await browser.waitUntil(
      async () => {
        statuses = await readComposerAttachmentStatuses();
        return statuses.length === 4 && statuses.every((s) => s.status === "ready");
      },
      {
        timeout: 60_000,
        interval: 500,
        timeoutMsg: `${CASE_MARKER}: 四个Attachment没有Completed eager upload: ${JSON.stringify(statuses)}`,
      },
    );
    facts.composerAttachments = statuses;
    const stagedNative = await runSSHCommand(
      prepared.config,
      `find "$HOME/.cf/tmp/prompt-attachments" -type f -name '*${NATIVE_FILE}' -exec cat {} +`,
    );
    expect(stagedNative.code).toBe(0);
    expect(stagedNative.stdout).toContain(NATIVE_MARKER);
    facts.nativeFileStagedOnSource = true;
    const requestStart = await getUpstreamRequestRecordCount();
    await clickV4Send();
    const rowAttachments = await waitForV4RowAttachments(60_000, [
      TEXT_FILE,
      NATIVE_FILE,
      IMAGE_FILE,
      PDF_FILE,
    ]);
    facts.rowAttachments = rowAttachments;
    expect(rowAttachments).toContain(TEXT_FILE);
    expect(rowAttachments).toContain(NATIVE_FILE);
    expect(rowAttachments).toContain(IMAGE_FILE);
    expect(rowAttachments).toContain(PDF_FILE);
    await waitForUpstreamRequest(
      {
        lastUserMessageIncludes: [`${CASE_MARKER}_ATTACH`],
        includes: [TEXT_MARKER, NATIVE_MARKER],
      },
      `${CASE_MARKER}: Attachment回合MissingPasted textor远端 Read Result`,
      90_000,
      { afterIndex: requestStart - 1 },
    );
    facts.textAndNativeReadInRequest = true;
    const [attachmentRequest] = await getUpstreamRequestEvidence(
      {
        lastUserMessageIncludes: [`${CASE_MARKER}_ATTACH`],
        includes: [TEXT_MARKER, NATIVE_MARKER],
      },
      { afterIndex: requestStart - 1 },
    );
    const requestText = JSON.stringify(attachmentRequest?.requestJson);
    const sourceFiles = [
      { kind: "PDF", bytes: Buffer.from(MINIMAL_PDF, "latin1") },
      { kind: "Image", bytes: Buffer.from(IMAGE_BASE64, "base64") },
    ];
    const verifiedBinaryPaths: string[] = [];
    for (const { kind, bytes } of sourceFiles) {
      const path = requestText.match(new RegExp(`\\[${kind}: source: ([^\\]]+)\\]`, "u"))?.[1];
      expect(path).toMatch(/^\/home\/dev\/\.cf\/cli\/(?:pdf|image)-cache\/[A-Za-z0-9_./-]+$/u);
      const contentHash = await runSSHCommand(prepared.config, `sha256sum -- '${path}'`);
      expect(contentHash.code).toBe(0);
      expect(contentHash.stdout.split(/\s/u)[0]).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      verifiedBinaryPaths.push(path!);
    }
    facts.verifiedBinaryPaths = verifiedBinaryPaths;
    await waitForV4AssistantMessageContaining("R3_ATTACHMENTS_REPLY", 90_000);
    await waitForV4ConversationState(
      (s) => s.taskId === taskA.taskId && s.state === "idle",
      `${CASE_MARKER}: Attachment回合没有收口`,
      90_000,
    );

    const remoteAfter = await runSSHCommand(
      prepared.config,
      `grep -rl "${TEXT_MARKER}" "$HOME" 2>/dev/null | grep -v "/cli/log/" | head -n 10; echo __END__; find "$HOME" -name "${IMAGE_FILE}*" -o -name "${PDF_FILE}*" 2>/dev/null | head -n 10`,
    );
    const [remoteTextHits, remoteBinaryHits] = remoteAfter.stdout
      .split("__END__")
      .map((part) => part!.trim().split("\n").filter(Boolean));
    facts.remoteTextHits = remoteTextHits;
    facts.remoteBinaryHits = remoteBinaryHits;
    const localHits = await localHomeContains(TEXT_MARKER);
    facts.localHomeHits = localHits.split("\n").filter(Boolean);
    expect(remoteTextHits!.length).toBeGreaterThan(0);
    expect(remoteTextHits!.every((path) => path.startsWith("/home/dev/"))).toBe(true);
    expect(localHits).toBe("");
    const tab = await readRemoteTabSnapshot(taskA.identity);
    expect(tab.remoteSessionId).toBeTruthy();

    await setV4ComposerText(`${CASE_MARKER}_REMOVE 不Send`);
    await pasteV4ComposerFileAttachment("r3-dev04-remove.txt", {
      base64: Buffer.from("remove me", "utf8").toString("base64"),
      mimeType: "text/plain",
    });
    await browser.waitUntil(async () => (await readComposerAttachmentStatuses()).length === 1, {
      timeout: 30_000,
      timeoutMsg: `${CASE_MARKER}: 待Remove attachment没有出现`,
    });
    const removeButton = $("[data-composer-attachment-kind] [data-composer-attachment-remove]");
    await removeButton.waitForExist({ timeout: 15_000 });
    await browser.execute(() => {
      const card = document.querySelector<HTMLElement>("[data-composer-attachment-kind]");
      card?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      card?.querySelector<HTMLElement>("[data-composer-attachment-remove]")?.click();
    });
    await browser.waitUntil(async () => (await readComposerAttachmentStatuses()).length === 0, {
      timeout: 15_000,
      timeoutMsg: `${CASE_MARKER}: Attachment移除后仍在 composer`,
    });
    facts.removeCleared = true;

    const pastedOversized = await browser.execute((inputTestId) => {
      const input = document.querySelector<HTMLElement>(`[data-testid="${inputTestId}"]`);
      const editable =
        input?.querySelector<HTMLElement>('[contenteditable="true"]') ??
        (input?.getAttribute("contenteditable") === "true" ? input : null);
      if (!editable) return false;
      const file = new File([new Uint8Array(21 * 1024 * 1024)], "r3-dev04-oversized.bin", {
        type: "application/octet-stream",
      });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      editable.focus();
      editable.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    }, TID_V4_COMPOSER_INPUT);
    expect(pastedOversized).toBe(true);
    let failed: Array<{ name: string; kind: string | null; status: string | null }> = [];
    await browser.waitUntil(
      async () => {
        failed = await readComposerAttachmentStatuses();
        return (
          failed.length === 0 ||
          failed.every((s) => s.status && s.status !== "uploading" && s.status !== "pending")
        );
      },
      { timeout: 120_000, interval: 1000, timeoutMsg: `${CASE_MARKER}: 超大Attachment没有到达Final state` },
    );
    await browser.waitUntil(
      async () =>
        /Failed|过大|超过|too large|exceed|failed|payloadTooLarge/iu.test(
          await browser.execute(() => document.body?.innerText ?? ""),
        ),
      { timeout: 15_000, timeoutMsg: `${CASE_MARKER}: 超大Attachment被移除但没有明确FailedNotice` },
    );
    const bodyText = await browser.execute(() => document.body?.innerText ?? "");
    facts.oversized = {
      cards: failed,
      hasVisibleError: /Failed|过大|超过|too large|exceed|failed|payloadTooLarge/iu.test(bodyText),
    };
    expect(failed.every((s) => s.status !== "ready")).toBe(true);
    await setV4ComposerText("");
  });
});
