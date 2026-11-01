import { skipOccupationOnboardingIfPresent } from "../helpers/occupation-onboarding.js";
import { clearAppData } from "../helpers/desktop-app.js";
import {
  clickV4TimelineBackToBottom,
  getV4TimelineScrollState,
  prepareV4ConversationE2E,
  scrollV4TimelineToTop,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

describe("v4 M5④ 门禁：长会话虚拟滚动", () => {
  const HISTORY_TURNS = 14;
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("50+ lines of history: bottom-anchored autoscroll → top reachable → streaming does not pull back → return to bottom", async () => {
    await skipOccupationOnboardingIfPresent();
    await prepareV4ConversationE2E();

    for (let index = 1; index <= HISTORY_TURNS; index += 1) {
      const marker = String(index).padStart(3, "0");
      await sendV4Prompt(`E2E_V4_SCROLL_HISTORY_${marker} LongSession历史`);
      await browser.waitUntil(
        async () => {
          const state = await getV4TimelineScrollState();
          return state.renderUnitCount >= index && state.windowRowCount >= index * 3;
        },
        { timeout: 30000, timeoutMsg: `第 ${index} 个 scroll history turn 未Completed` },
      );
    }

    const anchored = await getV4TimelineScrollState();
    const sessionA = await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== null,
      "Long session is not bound to a session id",
    );
    if (!sessionA.sessionId) throw new Error("长会话 session id 缺失");
    expect(anchored.windowRowCount).toBeGreaterThanOrEqual(HISTORY_TURNS * 3);
    expect(anchored.renderUnitCount).toBe(HISTORY_TURNS);
    expect(anchored.following).toBe("true");
    expect(anchored.mountedRenderUnitCount).toBeLessThan(anchored.renderUnitCount);
    expect(anchored.scrollHeight).toBeGreaterThan(anchored.clientHeight * 2);

    await scrollV4TimelineToTop();
    await waitForV4TimelineContaining("E2E_V4_SCROLL_HISTORY_001", 15000);
    await browser.waitUntil(
      async () => {
        const state = await getV4TimelineScrollState();
        return state.following === "false" && state.hasBackToBottom;
      },
      {
        timeout: 10000,
        timeoutMsg: "Scrolling up from bottom did not unstick autoscroll / show return-to-bottom button",
      },
    );

    const savedHistoricalPosition = await getV4TimelineScrollState();
    await startNewV4Draft();
    await selectV4TaskById(sessionA.sessionId);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === sessionA.sessionId,
      "切回长会话后 session 没有恢复",
    );
    await browser.waitUntil(
      async () => {
        const restored = await getV4TimelineScrollState();
        return (
          restored.following === "false" &&
          restored.hasBackToBottom &&
          Math.abs(restored.scrollTop - savedHistoricalPosition.scrollTop) <= 4
        );
      },
      {
        timeout: 15000,
        timeoutMsg: "Off-bottom reading position not restored after switching back to long session",
      },
    );

    await clickV4TimelineBackToBottom();
    await sendV4Prompt("E2E_V4_SCROLL_TURN2 保持输出");
    await waitForV4TimelineContaining("V4_SCROLL_TURN2_STREAMING", 45000);
    await waitForV4Pane((s) => s.canStop, "Stop button did not appear during turn2 streaming");

    await scrollV4TimelineToTop();
    await waitForV4TimelineContaining("E2E_V4_SCROLL_HISTORY_001", 15000);
    for (let sample = 0; sample < 4; sample += 1) {
      await browser.pause(700);
      const during = await getV4TimelineScrollState();
      expect(during.scrollTop).toBeLessThan(200);
      expect(during.following).toBe("false");
    }
    const midStream = await waitForV4Pane(() => true, "读取流式中 pane 状态失败", 5000);
    expect(midStream.canStop).toBe(true);

    await clickV4TimelineBackToBottom();
    const beforeBackgroundOutput = await waitForV4Pane(
      (snapshot) => snapshot.timelineText.includes("turn2 持续输出片段"),
      "切走前没有可比较的 turn2 流式片段",
    );
    const beforeBackgroundFragmentCount =
      beforeBackgroundOutput.timelineText.match(/turn2 continuous output chunk/g)?.length ?? 0;
    await startNewV4Draft();
    await browser.pause(1200);
    await selectV4TaskById(sessionA.sessionId);
    const afterBackgroundOutput = await waitForV4Pane((snapshot) => {
      const fragmentCount = snapshot.timelineText.match(/turn2 continuous output chunk/g)?.length ?? 0;
      return (
        snapshot.sessionId === sessionA.sessionId && fragmentCount > beforeBackgroundFragmentCount
      );
    }, "Projection did not restore new fragments after switching back to original session during background streaming");
    const afterBackgroundFragmentCount =
      afterBackgroundOutput.timelineText.match(/turn2 continuous output chunk/g)?.length ?? 0;
    expect(afterBackgroundFragmentCount).toBeGreaterThan(beforeBackgroundFragmentCount);
    await browser.waitUntil(
      async () => {
        const restored = await getV4TimelineScrollState();
        const distanceToBottom = Math.max(
          0,
          restored.scrollHeight - restored.clientHeight - restored.scrollTop,
        );
        return restored.following === "true" && distanceToBottom <= 48;
      },
      {
        timeout: 15000,
        timeoutMsg: "Did not scroll to current latest bottom after switching back to pinned session",
      },
    );
    await waitForV4TimelineContaining("V4_SCROLL_TURN2_DONE", 60000);
    await waitForV4Pane((s) => !s.canStop, "turn2 没有回到空闲态", 45000);
    const final = await getV4TimelineScrollState();
    expect(final.following).toBe("true");
    expect(final.hasBackToBottom).toBe(false);
  });
});
