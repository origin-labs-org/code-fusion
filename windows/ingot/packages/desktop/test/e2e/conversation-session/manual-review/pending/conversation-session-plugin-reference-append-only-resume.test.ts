//
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  waitForUpstreamNetworkCapture,
} from "../../../helpers/upstream-capture.js";
import {
  restartIntoWorkspacePreservingProfile,
  seedPersistedModelSelection,
  seedReplayProvider,
  waitForSelectedModel,
} from "../../../helpers/model-provider-restart.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

const PROVIDER_ID = "e2e-plugin-reference-append-only";
const PROVIDER_NAME = "Plugin Reference Append Only E2E";
const MODEL_ID = "plugin-reference-append-only-model";
const PLUGIN_STABLE_ID = "skill-creator@cf-plugins-official";
const U1_MARKER = "E2E_PLUGIN_APPEND_ONLY_U1";
const U2_MARKER = "E2E_PLUGIN_APPEND_ONLY_U2";
const U3_MARKER = "E2E_PLUGIN_APPEND_ONLY_U3_HOT";
const U4_MARKER = "E2E_PLUGIN_APPEND_ONLY_U4_COLD";
const PARKING_MARKER = "E2E_PLUGIN_APPEND_ONLY_PARKING";
const A1_MARKER = "PLUGIN_APPEND_ONLY_A1";
const A2_MARKER = "PLUGIN_APPEND_ONLY_A2";
const A3_MARKER = "PLUGIN_APPEND_ONLY_A3_HOT";
const A4_MARKER = "PLUGIN_APPEND_ONLY_A4_COLD";
const PARKING_REPLY = "PLUGIN_APPEND_ONLY_PARKING_OK";
const PLUGIN_REFERENCE_TAG = "<plugin_reference>";

type ProviderMessage = unknown;

describe("PLG13/PLG14 Plugin reference multi-turn warm/cold recovery append-only", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Real provider messages maintain strict prefixes after multi-turn, warm recovery, and cold recovery", async function () {
    this.timeout(360_000);

    await prepareV4ConversationE2E({ skipProvider: true });
    await seedReplayProvider({
      id: PROVIDER_ID,
      models: [MODEL_ID],
      name: PROVIDER_NAME,
    });
    await seedPersistedModelSelection({
      modelId: MODEL_ID,
      providerId: PROVIDER_ID,
      reasoningLevel: "disabled",
    });
    await restartIntoWorkspacePreservingProfile();
    await prepareV4ConversationE2E({ skipProvider: true });
    await waitForSelectedModel(PROVIDER_ID, MODEL_ID);

    const u1Prompt =
      `${U1_MARKER}: Use [@skill-creator](plugin://${PLUGIN_STABLE_ID}), ` +
      `then reply with exactly "${A1_MARKER}".`;
    const request1 = await sendAndCapture(u1Prompt, U1_MARKER, A1_MARKER);
    const messages1 = readProviderMessages(request1.requestJson, "Req1");
    const reminder1 = readSinglePluginReminder(messages1, "Req1");
    const targetSessionId = await readIdleBoundSession("U1 failed to create target session");

    const u2Prompt = `${U2_MARKER}: Reply with exactly "${A2_MARKER}".`;
    const request2 = await sendAndCapture(u2Prompt, U2_MARKER, A2_MARKER);
    const messages2 = readProviderMessages(request2.requestJson, "Req2");
    assertStrictMessagePrefix(messages1, messages2, "U1 → U2");
    expect(readSinglePluginReminder(messages2, "Req2")).toEqual(reminder1);

    await startNewV4Draft();
    await sendV4Prompt(`${PARKING_MARKER}: Reply with exactly "${PARKING_REPLY}".`);
    await waitForV4AssistantMessageContaining(PARKING_REPLY, 60_000);
    const parkingSessionId = await readIdleBoundSession("Parking session did not complete");
    expect(parkingSessionId).not.toBe(targetSessionId);

    await selectV4TaskById(targetSessionId);
    await waitForV4TimelineContaining(U2_MARKER, 60_000);
    const u3Prompt = `${U3_MARKER}: Reply with exactly "${A3_MARKER}".`;
    const request3 = await sendAndCapture(u3Prompt, U3_MARKER, A3_MARKER);
    const messages3 = readProviderMessages(request3.requestJson, "Req3-hot");
    assertStrictMessagePrefix(messages2, messages3, "U2 → hot U3");
    expect(readSinglePluginReminder(messages3, "Req3-hot")).toEqual(reminder1);

    await selectV4TaskById(parkingSessionId);
    await restartIntoWorkspacePreservingProfile();
    await waitForSelectedModel(PROVIDER_ID, MODEL_ID);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== targetSessionId,
      "冷启动后目标 session 在显式选择前已被自动打开",
      60_000,
    );
    await selectV4TaskById(targetSessionId, 30_000);
    await waitForV4TimelineContaining(U3_MARKER, 60_000);

    const u4Prompt = `${U4_MARKER}: Reply with exactly "${A4_MARKER}".`;
    const request4 = await sendAndCapture(u4Prompt, U4_MARKER, A4_MARKER);
    const messages4 = readProviderMessages(request4.requestJson, "Req4-cold");
    assertStrictMessagePrefix(messages3, messages4, "hot U3 → cold U4");
    expect(readSinglePluginReminder(messages4, "Req4-cold")).toEqual(reminder1);

    const timelineHasReminder = await browser.execute(
      (tag) => (document.body.textContent ?? "").includes(tag),
      PLUGIN_REFERENCE_TAG,
    );
    expect(timelineHasReminder).toBe(false);
  });
});

async function sendAndCapture(prompt: string, marker: string, reply: string) {
  await sendV4Prompt(prompt);
  await waitForV4AssistantMessageContaining(reply, 60_000);
  await waitForV4Pane(
    (snapshot) =>
      Boolean(snapshot.sessionId && snapshot.sessionId !== "draft") && !snapshot.canStop,
    `${marker} 没有Completed并回到 idle`,
    90_000,
  );
  const request = await waitForUpstreamNetworkCapture(marker);
  assertUpstreamRequestCapture(request, { expectedText: prompt, model: MODEL_ID });
  return request;
}

async function readIdleBoundSession(timeoutMsg: string): Promise<string> {
  const snapshot = await waitForV4Pane(
    (current) => Boolean(current.sessionId && current.sessionId !== "draft") && !current.canStop,
    timeoutMsg,
    90_000,
  );
  if (!snapshot.sessionId || snapshot.sessionId === "draft") {
    throw new Error(`${timeoutMsg}; sessionId=${snapshot.sessionId}`);
  }
  return snapshot.sessionId;
}

function readProviderMessages(requestJson: unknown, label: string): ProviderMessage[] {
  if (!requestJson || typeof requestJson !== "object" || Array.isArray(requestJson)) {
    throw new Error(`${label} provider request 不Yes JSON object`);
  }
  const messages = (requestJson as Record<string, unknown>).messages;
  if (!Array.isArray(messages)) {
    throw new Error(`${label} provider request Missing messages Array`);
  }
  return messages;
}

function assertStrictMessagePrefix(
  previous: readonly ProviderMessage[],
  next: readonly ProviderMessage[],
  label: string,
) {
  expect(next.length).toBeGreaterThan(previous.length);
  expect(next.slice(0, previous.length)).toEqual(previous);
  if (next.length <= previous.length) {
    throw new Error(
      `${label} 没有在历史尾部AppendMessages：previous=${previous.length}, next=${next.length}`,
    );
  }
}

function readSinglePluginReminder(
  messages: readonly ProviderMessage[],
  label: string,
): ProviderMessage {
  const reminders = messages.filter((message) =>
    JSON.stringify(message).includes(PLUGIN_REFERENCE_TAG),
  );
  expect(reminders).toHaveLength(1);
  if (reminders.length !== 1) {
    throw new Error(`${label} plugin_reference Quantity不Yes 1：${reminders.length}`);
  }
  expect(JSON.stringify(reminders[0])).toContain(PLUGIN_STABLE_ID);
  return reminders[0];
}
