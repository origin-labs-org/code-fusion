import { TID_V4_TIMELINE, TID_V4_TIMELINE_LOAD_OLDER } from "@origin-ai/cf-shared/test-ids";
import { clearAppData } from "../helpers/desktop-app.js";
import {
  getV4PaneSnapshot,
  getV4TimelineScrollState,
  prepareV4ConversationE2E,
  scrollV4TimelineToTop,
  selectV4TaskById,
  sendV4Prompt,
  startNewV4Draft,
  waitForV4ComposerText,
  waitForV4ConversationState,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const KEEP_WARM_EXPIRY_MS = 2_000;

const HISTORY_TURNS = 21;
const SNAPSHOT_TAIL_RAW_ROWS = 60;
const PREPEND_ANCHOR_MAX_DELTA_PX = 48;

interface V4TimelineWindowObservation {
  firstVisibleOffsetTop: number | null;
  firstVisibleTurnId: string | null;
  renderUnitCount: number;
  totalRowCount: number;
  visibleTurnOffsets: Record<string, number>;
  windowRowCount: number;
}

function hasV4LoadOlderButton(): Promise<boolean> {
  return browser.execute(
    (loadOlderTestId) => Boolean(document.querySelector(`[data-testid="${loadOlderTestId}"]`)),
    TID_V4_TIMELINE_LOAD_OLDER,
  );
}

function startV4TimelineWindowObservation(): Promise<void> {
  return browser.execute((timelineTestId) => {
    interface BrowserObservationState {
      capture: () => void;
      frame: number | null;
      observer: MutationObserver;
      samples: V4TimelineWindowObservation[];
    }
    const target = window as typeof window & {
      __cfV4TimelineWindowObservation?: BrowserObservationState;
    };
    target.__cfV4TimelineWindowObservation?.observer.disconnect();

    const samples: V4TimelineWindowObservation[] = [];
    const capture = () => {
      const timeline = document.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
      if (!timeline) return;
      const timelineTop = timeline.getBoundingClientRect().top;
      const visibleTurnOffsets: Record<string, number> = {};
      for (const unit of timeline.querySelectorAll<HTMLElement>('[data-v4-turn-unit="true"]')) {
        const turnId = unit.dataset.turnId;
        if (!turnId) continue;
        const rect = unit.getBoundingClientRect();
        const offsetTop = rect.top - timelineTop;
        if (rect.bottom - timelineTop <= 0 || offsetTop >= timeline.clientHeight) continue;
        visibleTurnOffsets[turnId] = offsetTop;
      }
      const firstVisibleEntry =
        Object.entries(visibleTurnOffsets).sort((left, right) => left[1] - right[1])[0] ?? null;
      const sample: V4TimelineWindowObservation = {
        firstVisibleOffsetTop: firstVisibleEntry?.[1] ?? null,
        firstVisibleTurnId: firstVisibleEntry?.[0] ?? null,
        renderUnitCount: Number(timeline.dataset.renderUnitCount ?? 0),
        totalRowCount: Number(timeline.dataset.totalRowCount ?? 0),
        visibleTurnOffsets,
        windowRowCount: Number(timeline.dataset.windowRowCount ?? 0),
      };
      const previous = samples.at(-1);
      if (
        previous &&
        previous.windowRowCount === sample.windowRowCount &&
        previous.totalRowCount === sample.totalRowCount &&
        previous.firstVisibleTurnId === sample.firstVisibleTurnId &&
        Math.abs((previous.firstVisibleOffsetTop ?? 0) - (sample.firstVisibleOffsetTop ?? 0)) < 0.5
      ) {
        return;
      }
      samples.push(sample);
    };
    const observer = new MutationObserver(() => {
      capture();
      const state = target.__cfV4TimelineWindowObservation;
      if (!state) return;
      if (state.frame !== null) cancelAnimationFrame(state.frame);
      state.frame = requestAnimationFrame(capture);
    });
    observer.observe(document.documentElement, {
      attributeFilter: ["data-render-unit-count", "data-total-row-count", "data-window-row-count"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    target.__cfV4TimelineWindowObservation = {
      capture,
      frame: null,
      observer,
      samples,
    };
    capture();
  }, TID_V4_TIMELINE);
}

async function stopV4TimelineWindowObservation(): Promise<V4TimelineWindowObservation[]> {
  return await browser.execute(async () => {
    const target = window as typeof window & {
      __cfV4TimelineWindowObservation?: {
        capture: () => void;
        frame: number | null;
        observer: MutationObserver;
        samples: V4TimelineWindowObservation[];
      };
    };
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const state = target.__cfV4TimelineWindowObservation;
    if (!state) return [];
    state.capture();
    state.observer.disconnect();
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    delete target.__cfV4TimelineWindowObservation;
    return state.samples;
  });
}

function getObservedPrependAnchorState(fullRawRows: number): Promise<{
  samples: V4TimelineWindowObservation[];
  stable: boolean;
}> {
  return browser.execute(
    (expectedFullRawRows, snapshotTailRawRows, historyTurns, maxDeltaPx) => {
      const target = window as typeof window & {
        __cfV4TimelineWindowObservation?: {
          capture: () => void;
          samples: V4TimelineWindowObservation[];
        };
      };
      const state = target.__cfV4TimelineWindowObservation;
      if (!state) return { samples: [], stable: false };
      state.capture();
      const truncatedIndex = state.samples.findIndex(
        (sample) =>
          sample.windowRowCount === snapshotTailRawRows &&
          sample.totalRowCount === expectedFullRawRows &&
          sample.renderUnitCount > 0 &&
          sample.renderUnitCount < historyTurns,
      );
      const prefetchedIndex = state.samples.findIndex(
        (sample, index) => index > truncatedIndex && sample.windowRowCount > snapshotTailRawRows,
      );
      if (truncatedIndex < 0 || prefetchedIndex <= truncatedIndex) {
        return { samples: state.samples.slice(-12), stable: false };
      }
      const stable = state.samples
        .slice(truncatedIndex, prefetchedIndex)
        .some((anchorBefore) =>
          state.samples
            .slice(prefetchedIndex)
            .some((prefetched) =>
              Object.entries(anchorBefore.visibleTurnOffsets).some(
                ([turnId, beforeOffset]) =>
                  prefetched.visibleTurnOffsets[turnId] !== undefined &&
                  Math.abs(prefetched.visibleTurnOffsets[turnId] - beforeOffset) < maxDeltaPx,
              ),
            ),
        );
      return { samples: state.samples.slice(-12), stable };
    },
    fullRawRows,
    SNAPSHOT_TAIL_RAW_ROWS,
    HISTORY_TURNS,
    PREPEND_ANCHOR_MAX_DELTA_PX,
  );
}

describe("v4 HLP02 门禁：长历史无感分页（R-06）", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("尾窗截断 → 自动预取补页 → 顶部可达且 prepend 不跳", async function () {
    this.timeout(180000);
    await prepareV4ConversationE2E();

    for (let index = 1; index <= HISTORY_TURNS; index += 1) {
      const marker = String(index).padStart(3, "0");
      await sendV4Prompt(`E2E_V4_OLDER_HISTORY_${marker} 历史轮次`);
      await browser.waitUntil(
        async () => (await getV4TimelineScrollState()).renderUnitCount >= index,
        { timeout: 30000, timeoutMsg: `第 ${index} 个历史 turn 没有Completed投影` },
      );
      await waitForV4ConversationState(
        (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
        `第 ${index} 个历史 turn 没有回到 idle`,
        30_000,
      );
      await waitForV4ComposerText("", `第 ${index} 个历史 turn 后 composer 没有Clear`, 30_000);
    }

    const sessionId = (await getV4PaneSnapshot()).sessionId as string;
    expect(sessionId).not.toBe("draft");

    const live = await getV4TimelineScrollState();
    const fullRawRows = live.totalRowCount;
    expect(fullRawRows).toBeGreaterThan(SNAPSHOT_TAIL_RAW_ROWS);
    expect(live.windowRowCount).toBe(live.totalRowCount);
    expect(live.renderUnitCount).toBe(HISTORY_TURNS);
    expect(await hasV4LoadOlderButton()).toBe(false);

    await startNewV4Draft();
    await browser.pause(KEEP_WARM_EXPIRY_MS);
    await startV4TimelineWindowObservation();
    await selectV4TaskById(sessionId);
    await waitForV4Pane(
      (s) => s.sessionId === sessionId && s.rowCount > 0,
      "切回原会话后 pane 没有绑定/收到快照",
      30000,
    );

    const stateAfterSubscribe = await getV4TimelineScrollState();
    expect(await hasV4LoadOlderButton()).toBe(false);

    if (stateAfterSubscribe.windowRowCount === SNAPSHOT_TAIL_RAW_ROWS) {
      await scrollV4TimelineToTop();

      await browser.waitUntil(
        async () => (await getV4TimelineScrollState()).windowRowCount > SNAPSHOT_TAIL_RAW_ROWS,
        {
          timeout: 30000,
          timeoutMsg: "滚动到顶后 loadOlder 没有把更早的行并入窗口",
        },
      );
    } else {
      await browser.waitUntil(
        async () => (await getV4TimelineScrollState()).windowRowCount === fullRawRows,
        {
          timeout: 30000,
          timeoutMsg: "恢复期自动预取没有把更早的行并入窗口",
        },
      );
    }

    let observedAnchorState = await getObservedPrependAnchorState(fullRawRows);
    try {
      await browser.waitUntil(
        async () => {
          observedAnchorState = await getObservedPrependAnchorState(fullRawRows);
          return observedAnchorState.stable;
        },
        {
          timeout: 15_000,
          interval: 50,
          timeoutMsg: "prepend 后虚拟列表没有恢复补页前的视口锚点",
        },
      );
    } catch (error) {
      throw new Error(`prepend 锚点采样：${JSON.stringify(observedAnchorState.samples)}`, {
        cause: error,
      });
    }

    const observations = await stopV4TimelineWindowObservation();
    const truncatedIndex = observations.findIndex(
      (sample) =>
        sample.windowRowCount === SNAPSHOT_TAIL_RAW_ROWS &&
        sample.totalRowCount === fullRawRows &&
        sample.renderUnitCount > 0 &&
        sample.renderUnitCount < HISTORY_TURNS,
    );
    expect(truncatedIndex).toBeGreaterThanOrEqual(0);

    const prefetchedIndex = observations.findIndex(
      (sample, index) => index > truncatedIndex && sample.windowRowCount > SNAPSHOT_TAIL_RAW_ROWS,
    );
    expect(prefetchedIndex).toBeGreaterThan(truncatedIndex);

    const complete = await getV4TimelineScrollState();
    expect(complete.windowRowCount).toBe(complete.totalRowCount);
    expect(complete.renderUnitCount).toBe(HISTORY_TURNS);
    expect(await hasV4LoadOlderButton()).toBe(false);

    await scrollV4TimelineToTop();
    await waitForV4TimelineContaining("E2E_V4_OLDER_HISTORY_001", 15000);
  });
});
