import { readFile } from "node:fs/promises";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  assertUpstreamThoughtLevelCapture,
} from "../../../helpers/upstream-capture.js";
import {
  UPSTREAM_MODEL,
  UPSTREAM_SECONDARY_MODEL,
  UPSTREAM_SECONDARY_THOUGHT_LEVEL,
  UPSTREAM_THOUGHT_LEVEL,
  ensureUpstreamModelForE2E,
  getUpstreamThoughtLevelLabels,
  getSelectedUpstreamModelLabel,
  getSelectedUpstreamThoughtLevelLabel,
  selectUpstreamModelById,
  selectUpstreamThoughtLevelValue,
  waitForUpstreamModelSelected,
} from "../../../helpers/upstream-provider.js";
import {
  E2E_REPLY_TOKEN,
  buildReadonlyToolPrompt,
  clickChatStop,
  clickForkButtonForAssistantContaining,
  editUserMessageContaining,
  getChatRootSnapshot,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";
import type {
  E2ENetworkCaptureArtifact,
  E2ENetworkCaptureRecord,
} from "../../../helpers/network-capture-proxy.js";

const MODEL_SWITCH_GUARD_TITLE_ZH = "需要压缩上下文后再切换模型";
const MODEL_SWITCH_GUARD_TITLE_EN = "Compress context before switching models";

describe("会话区模型切换 Tool/Edit/Fork 交集 E2E", () => {
  before(async function () {
    this.timeout(120000);

    await prepareConversationE2E();
    await ensureUpstreamModelForE2E(UPSTREAM_SECONDARY_MODEL);
  });

  afterEach(async () => {
    await stopIfBusy();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Switching model during tool prompt window retains executable probe first", async function () {
    this.timeout(180000);

    await startCaseWithPrimaryModel();
    const marker = `E2E_FIRST_SEND_MSW_TOOL_${Date.now()}`;

    await sendPrompt(buildReadonlyToolPrompt(marker));
    await waitForComposerText("", "tool model switch: input box was not cleared after initial send");
    await waitForUserMessageContaining(marker);
    await trySwitchToSecondaryModelDuringToolProbe();

    const requestRecord = await waitForUpstreamRecordContaining(
      [marker],
      `tool model switch: 没有捕获到 ${marker} 的Request`,
      90000,
    );
    expect(readCaptureModel(requestRecord)).toBeTruthy();
    await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "tool model switch: probe request did not complete",
      90000,
    );
  });

  it("Switching to secondary after completed and editing old user query: rerun request should use secondary", async function () {
    this.timeout(180000);

    await startCaseWithPrimaryModel();
    const runId = Date.now();
    const sourceMarker = `E2E_MSW_EDIT_SOURCE_${runId}`;
    const rerunMarker = `E2E_MSW_EDIT_RERUN_${runId}`;

    await sendPrompt(simpleReplyPrompt(sourceMarker));
    await waitForComposerText("", "edit model switch: input box was not cleared after sending source");
    await waitForUserMessageContaining(sourceMarker);
    expect(readCaptureModel(await waitForUpstreamRecordContaining([sourceMarker]))).toBeTruthy();
    await waitForCompletedAssistant("edit model switch: source did not complete");

    await switchToSecondaryModel();
    await editUserMessageContaining(sourceMarker, simpleReplyPrompt(rerunMarker));
    await waitForComposerText("", "edit model switch: input box was not cleared after submitting edit");
    await waitForUserMessageContaining(rerunMarker);
    const rerunRecord = await waitForUpstreamRecordContaining([rerunMarker]);
    assertUpstreamConfig(rerunRecord, rerunMarker, {
      model: UPSTREAM_SECONDARY_MODEL,
      thoughtLevel: UPSTREAM_SECONDARY_THOUGHT_LEVEL,
    });
    await waitForCompletedAssistant("edit model switch: rerun did not complete");
  });

  it("Switching to secondary after completed and forking assistant: subsequent requests in forked session should inherit secondary", async function () {
    this.timeout(180000);

    await startCaseWithPrimaryModel();
    const runId = Date.now();
    const sourceMarker = `E2E_MSW_FORK_SOURCE_${runId}`;
    const followupMarker = `E2E_MSW_FORK_FOLLOWUP_${runId}`;

    await sendPrompt(simpleReplyPrompt(sourceMarker));
    await waitForComposerText("", "fork model switch: input box was not cleared after sending source");
    await waitForUserMessageContaining(sourceMarker);
    const sourceSnapshot = await waitForChatState(
      (snapshot) => Boolean(snapshot.sessionId || snapshot.taskId),
      "fork model switch: source 没有创建 session",
      30000,
    );
    expect(readCaptureModel(await waitForUpstreamRecordContaining([sourceMarker]))).toBeTruthy();
    await waitForCompletedAssistant("fork model switch: source did not complete");

    await switchToSecondaryModel();
    await clickForkButtonForAssistantContaining(E2E_REPLY_TOKEN);
    const forkedSnapshot = await waitForChatState(
      (snapshot) =>
        Boolean(snapshot.sessionId || snapshot.taskId) &&
        (snapshot.sessionId || snapshot.taskId) !==
          (sourceSnapshot.sessionId || sourceSnapshot.taskId),
      "fork model switch: did not switch to forked session after clicking fork",
      30000,
    );
    expect(forkedSnapshot.queueCount).toBe(0);
    const forkedSessionId = forkedSnapshot.sessionId || forkedSnapshot.taskId;
    expect(forkedSessionId).toBeTruthy();
    await waitForChatState(
      (snapshot) =>
        (snapshot.sessionId || snapshot.taskId) === forkedSessionId &&
        snapshot.state === "idle" &&
        snapshot.runtimeStatus !== "restoring",
      "fork model switch: forked session did not finish restoring",
      60000,
    );
    await expectToolbarConfig(UPSTREAM_SECONDARY_MODEL, UPSTREAM_SECONDARY_THOUGHT_LEVEL);

    await sendPrompt(simpleReplyPrompt(followupMarker));
    await waitForComposerText("", "fork model switch: input box was not cleared after sending followup");
    await waitForUserMessageContaining(followupMarker);
    const followupRecord = await waitForUpstreamRecordContaining([followupMarker]);
    assertUpstreamConfig(followupRecord, followupMarker, {
      model: UPSTREAM_SECONDARY_MODEL,
      thoughtLevel: UPSTREAM_SECONDARY_THOUGHT_LEVEL,
    });
    await waitForCompletedAssistant("fork model switch: followup did not complete");
  });
});

async function startCaseWithPrimaryModel() {
  await startNewTask();
  await selectUpstreamModelById(UPSTREAM_MODEL);
  if (UPSTREAM_THOUGHT_LEVEL) {
    await selectUpstreamThoughtLevelValue(UPSTREAM_THOUGHT_LEVEL);
  }
  await expectToolbarConfig(UPSTREAM_MODEL, UPSTREAM_THOUGHT_LEVEL);
}

async function switchToSecondaryModel() {
  await selectUpstreamModelById(UPSTREAM_SECONDARY_MODEL, {
    afterModelItemClick: () =>
      confirmModelSwitchCompressionDialogIfPresent(UPSTREAM_SECONDARY_MODEL),
  });
  await selectUpstreamThoughtLevelValue(UPSTREAM_SECONDARY_THOUGHT_LEVEL);
  await expectToolbarConfig(UPSTREAM_SECONDARY_MODEL, UPSTREAM_SECONDARY_THOUGHT_LEVEL);
}

async function trySwitchToSecondaryModelDuringToolProbe() {
  try {
    await switchToSecondaryModel();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isExpectedToolProbeModelSwitchError(message)) {
      return;
    }
    throw error;
  }
}

function isExpectedToolProbeModelSwitchError(message: string) {
  return (
    message.includes(UPSTREAM_SECONDARY_MODEL) &&
    (message.includes("聊天工具栏没有出现") ||
      message.includes("上游 模型没有切换到"))
  );
}

async function confirmModelSwitchCompressionDialogIfPresent(modelId: string) {
  const hasDialog = await waitForModelSwitchCompressionDialog(250).catch(
    () => false,
  );
  if (!hasDialog) {
    return false;
  }

  await confirmModelSwitchCompressionDialog();
  await waitForChatState(
    (snapshot) => !snapshot.modelSwitchPending,
    `Model ${modelId} guard Compact后切换 pending Status没有结束`,
    120000,
  );
  await waitForUpstreamModelSelected(modelId);
  return true;
}

async function confirmModelSwitchCompressionDialog() {
  await waitForModelSwitchCompressionDialog(15000);

  const clicked = await browser.execute(() => {
    const dialog =
      document.querySelector<HTMLElement>('[role="dialog"]') ?? document.body;
    const buttons = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button"),
    );
    const confirmButton = buttons.find((button) => {
      const text = button.innerText.replace(/\s+/g, " ").trim();
      return (
        text === "压缩" ||
        text === "继续" ||
        text === "Compress" ||
        text === "Continue" ||
        text.includes("压缩")
      );
    });
    confirmButton?.click();
    return Boolean(confirmButton);
  });
  expect(clicked).toBe(true);
}

async function waitForModelSwitchCompressionDialog(timeout: number) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (titleZh, titleEn) => {
          const bodyText = document.body.innerText;
          return bodyText.includes(titleZh) || bodyText.includes(titleEn);
        },
        MODEL_SWITCH_GUARD_TITLE_ZH,
        MODEL_SWITCH_GUARD_TITLE_EN,
      ),
    {
      timeout,
      timeoutMsg: "Context compaction confirmation dialog before model switch did not appear",
    },
  );
  return true;
}

function simpleReplyPrompt(marker: string) {
  return `${marker}: Reply with exactly "${E2E_REPLY_TOKEN}" and no other text.`;
}

async function waitForCompletedAssistant(timeoutMsg: string) {
  await waitForAssistantMessageContaining(E2E_REPLY_TOKEN);
  await waitForChatState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    timeoutMsg,
    90000,
  );
}

async function expectToolbarConfig(model: string, thoughtLevel: string) {
  const modelLabel = await getSelectedUpstreamModelLabel();
  const acceptedModelValues = [`e2e-upstream/${model}`, `custom:e2e-upstream:${model}`, model];
  if (modelLabel.currentValue) {
    expect(acceptedModelValues).toContain(modelLabel.currentValue);
  } else {
    expect(Object.values(modelLabel).join("\n")).toContain(model);
  }

  if (!thoughtLevel) {
    return;
  }

  const thoughtLabel = await getSelectedUpstreamThoughtLevelLabel();
  const labelCandidates = Object.values(thoughtLabel)
    .map((value) => value.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
  const expectedLabels = [
    thoughtLevel,
    ...getUpstreamThoughtLevelLabels(thoughtLevel),
  ].map((label) => label.replace(/\s+/g, " ").trim().toLowerCase());
  const matchedThoughtLevel = labelCandidates.some((label) =>
    expectedLabels.some((expectedLabel) => label === expectedLabel || label.includes(expectedLabel)),
  );
  if (!matchedThoughtLevel) {
    throw new Error(
      `Thinking深度未Exact匹配 ${thoughtLevel}: ${JSON.stringify({
        expectedLabels,
        thoughtLabel,
      })}`,
    );
  }
}

function assertUpstreamConfig(
  record: E2ENetworkCaptureRecord,
  expectedText: string,
  {
    model,
    thoughtLevel,
  }: {
    model: string;
    thoughtLevel: string;
  },
) {
  assertUpstreamRequestCapture(record, { expectedText, model });
  if (thoughtLevel) {
    assertUpstreamThoughtLevelCapture(record, thoughtLevel);
  }
}

async function waitForUpstreamRecordContaining(
  includes: string[],
  timeoutMsg = `没有捕获到 上游 Request: ${includes.join(", ")}`,
  timeout = 60000,
) {
  let latestSummary: unknown = null;
  await browser.waitUntil(
    async () => {
      const artifact = await readUpstreamCaptureArtifact();
      latestSummary = summarizeUpstreamCaptureArtifact(artifact);
      return Boolean(findLastUpstreamRecord(artifact, includes));
    },
    {
      timeout,
      timeoutMsg: `${timeoutMsg}; latest=${JSON.stringify(latestSummary)}`,
    },
  );
  const record = findLastUpstreamRecord(await readUpstreamCaptureArtifact(), includes);
  if (!record) {
    throw new Error(`${timeoutMsg}; latest=${JSON.stringify(latestSummary)}`);
  }
  return record;
}

async function readUpstreamCaptureArtifact(): Promise<E2ENetworkCaptureArtifact | null> {
  const capturePath = process.env.E2E_PROVIDER_CAPTURE_PATH?.trim();
  if (!capturePath) {
    return null;
  }
  try {
    return JSON.parse(await readFile(capturePath, "utf-8")) as E2ENetworkCaptureArtifact;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function findLastUpstreamRecord(
  artifact: E2ENetworkCaptureArtifact | null,
  includes: string[],
) {
  const records = artifact?.records ?? [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index]!;
    if (matchesUpstreamRecord(record, includes)) {
      return record;
    }
  }
  return null;
}

function matchesUpstreamRecord(
  record: E2ENetworkCaptureRecord,
  includes: string[],
) {
  return (
    record.status === "complete" &&
    record.statusCode !== undefined &&
    record.method === "POST" &&
    (record.path.includes("/messages") || record.path.includes("/chat/completions")) &&
    !captureContainsText(record.requestJson, "Generate a concise title") &&
    includes.every((text) => captureContainsText(record.requestJson, text))
  );
}

function summarizeUpstreamCaptureArtifact(
  artifact: E2ENetworkCaptureArtifact | null,
) {
  return {
    configured: Boolean(process.env.E2E_PROVIDER_CAPTURE_PATH),
    recordCount: artifact?.records.length ?? 0,
    records: artifact?.records.slice(-8).map((record) => ({
      model: readCaptureModel(record),
      path: record.path,
      requestBodyBytes: record.requestBodyBytes,
      status: record.status,
      statusCode: record.statusCode,
    })),
  };
}

function readCaptureModel(record: E2ENetworkCaptureRecord) {
  const requestJson = record.requestJson;
  if (
    requestJson &&
    typeof requestJson === "object" &&
    "model" in requestJson &&
    typeof requestJson.model === "string"
  ) {
    return requestJson.model;
  }
  return null;
}

function captureContainsText(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    return value.includes(expected);
  }
  if (Array.isArray(value)) {
    return value.some((item) => captureContainsText(item, expected));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value).some((child) => captureContainsText(child, expected));
}

async function stopIfBusy() {
  const snapshot = await getChatRootSnapshot().catch(() => null);
  if (snapshot?.state !== "streaming") {
    return;
  }
  await clickChatStop().catch(() => undefined);
  await waitForChatState(
    (candidate) => candidate.state !== "streaming",
    "Failed to exit streaming after afterEach stop",
    30000,
  ).catch(() => undefined);
}
