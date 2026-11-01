import type { ArmsCustomEventPayload } from "@origin-ai/cf-shared";
import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  prepareV4ConversationE2E,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4ComposerSelectionReady,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";

const PROMPT_MARKER = "E2E_SESSION_OPEN_EXISTING_ONLY";
const REPLY_MARKER = "session-open-existing-only-ok";
const SESSION_OPEN_EVENT_NAMES = [
  "perf_ui_session_open_start",
  "perf_ui_session_open_result",
] as const;

describe("conversation session open existing only", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Zero reporting on draft promotion; reopening existing Session after leaving reports only one set", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E();
    await waitForV4ComposerSelectionReady();
    await clearSessionOpenArmsEvents();

    await sendV4Prompt(`${PROMPT_MARKER}: create a new task without session-open telemetry.`);
    await waitForV4AssistantMessageContaining(REPLY_MARKER, 60_000);
    const createdPane = await waitForV4Pane(
      (snapshot) =>
        snapshot.sessionId !== null && snapshot.sessionId !== "draft" && !snapshot.canStop,
      "TEL10: Completed Session was not formed after draft promotion",
      60_000,
    );
    const createdSessionId = createdPane.sessionId;
    if (!createdSessionId || createdSessionId === "draft") {
      throw new Error("TEL10: Failed to obtain newly created Session ID");
    }

    await browser.pause(500);
    expect(await readSessionOpenArmsEvents(createdSessionId)).toEqual([]);

    await startNewV4Draft();
    await waitForV4ComposerSelectionReady();
    await clearSessionOpenArmsEvents();
    await selectV4TaskById(createdSessionId);

    const reopenedEvents = await waitForSessionOpenArmsPair(createdSessionId);
    expect(reopenedEvents.map((event) => event.name)).toEqual(SESSION_OPEN_EVENT_NAMES);
    expect(reopenedEvents[0]?.properties?.session_open_id).toBe(
      reopenedEvents[1]?.properties?.session_open_id,
    );
    expect(reopenedEvents[0]?.properties).toMatchObject({
      session_id: createdSessionId,
      open_trigger: "sidebar",
    });
    expect(reopenedEvents[1]?.properties).toMatchObject({
      session_id: createdSessionId,
      status: "success",
    });
  });
});

async function clearSessionOpenArmsEvents(): Promise<void> {
  await browser.execute(() => {
    (
      window as Window & {
        __cfArmsCustomEventsE2E?: Array<ArmsCustomEventPayload & { recordedAt?: number }>;
      }
    ).__cfArmsCustomEventsE2E = [];
  });
}

async function readSessionOpenArmsEvents(sessionId: string): Promise<ArmsCustomEventPayload[]> {
  return browser.execute(
    (targetSessionId, targetEventNames) => {
      const events =
        (
          window as Window & {
            __cfArmsCustomEventsE2E?: Array<ArmsCustomEventPayload & { recordedAt?: number }>;
          }
        ).__cfArmsCustomEventsE2E ?? [];
      return events
        .filter(
          (event) =>
            (targetEventNames as readonly string[]).includes(event.name) &&
            event.properties?.session_id === targetSessionId,
        )
        .map(({ recordedAt: _recordedAt, ...payload }) => payload);
    },
    sessionId,
    [...SESSION_OPEN_EVENT_NAMES],
  );
}

async function waitForSessionOpenArmsPair(sessionId: string): Promise<ArmsCustomEventPayload[]> {
  let latest: ArmsCustomEventPayload[] = [];
  await browser.waitUntil(
    async () => {
      latest = await readSessionOpenArmsEvents(sessionId);
      return latest.length === SESSION_OPEN_EVENT_NAMES.length;
    },
    {
      timeout: 30_000,
      timeoutMsg: `TEL10 重开已有 Session 没有得到One组 session-open Events: ${sessionId}`,
    },
  );
  return latest;
}
