import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  getUpstreamRequestEvidence,
  getUpstreamRequestRecordCount,
} from "../../../helpers/conversation-session-network.js";
import { skipOccupationOnboardingIfPresent } from "../../../helpers/occupation-onboarding.js";
import {
  holdToolResultDatabaseWriteLock,
  readStopToolLogs,
  releaseTextBashHook,
  resetTextBashHook,
  restoreStopToolResultsFixture,
  waitForTextBashBarrier,
  waitForStopToolBarrier,
  writeStopToolEvidence,
} from "../../../helpers/stop-tool-results-fixture.js";
import {
  clickV4Stop,
  getV4PaneSnapshot,
  getV4QueueItems,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";

const cases = [
  { variant: "text", marker: "E2E_STOP_RESULTS_TEXT", reply: "STOP_RESULTS_TEXT_OK" },
  { variant: "image", marker: "E2E_STOP_RESULTS_IMAGE", reply: "STOP_RESULTS_IMAGE_OK" },
] as const;

describe("B12 Read Result Completeness Comparison After Stop", () => {
  after(async () => {
    try {
      if ((await getV4PaneSnapshot()).canStop) {
        await clickV4Stop();
        await waitForV4Pane((pane) => !pane.canStop, "Stop not completed during cleanup");
      }
    } finally {
      await restoreStopToolResultsFixture();
      await browser.electron.restoreAllMocks();
      await clearAppData();
    }
  });

  for (const { variant, marker, reply } of cases) {
    it(`${variant}: One个 Read 成功、两个挂From时 Stop，下One轮必须收到AllResult`, async function () {
      this.timeout(150000);
      await skipOccupationOnboardingIfPresent();
      await prepareV4ConversationE2E();
      const toolIds = [1, 2, 3].map((index) => `toolu_stop_results_${variant}_${index}`);
      let sessionId: string | null = null;
      let stopClickedAt: string | null = null;
      try {
        await sendV4Prompt(`${marker}_START: 按序声明Three个 Read，WaitingToolsCompleted。`);
        const running = await waitForV4Pane(
          (pane) => pane.canStop && Boolean(pane.sessionId) && pane.sessionId !== "draft",
          "First turn not started",
        );
        sessionId = running.sessionId!;
        await waitForStopToolBarrier(sessionId, toolIds);
        stopClickedAt = new Date().toISOString();
        await clickV4Stop();
        await waitForV4Pane((pane) => !pane.canStop, "Stop did not conclude tool turn");
        expect(await getV4QueueItems()).toHaveLength(0);
        const stoppedLogs = await readStopToolLogs(sessionId);
        expect(
          stoppedLogs.filter(
            (record) =>
              record.module === "core.runtime" && record.event === "model.request.started",
          ),
        ).toHaveLength(1);
        for (const toolId of toolIds.slice(1)) {
          expect(
            stoppedLogs.some(
              (record) =>
                record.event === "tool.call.failed" &&
                record.toolCallId === toolId &&
                JSON.stringify(record.error).includes("TOOL_CANCELLED"),
            ),
          ).toBe(true);
        }

        await sendV4Prompt(`${marker}_FOLLOWUP: 请ContinueReply。`);
        let missingResultError: string | null = null;
        await browser.waitUntil(
          async () => {
            const logs = await readStopToolLogs(sessionId!);
            const missing = logs.find((record) =>
              JSON.stringify(record).includes("AI_MissingToolResultsError"),
            );
            if (missing) {
              missingResultError = JSON.stringify(missing);
              return true;
            }
            const pane = await getV4PaneSnapshot();
            return !pane.canStop && pane.timelineText.includes(reply);
          },
          { timeout: 45000, timeoutMsg: `${variant} Stop 后下One轮没有正常Completed` },
        );
        if (missingResultError) throw new Error(`Stop 后历史不Complete: ${missingResultError}`);

        const requests = await getUpstreamRequestEvidence({
          lastUserMessageIncludes: [`${marker}_FOLLOWUP`],
          excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]!.fixtureId).toBe(`stop-results-${variant}-followup`);
        expect(requests[0]!.status).toBe("complete");
        const results = assertPairedResults(requests[0]!.requestJson, toolIds);
        if (variant === "image") {
          expect(results[0]!.content).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "image",
                source: expect.objectContaining({
                  type: "base64",
                  data: expect.any(String),
                }),
              }),
            ]),
          );
          const image = (
            results[0]!.content as Array<{ type: string; source?: { data: string } }>
          ).find((block) => block.type === "image");
          expect(Buffer.from(image!.source!.data, "base64").length).toBeGreaterThan(0);
        } else expect(JSON.stringify(results[0]!.content)).toContain("STOP_RESULTS_TEXT_READ_OK");
        const completed = (await readStopToolLogs(sessionId)).filter(
          (record) => record.event === "tool.call.completed" && record.toolCallId === toolIds[0],
        );
        expect(completed).toHaveLength(1);
      } finally {
        await writeStopToolEvidence(variant, {
          sessionId,
          stopClickedAt,
          toolIds,
          pane: await getV4PaneSnapshot(),
          logs: sessionId ? await readStopToolLogs(sessionId) : [],
          requests: await getUpstreamRequestEvidence({ includes: [marker] }),
        });
      }
    });
  }

  for (const lockDatabase of [false, true]) {
    it(`database ${lockDatabase ? "locked" : "control"}: Plain text Bash 后不 Stop，续聊Result保持配对`, async function () {
      this.timeout(150000);
      await skipOccupationOnboardingIfPresent();
      await prepareV4ConversationE2E();
      await resetTextBashHook();
      const marker = "E2E_STOP_RESULTS_DB";
      const toolId = "toolu_stop_results_db_bash";
      const captureWindow = { afterIndex: (await getUpstreamRequestRecordCount()) - 1 };
      let sessionId: string | null = null;
      let releaseLock: (() => void) | undefined;
      let lockAcquiredAt: string | null = null;
      let lockReleasedAt: string | null = null;
      try {
        await sendV4Prompt(`${marker}_START: executeOne次短TextCommand。`);
        const running = await waitForV4Pane(
          (pane) => pane.canStop && Boolean(pane.sessionId) && pane.sessionId !== "draft",
          "Bash turn not started",
        );
        sessionId = running.sessionId!;
        await waitForTextBashBarrier(sessionId, toolId);
        if (lockDatabase) {
          releaseLock = holdToolResultDatabaseWriteLock();
          lockAcquiredAt = new Date().toISOString();
        }
        await releaseTextBashHook();
        if (lockDatabase) {
          await browser.waitUntil(
            async () =>
              (await readStopToolLogs(sessionId!)).some(
                (record) =>
                  record.event === "session.event.persistence.started" &&
                  ["turn_error", "turn_complete"].includes(record.context?.sessionEventType ?? ""),
              ),
            { timeout: 45000, timeoutMsg: "Write lock did not cause tool turn to enter failure cleanup" },
          );
          releaseLock?.();
          lockReleasedAt = new Date().toISOString();
        }
        await waitForV4Pane((pane) => !pane.canStop, "Plain text Bash turn not ended");
        const logs = await readStopToolLogs(sessionId);
        if (lockDatabase) expect(JSON.stringify(logs)).toContain("database is locked");
        else
          expect((await getV4PaneSnapshot()).timelineText).toContain("STOP_RESULTS_DB_INITIAL_OK");
        expect(await getV4QueueItems()).toHaveLength(0);

        await sendV4Prompt(`${marker}_FOLLOWUP: ContinueReply。`);
        let missingResultError: string | null = null;
        await browser.waitUntil(
          async () => {
            const missing = (await readStopToolLogs(sessionId!)).find((record) =>
              JSON.stringify(record).includes("AI_MissingToolResultsError"),
            );
            if (missing) {
              missingResultError = JSON.stringify(missing);
              return true;
            }
            const pane = await getV4PaneSnapshot();
            return !pane.canStop && pane.timelineText.includes("STOP_RESULTS_DB_OK");
          },
          { timeout: 45000, timeoutMsg: "Plain text Bash follow-up chat not completed" },
        );
        if (missingResultError)
          throw new Error(`Plain textData库故障后历史不Complete: ${missingResultError}`);
        const requests = await getUpstreamRequestEvidence(
          {
            lastUserMessageIncludes: [`${marker}_FOLLOWUP`],
            excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
          },
          captureWindow,
        );
        expect(requests).toHaveLength(1);
        const request = requests[0]!;
        expect(request.fixtureId).toBe("stop-results-db-followup");
        expect(request.status).toBe("complete");
        const results = assertPairedResults(request.requestJson, [toolId]);
        expect(JSON.stringify(results[0]!.content)).toContain("E2E_STOP_RESULTS_DB_OUTPUT");
        expect(results[0]!.is_error === true).toBe(false);
        expect(
          (await readStopToolLogs(sessionId)).filter(
            (record) => record.event === "tool.call.started" && record.toolCallId === toolId,
          ),
        ).toHaveLength(1);
      } finally {
        releaseLock?.();
        await releaseTextBashHook();
        await writeStopToolEvidence(lockDatabase ? "database-locked" : "database-control", {
          sessionId,
          lockAcquiredAt,
          lockReleasedAt,
          toolId,
          pane: await getV4PaneSnapshot(),
          logs: sessionId ? await readStopToolLogs(sessionId) : [],
          requests: await getUpstreamRequestEvidence({ includes: [marker] }, captureWindow),
        });
      }
    });
  }
});

function assertPairedResults(body: unknown, toolIds: string[]) {
  const messages = (body as { messages: Array<{ content: unknown }> }).messages;
  const blocks = messages.flatMap((message) =>
    Array.isArray(message.content) ? message.content : [],
  ) as Array<{
    type: string;
    id?: string;
    tool_use_id?: string;
    is_error?: boolean;
    content?: unknown;
  }>;
  const calls = blocks.filter(
    (block) => block.type === "tool_use" && toolIds.includes(block.id ?? ""),
  );
  const results = blocks.filter(
    (block) => block.type === "tool_result" && toolIds.includes(block.tool_use_id ?? ""),
  );
  expect(calls.map((block) => block.id)).toEqual(toolIds);
  expect(results.map((block) => block.tool_use_id)).toEqual(toolIds);
  if (toolIds.length === 3) {
    expect(results.map((block) => block.is_error === true)).toEqual([false, true, true]);
  }
  return results;
}
