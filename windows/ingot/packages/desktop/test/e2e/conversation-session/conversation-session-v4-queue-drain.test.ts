import { clearAppData } from "../helpers/desktop-app.js";
import {
  getV4QueueItems,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4QueueCount,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 catalog C02: automatic queue consumption and message retention", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Enqueue while running → auto drain → queued text becomes visible user row + reply appears", async () => {
    await prepareV4ConversationE2E();

    await sendV4Prompt("E2E_V4_DRAIN_SLOW 慢慢回答");
    await waitForV4TimelineContaining("V4_DRAIN_STREAMING", 45000);
    await waitForV4Pane(
      (s) => s.canStop && s.sessionId !== "draft" && s.sessionId !== null,
      "First round did not enter running (canStop)",
      45000,
    );

    await sendV4Prompt("E2E_V4_DRAIN_Q1 排队等答的问题");
    await waitForV4QueueCount(1, 30000);

    await waitForV4TimelineContaining("V4_DRAIN_Q1_REPLY", 60000);
    await waitForV4QueueCount(0, 15000);

    const snapshot = await waitForV4Pane(
      (s) => s.timelineText.includes("E2E_V4_DRAIN_Q1"),
      "Drained queued text was not added to the timeline as a visible user row",
      15000,
    );
    expect(snapshot.timelineText).toContain("V4_DRAIN_Q1_REPLY");
    expect(await getV4QueueItems()).toHaveLength(0);

    await waitForV4Pane((s) => !s.canStop, "drain 后没有回到 idle", 45000);
  });
});
