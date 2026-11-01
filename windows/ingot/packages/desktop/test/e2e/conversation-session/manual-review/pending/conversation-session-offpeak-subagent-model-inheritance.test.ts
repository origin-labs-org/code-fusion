import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  TID_AUTOMATIONS_OPEN,
  TID_CHAT_MODEL_SELECT_ITEM,
  TID_CHAT_MODEL_SELECT_TRIGGER,
  TID_OFFPEAK_CARD,
  TID_OFFPEAK_CREATE_BUTTON,
  TID_OFFPEAK_EDIT_SUBMIT,
  TID_OFFPEAK_FORM_INSTRUCTIONS,
  TID_OFFPEAK_FORM_TITLE,
  TID_OFFPEAK_TAB,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "../../../helpers/desktop-app.js";
import {
  assertUpstreamRequestCapture,
  waitForUpstreamNetworkCapture,
} from "../../../helpers/upstream-capture.js";
import {
  selectUpstreamModel,
  selectUpstreamThoughtLevel,
  UPSTREAM_MODEL,
} from "../../../helpers/upstream-provider.js";
import {
  prepareConversationE2E,
  sendPrompt,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";
import { sel } from "../../../helpers/selectors.js";
import { switchV4Mode } from "../../../helpers/v4-conversation.js";
import {
  openFaultInjectedHostWindow,
  readHostBoundary,
} from "../../../helpers/subagent-host-window.js";

const OFFPEAK_PARENT_MARKER = "E2E_OFFPEAK_SUBAGENTS_PARENT";
const ORDINARY_PROMPT_MARKER = "E2E_OFFPEAK_SUBAGENTS_ORDINARY_PROMPT";
const ORDINARY_REPLY_TOKEN = "E2E_OFFPEAK_SUBAGENTS_ORDINARY_OK";
const EXPECTED_FOREGROUND_STAGES = [
  "child-explore",
  "child-general-purpose",
  "child-code-search",
  "child-custom-inherit",
] as const;
const EXPECTED_BACKGROUND_STAGES = ["background-explicit", "background-profile"] as const;

interface OffPeakMockRequestRecord {
  hasApiKey: boolean;
  hasAuthorization: boolean;
  hasCodingPlanApiKey: boolean;
  maxTokens?: number;
  model?: string;
  requestJson: unknown;
  stage: string;
  ticketId: string;
}

describe("Off-peak background subagent model inheritance and wake-up E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("OP10/IL01/IL02: Foreground and background inherit off-peak model; main turn ends waiting for background wake-up; switch back to user model only after sending normal message", async function () {
    this.timeout(300000);

    const handoffFault = process.env.CF_E2E_OFFPEAK_HANDOFF_FAULT === "1";
    if (handoffFault) {
      const { windowId } = await openFaultInjectedHostWindow(
        fileURLToPath(new URL("../../../helpers/offpeak-host-faults.cjs", import.meta.url)),
      );
      await browser.electron.execute((electron, retainedId) => {
        for (const window of electron.BrowserWindow.getAllWindows())
          if (window.id !== retainedId) window.close();
      }, windowId);
    }
    await prepareConversationE2E();

    const takeover = process.env.CF_E2E_OFFPEAK_TAKEOVER === "1";
    const title = `E2E_OFFPEAK_SUBAGENTS_${Date.now()}`;
    await createOffPeakTask({
      instructions: `${OFFPEAK_PARENT_MARKER}: verify the foreground subagent provider matrix.`,
      title,
    });

    let records = await waitForOffPeakScenarioCompletion();
    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "Cannot reopen Automations after off-peak task completes",
    });
    await openOffPeakTab();
    await browser.waitUntil(
      async () => /Running|In progress|Running/u.test((await readOffPeakCardText(title)) ?? ""),
      { timeout: 15000, timeoutMsg: "Off-peak card should remain in progress when background work is not finished" },
    );
    await openOffPeakTaskSession(title);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "后台屏障关闭时主轮应已自然结束",
      60000,
    );
    await selectUpstreamModel();
    await selectUpstreamThoughtLevel();
    if (takeover) {
      await sendPrompt(ORDINARY_PROMPT_MARKER);
      await waitForComposerText("", "用户接管消息没有提交");
      await waitForAssistantMessageContaining(ORDINARY_REPLY_TOKEN);
    }
    const port = Number(process.env.CF_OFFPEAK_MOCK_PORT ?? "45197");
    const expireOnWake = handoffFault || process.env.CF_E2E_OFFPEAK_EXPIRE_WAKE === "1";
    const release = await fetch(`http://127.0.0.1:${port}/__e2e/off-peak/release-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expireOnWake }),
    });
    expect(release.ok).toBe(true);
    const bashNotification = "<tool-use-id>toolu_e2e_offpeak_bash</tool-use-id>";
    let userWakeBody: string | undefined;
    if (takeover) {
      const userWake = await waitForUpstreamNetworkCapture(bashNotification);
      assertUpstreamRequestCapture(userWake, {
        expectedText: bashNotification,
        model: UPSTREAM_MODEL,
      });
      userWakeBody = JSON.stringify(userWake.requestJson);
    } else {
      await browser.waitUntil(
        async () => {
          records = await readOffPeakMockRequests();
          return records.some((record) => record.stage === "parent-wakeup");
        },
        { timeout: 60000, timeoutMsg: "Background completion did not wake up main agent" },
      );
    }
    await clickTestIdByDom(TID_AUTOMATIONS_OPEN);
    await openOffPeakTab();
    await waitForOffPeakCardCompleted(title);
    if (handoffFault) {
      const boundary = await readHostBoundary();
      const failed = boundary.filter((event) => event.kind === "ticket-ack-failed");
      const confirmed = boundary.filter((event) => event.kind === "ticket-ack-confirmed");
      expect(failed).toHaveLength(1);
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0]!.id).toBe(failed[0]!.id);
      expect(boundary.filter((event) => event.kind === "ticket-control")).toHaveLength(2);
    }

    records = await readOffPeakMockRequests();
    expect(records.filter((record) => record.stage === "bash-started")).toHaveLength(1);
    expect(records.filter((record) => record.stage === "parent-initial")).toHaveLength(1);
    const parentInitial = requireStage(records, "parent-initial");
    const sessionTitle = requireStage(records, "session-title");
    expect(sessionTitle.ticketId).toBe(parentInitial.ticketId);
    expect(sessionTitle.model).toBe(parentInitial.model);
    expect(sessionTitle.hasApiKey).toBe(true);
    const foregroundRecords = EXPECTED_FOREGROUND_STAGES.map((stage) =>
      requireStage(records, stage),
    );
    const parentContinuation = requireStage(records, "parent-continuation");
    const ticketIds = new Set(
      [parentInitial, ...foregroundRecords, parentContinuation].map((record) => record.ticketId),
    );

    expect(ticketIds.size).toBe(1);
    for (const record of foregroundRecords) {
      expect(record.model).toBe("GLM-5.3");
      expect(record.maxTokens).toBe(parentInitial.maxTokens);
      expect(record.hasApiKey).toBe(true);
      expect(record.hasAuthorization).toBe(true);
      expect(record.hasCodingPlanApiKey).toBe(true);
    }
    for (const stage of EXPECTED_BACKGROUND_STAGES) {
      const record = requireStage(records, stage);
      expect(record.model).toBe("GLM-5.3");
      expect(record.ticketId).toBe(parentInitial.ticketId);
      expect(record.hasCodingPlanApiKey).toBe(true);
    }

    const continuationBody = JSON.stringify(parentContinuation.requestJson);
    expect(continuationBody).not.toContain("Idle-time tasks do not support background agents.");
    let wakeBody = userWakeBody ?? "";
    if (takeover) {
      expect(records.some((record) => record.stage === "parent-wakeup")).toBe(false);
    } else {
      const wakeup = requireStage(records, "parent-wakeup");
      expect(wakeup.model).toBe("GLM-5.3");
      if (expireOnWake) {
        const expired = requireStage(records, "parent-wakeup-expired");
        expect(expired.ticketId).toBe(parentInitial.ticketId);
        expect(wakeup.ticketId).not.toBe(expired.ticketId);
        expect(
          records.some(
            (record) =>
              record.stage === "parent-wakeup" &&
              record.ticketId !== expired.ticketId &&
              JSON.stringify(record.requestJson) === JSON.stringify(expired.requestJson),
          ),
        ).toBe(true);
      } else {
        expect(wakeup.ticketId).toBe(parentInitial.ticketId);
      }
      wakeBody = JSON.stringify(wakeup.requestJson);
    }
    expect(wakeBody.includes("<tool-use-id>toolu_e2e_offpeak_bash</tool-use-id>")).toBe(true);
    const outputPath =
      /<output-file>([^<]*toolu_e2e_offpeak_bash-stdout\.log)<\/output-file>/u.exec(wakeBody)?.[1];
    expect(outputPath).toBeTruthy();
    expect(await readFile(JSON.parse(`"${outputPath!}"`) as string, "utf8")).toContain(
      "E2E_OFFPEAK_BACKGROUND_BASH_OK",
    );

    await openOffPeakTaskSession(title);
    await waitForChatState(
      (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
      "闲时任务完成后打开 session 没有回到 idle",
      60000,
    );

    if (!takeover) {
      await sendPrompt(ORDINARY_PROMPT_MARKER);
      await waitForComposerText("", "闲时任务后的普通 prompt 没有提交");
      await waitForUserMessageContaining(ORDINARY_PROMPT_MARKER);
    }
    const ordinaryRecord = await waitForUpstreamNetworkCapture(ORDINARY_PROMPT_MARKER);
    assertUpstreamRequestCapture(ordinaryRecord, {
      expectedText: ORDINARY_PROMPT_MARKER,
      model: UPSTREAM_MODEL,
    });
    await waitForAssistantMessageContaining(ORDINARY_REPLY_TOKEN);

    const afterOrdinaryPrompt = await readOffPeakMockRequests();
    expect(
      afterOrdinaryPrompt.some((record) =>
        JSON.stringify(record.requestJson).includes(ORDINARY_PROMPT_MARKER),
      ),
    ).toBe(false);

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "Cannot open Automations after normal prompt completes",
    });
    await openOffPeakTab();
    await clickTestIdByDom(TID_OFFPEAK_CREATE_BUTTON, {
      timeoutMsg: "闲时任务创建入口没有出现",
    });
    await waitForTestIdByDom(TID_OFFPEAK_FORM_TITLE, {
      timeout: 15000,
      timeoutMsg: "闲时任务创建页没有打开",
    });
    const modelTrigger = $(sel(TID_CHAT_MODEL_SELECT_TRIGGER));
    await modelTrigger.waitForDisplayed({ timeout: 15000 });
    expect(await modelTrigger.getAttribute("data-model-current-value")).toBe("GLM-5.3");
    await modelTrigger.click();
    const visibleModelItems = await browser.execute(
      (itemPrefix) =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid]"))
          .map((element) => element.dataset.testid ?? "")
          .filter((value) => value.startsWith(itemPrefix)),
      `${TID_CHAT_MODEL_SELECT_ITEM}-`,
    );
    expect(visibleModelItems).toEqual([testId(TID_CHAT_MODEL_SELECT_ITEM, "GLM-5.3")]);
    await browser.keys("Escape");
  });
});

async function createOffPeakTask(input: { instructions: string; title: string }): Promise<void> {
  await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
    timeoutMsg: "侧栏没有出现 Automations 入口",
  });
  await openOffPeakTab();
  await clickTestIdByDom(TID_OFFPEAK_CREATE_BUTTON, {
    timeoutMsg: "Idle-time task creation button did not appear",
  });
  await setInputValueByTestIdDom(TID_OFFPEAK_FORM_TITLE, input.title, {
    timeoutMsg: "Idle-time task title input did not appear",
  });
  await setInputValueByTestIdDom(TID_OFFPEAK_FORM_INSTRUCTIONS, input.instructions, {
    timeoutMsg: "Idle-time task instructions input did not appear",
  });
  await switchV4Mode("yolo");
  await clickTestIdByDom(TID_OFFPEAK_EDIT_SUBMIT, {
    timeoutMsg: "Idle-time task create submit button is not clickable",
  });
}

async function waitForOffPeakScenarioCompletion(): Promise<OffPeakMockRequestRecord[]> {
  let latest: OffPeakMockRequestRecord[] = [];
  await browser.waitUntil(
    async () => {
      latest = await readOffPeakMockRequests();
      return [
        "parent-continuation",
        "background-explicit",
        "background-profile",
        "bash-started",
      ].every((stage) => latest.some((record) => record.stage === stage));
    },
    {
      interval: 1000,
      timeout: 180000,
      timeoutMsg: "闲时 mock 没有完成 foreground subagent 场景",
    },
  );
  return latest;
}

async function readOffPeakMockRequests(): Promise<OffPeakMockRequestRecord[]> {
  const port = Number(process.env.CF_OFFPEAK_MOCK_PORT ?? "45197");
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__e2e/off-peak/requests`);
    if (!response.ok) return [];
    const body = (await response.json()) as {
      requests?: OffPeakMockRequestRecord[];
    };
    return Array.isArray(body.requests) ? body.requests : [];
  } catch {
    return [];
  }
}

function requireStage(
  records: readonly OffPeakMockRequestRecord[],
  stage: string,
): OffPeakMockRequestRecord {
  const record = records.findLast((candidate) => candidate.stage === stage);
  if (!record) {
    throw new Error(
      `闲时 mock MissingRequestPhase ${stage}: ${JSON.stringify(
        records.map((candidate) => ({
          model: candidate.model,
          stage: candidate.stage,
        })),
      )}`,
    );
  }
  return record;
}

async function waitForOffPeakCardCompleted(title: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      const text = await readOffPeakCardText(title);
      return /Completed|Succeeded|Completed/u.test(text ?? "");
    },
    {
      interval: 1000,
      timeout: 180000,
      timeoutMsg: `闲时Task没有进入 completed: ${title}`,
    },
  );
}

async function openOffPeakTab(): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute((tabTestId) => {
        const tabGroup = document.querySelector<HTMLElement>(`[data-testid="${tabTestId}"]`);
        if (!tabGroup && document.querySelector('[data-testid="offpeak-create-button"]'))
          return true;
        const offPeakButton = Array.from(
          tabGroup?.querySelectorAll<HTMLButtonElement>("button") ?? [],
        ).find((button) => /闲时Task|Idle/u.test(button.textContent ?? ""));
        if (!offPeakButton) return false;
        offPeakButton.click();
        return true;
      }, TID_OFFPEAK_TAB),
    {
      interval: 500,
      timeout: 30000,
      timeoutMsg: "Automations 没有出现闲时任务标签",
    },
  );
}

async function readOffPeakCardText(title: string): Promise<string | null> {
  return browser.execute(
    (cardTestId, expectedTitle) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${cardTestId}"]`))
        .find((card) => card.textContent?.includes(expectedTitle))
        ?.textContent?.trim() ?? null,
    TID_OFFPEAK_CARD,
    title,
  );
}

async function openOffPeakTaskSession(title: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (cardTestId, expectedTitle) => {
          const card = Array.from(
            document.querySelectorAll<HTMLElement>(`[data-testid="${cardTestId}"]`),
          ).find((candidate) => candidate.textContent?.includes(expectedTitle));
          const sessionButton = Array.from(
            card?.querySelectorAll<HTMLButtonElement>("button") ?? [],
          ).find((button) => !button.dataset.testid);
          if (!sessionButton) return false;
          sessionButton.click();
          return true;
        },
        TID_OFFPEAK_CARD,
        title,
      ),
    {
      interval: 500,
      timeout: 30000,
      timeoutMsg: `闲时Task卡片没有出现 session 跳转入口: ${title}`,
    },
  );
}
