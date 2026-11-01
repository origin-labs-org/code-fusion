import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TID_CHAT_ATTACHMENT_BUTTON, TID_CHAT_ATTACHMENT_MENU_ITEM } from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  DEFAULT_WORKSPACE,
  waitForDefaultWorkspaceReady,
} from "../../../helpers/desktop-app.js";
import {
  restartIntoWorkspacePreservingProfile,
  seedTurboAgentStartupModel,
} from "../../../helpers/model-provider-restart.js";
import {
  ensureUpstreamProviderForE2E,
  UPSTREAM_MODEL,
  UPSTREAM_PROVIDER_ID,
} from "../../../helpers/upstream-provider.js";
import { waitForUpstreamNetworkCapture } from "../../../helpers/upstream-capture.js";
import { reloadElectronSessionSafely } from "../../../helpers/e2e-electron-reload.js";
import {
  resolveSeededReplayBaseUrl,
  seedCustomAnthropicMessagesProvider,
} from "../../../helpers/custom-openai-provider-store.js";
import {
  clickV4Send,
  getV4ComposerAttachments,
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  setV4ComposerText,
  waitForV4Pane,
  waitForV4RowAttachments,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const ROOT = join(DEFAULT_WORKSPACE, ".cf-e2e", "conversation-session-attachment-resume");
const FIRST = "E2E_ATTACHMENT_RESUME_FIRST";
const HOT = "E2E_ATTACHMENT_RESUME_HOT";
const COLD = "E2E_ATTACHMENT_RESUME_COLD";

describe("AR01 attachment cold resume", () => {
  afterEach(async function () {
    if (this.currentTest?.state !== "failed") return;
    const artifacts = process.env.CF_E2E_ARTIFACT_DIR ?? join(process.cwd(), ".e2e-artifacts");
    await browser.saveScreenshot(join(artifacts, "attachment-resume-failure.png"));
    console.info(
      "AR01 failure UI",
      await browser.execute(() => document.body.innerText.slice(-5000)),
    );
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(ROOT, { force: true, recursive: true });
    await clearAppData();
  });

  it("重启后保留首轮正文顺序与三行路径说明", async function () {
    this.timeout(240_000);
    await waitForDefaultWorkspaceReady();
    await ensureUpstreamProviderForE2E({ skipToolbarSelection: true });
    await seedCustomAnthropicMessagesProvider({
      baseURL: await resolveSeededReplayBaseUrl(),
      modelId: UPSTREAM_MODEL,
      providerId: UPSTREAM_PROVIDER_ID,
      providerName: "Attachment Resume Fixture",
    });
    await seedTurboAgentStartupModel(UPSTREAM_PROVIDER_ID, UPSTREAM_MODEL);
    await restartIntoWorkspacePreservingProfile();
    await prepareV4ConversationE2E({ skipProvider: true });
    await mkdir(ROOT, { recursive: true });
    const path = join(ROOT, "resume-bundle.zip");
    await writeFile(path, "binary fixture");
    const dialog = await browser.electron.mock("dialog", "showOpenDialog");
    await dialog.mockResolvedValueOnce({ canceled: false, filePaths: [path] });
    await $(`[data-testid="${TID_CHAT_ATTACHMENT_BUTTON}"]`).click();
    await $(`[data-testid="${TID_CHAT_ATTACHMENT_MENU_ITEM}"]`).click();
    await browser.waitUntil(
      async () => {
        const attachments = await getV4ComposerAttachments();
        return attachments.length === 1 && attachments[0]?.uploadStatus === "ready";
      },
      { timeout: 30_000, timeoutMsg: "AR01 文件附件未 ready" },
    );
    await setV4ComposerText(FIRST);
    await clickV4Send();
    await waitForV4TimelineContaining("ATTACHMENT_RESUME_FIRST_OK");
    const first = await waitForV4Pane(
      (s) => Boolean(s.sessionId && s.sessionId !== "draft") && !s.canStop,
      "AR01 round 1 incomplete",
    );
    expect(await waitForV4RowAttachments()).toContain("resume-bundle.zip");
    await sendV4Prompt(HOT);
    await waitForV4TimelineContaining("ATTACHMENT_RESUME_HOT_OK");
    await waitForV4Pane((s) => !s.canStop, "AR01 warm follow-up chat incomplete");
    const hot = firstUserContent((await waitForUpstreamNetworkCapture(HOT)).requestJson);
    expect(hot[0]).toMatchObject({ type: "text", text: FIRST });
    expect(hot[1]).toMatchObject({
      type: "text",
      text: expect.stringContaining("The file was sent by local path because"),
    });
    expect(String(hot[1]?.text).split("\n")).toHaveLength(3);

    await rm(path);
    await reloadElectronSessionSafely(browser);
    await selectV4TaskById(first.sessionId!);
    await waitForV4TimelineContaining(HOT);
    await sendV4Prompt(COLD);
    await waitForV4TimelineContaining("ATTACHMENT_RESUME_COLD_OK");
    const cold = firstUserContent((await waitForUpstreamNetworkCapture(COLD)).requestJson);
    expect(cold).toEqual(hot);
  });
});

function firstUserContent(value: unknown): Array<Record<string, unknown>> {
  const messages = (value as { messages?: Array<{ role?: string; content?: unknown }> }).messages;
  const user = messages?.find(
    (message) =>
      message.role === "user" &&
      Array.isArray(message.content) &&
      message.content.some((block) => block?.text === FIRST),
  );
  if (!user || !Array.isArray(user.content))
    throw new Error("AR01 provider capture lacks round 1 user content");
  const promptIndex = user.content.findIndex((block) => block?.text === FIRST);
  return user.content.slice(promptIndex, promptIndex + 2);
}
