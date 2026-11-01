import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  countUpstreamRequests,
  getUpstreamRequestEvidence,
} from "../../../helpers/conversation-session-network.js";
import {
  getV4CompactMarkers,
  prepareV4ConversationE2E,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4AssistantMessageContaining,
  waitForV4ConversationState,
} from "../../../helpers/v4-conversation.js";
import {
  buildFixtureId,
  buildSubcaseMarker,
  COMPACT_REQUEST_QUERY,
  MARKDOWN_CONTINUE_CASES,
  removeMarkdownFixtures,
  writeMarkdownFixtures,
} from "./conversation-session-output-limit-continue-markdown-content-types.cases.js";
import {
  assertMarkdownCase,
  isMarkdownCaseReady,
  readMarkdownCaseSnapshot,
} from "./conversation-session-output-limit-continue-markdown-content-types.dom.js";

const CASE_MARKER = "E2E_OUTPUT_LIMIT_CONTINUE_MARKDOWN_CONTENT_TYPES";

describe("Output-limit Continue Markdown standalone content type manual review", () => {
  before(async function () {
    this.timeout(180000);
    await writeMarkdownFixtures();
    await prepareV4ConversationE2E();
  });

  beforeEach(async () => {
    await startNewV4Draft();
  });

  after(async function () {
    const holdMs = readManualReviewHoldMs();
    this.timeout(30000 + holdMs);

    if (holdMs > 0) {
      await browser.pause(holdMs);
    }

    await browser.electron.restoreAllMocks();
    await clearAppData();
    await removeMarkdownFixtures();
  });

  for (const definition of MARKDOWN_CONTINUE_CASES) {
    it(`OTC10/${definition.id}: 本类型独立跨 Continue 后只渲染One个Complete assistant`, async function () {
      this.timeout(120000);

      const marker = buildSubcaseMarker(definition.id);
      const mainRequestQuery = {
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
        includes: [CASE_MARKER, marker],
      };

      await sendV4Prompt(
        `${CASE_MARKER} ${marker}: 请严格按 provider fixture Back本 Markdown 类型的两段CumulativeBody。`,
      );
      await waitForV4AssistantMessageContaining(definition.finalAnchor);
      await waitForV4ConversationState(
        (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
        `OTC10/${definition.id} Continue 恢复链Completed后没有回到 idle`,
        90000,
      );

      await browser.waitUntil(async () => (await countUpstreamRequests(mainRequestQuery)) === 2, {
        timeout: 30000,
        timeoutMsg: `OTC10/${definition.id} 没有严格Completed length 与 stop 两次主Request`,
      });
      const evidence = await getUpstreamRequestEvidence(mainRequestQuery);
      expect(evidence.map((item) => item.fixtureId)).toEqual([
        buildFixtureId(definition.id, "partial"),
        buildFixtureId(definition.id, "final"),
      ]);
      expect(evidence.every((item) => item.status === "complete")).toBe(true);
      expect(evidence[0]?.responseTextPreview).toContain('"stop_reason":"max_tokens"');
      expect(evidence[1]?.responseTextPreview).toContain('"stop_reason":"end_turn"');
      expect(await countUpstreamRequests(COMPACT_REQUEST_QUERY)).toBe(0);
      expect(await getV4CompactMarkers()).toEqual([]);

      await browser.waitUntil(
        async () => isMarkdownCaseReady(definition.id, await readMarkdownCaseSnapshot(marker)),
        {
          timeout: 30000,
          timeoutMsg: `OTC10/${definition.id} 的Final Markdown DOM 没有收敛`,
        },
      );

      const snapshot = await readMarkdownCaseSnapshot(marker);
      expect(snapshot.turnId).toBeTruthy();
      expect(snapshot.assistantRows).toHaveLength(1);
      expect(snapshot.assistantRows[0]?.inHistory).toBe(false);
      expect(snapshot.assistantRows[0]?.rowId).toBeTruthy();
      expect(snapshot.assistantRows[0]?.text).toContain(definition.finalAnchor);
      assertMarkdownCase(definition.id, snapshot);
    });
  }
});

function readManualReviewHoldMs(): number {
  const parsed = Number(process.env.CF_E2E_MANUAL_REVIEW_HOLD_MS ?? "0");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}
