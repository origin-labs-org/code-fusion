import { describe, expect, it } from "vitest";
import {
  BOTTOM_ANCHOR_EPSILON_PX,
  LOAD_OLDER_PREFETCH_VIEWPORTS,
  LOAD_OLDER_TRIGGER_PX,
  UNOBSERVED_SCROLL_EPSILON_PX,
  anchorActionAfterContentChange,
  distanceToBottom,
  historyPrefetchTriggerPx,
  initialFollowing,
  isAtBottom,
  nextFollowingAfterScroll,
  prependScrollAdjustment,
  prependVirtualAnchorAdjustment,
  reconcileFollowingForContentAnchor,
  resolveFollowingAfterScroll,
  shouldAdjustVirtualizerForItemSizeChange,
  shouldShowBackToBottom,
  shouldTriggerLoadOlder,
  timelineKeyboardScrollIntent,
  timelineTouchScrollIntent,
  timelineWheelScrollIntent,
} from "@/v4/timelineScrollAnchor.js";

const metrics = (scrollTop: number, viewportHeight: number, contentHeight: number) => ({
  scrollTop,
  viewportHeight,
  contentHeight,
});

describe("timelineScrollAnchor", () => {
  it("distanceToBottom：正常滚动区间与inner容不足One屏（不为负）", () => {
    expect(distanceToBottom(metrics(0, 600, 2000))).toBe(1400);
    expect(distanceToBottom(metrics(1400, 600, 2000))).toBe(0);
    expect(distanceToBottom(metrics(0, 600, 300))).toBe(0);
  });

  it("isAtBottom：容差inner视为在底（亚像素/最后One行 padding）", () => {
    expect(isAtBottom(metrics(1400, 600, 2000))).toBe(true);
    expect(isAtBottom(metrics(1400 - BOTTOM_ANCHOR_EPSILON_PX, 600, 2000))).toBe(true);
    expect(isAtBottom(metrics(1400 - BOTTOM_ANCHOR_EPSILON_PX - 1, 600, 2000))).toBe(false);
    expect(isAtBottom(metrics(0, 600, 300))).toBe(true);
  });

  it("初始态Follow底部（打开Session定位最NewMessages）", () => {
    expect(initialFollowing()).toBe(true);
  });

  it("Status机：User上滚离底 → 解除Follow；滚回底部 → 恢复Follow", () => {
    let following = initialFollowing();
    following = nextFollowingAfterScroll(metrics(500, 600, 2000));
    expect(following).toBe(false);
    following = nextFollowingAfterScroll(metrics(1400, 600, 2000));
    expect(following).toBe(true);
  });

  it("只有User scroll 改变滚动权，terminal/virtualizer 布局回退保持原Status", () => {
    const layoutMetrics = metrics(900, 600, 2000);
    expect(
      resolveFollowingAfterScroll({
        following: true,
        metrics: layoutMetrics,
        source: "layout",
      }),
    ).toBe(true);
    expect(
      resolveFollowingAfterScroll({
        following: false,
        metrics: metrics(1400, 600, 2000),
        source: "programmatic",
      }),
    ).toBe(false);
    expect(
      resolveFollowingAfterScroll({
        following: true,
        metrics: layoutMetrics,
        source: "user",
      }),
    ).toBe(false);
  });

  it("inner容增Long动作：FollowMedium贴底，解除Follow保持阅读Location（Streaming不拉回）", () => {
    expect(anchorActionAfterContentChange(true)).toBe("stickToBottom");
    expect(anchorActionAfterContentChange(false)).toBe("hold");
  });

  it("宽度 resize 期间吸底也暂停逐批追底，稳定后恢复", () => {
    expect(anchorActionAfterContentChange(true, true)).toBe("hold");
    expect(anchorActionAfterContentChange(true, false)).toBe("stickToBottom");
  });

  it("解除Follow期间inner容持续增Long：多轮 delta 均不产生贴底动作", () => {
    let following = nextFollowingAfterScroll(metrics(200, 600, 2000));
    expect(following).toBe(false);
    for (const grownHeight of [2400, 3000, 5000]) {
      expect(anchorActionAfterContentChange(following)).toBe("hold");
      following = nextFollowingAfterScroll(metrics(210, 600, grownHeight));
      expect(following).toBe(false);
    }
  });

  it("回到底部按钮：仅解除Follow且有inner容时展示", () => {
    expect(shouldShowBackToBottom(false, 10)).toBe(true);
    expect(shouldShowBackToBottom(true, 10)).toBe(false);
    expect(shouldShowBackToBottom(false, 0)).toBe(false);
  });

  it("宽度 resize 期间禁止逐行补偿，稳定后只补偿视口上方行", () => {
    expect(
      shouldAdjustVirtualizerForItemSizeChange({
        following: false,
        suppressAdjustment: false,
        contentWidthChanging: true,
        itemEnd: 100,
        scrollTop: 300,
      }),
    ).toBe(false);
    expect(
      shouldAdjustVirtualizerForItemSizeChange({
        following: false,
        suppressAdjustment: false,
        contentWidthChanging: false,
        itemEnd: 100,
        scrollTop: 300,
      }),
    ).toBe(true);
    expect(
      shouldAdjustVirtualizerForItemSizeChange({
        following: false,
        suppressAdjustment: false,
        contentWidthChanging: false,
        itemEnd: 400,
        scrollTop: 300,
      }),
    ).toBe(false);
  });
});

describe("reconcileFollowingForContentAnchor", () => {
  it("程序化 scrollToTop 后、scroll Events未派发时的测量/resize commit：不夺滚动权", () => {
    const following = reconcileFollowingForContentAnchor({
      following: true,
      metrics: metrics(0, 600, 2000),
      lastObservedScrollTop: 1400,
    });
    expect(following).toBe(false);
    expect(anchorActionAfterContentChange(following)).toBe("hold");
  });

  it("scrollToTop 解除Follow后，后续 resize/测量 commit 不复活Follow", () => {
    let following = false;
    for (const contentHeight of [2000, 2600, 3200]) {
      following = reconcileFollowingForContentAnchor({
        following,
        metrics: metrics(0, 600, contentHeight),
        lastObservedScrollTop: 0,
      });
      expect(following).toBe(false);
    }
  });

  it("terminal 折叠造成 scrollTop 回退但没有UserInput：保持 following 并Continue贴底", () => {
    const following = reconcileFollowingForContentAnchor({
      following: true,
      metrics: metrics(720, 600, 1800),
      lastObservedScrollTop: 1400,
      userScrollIntent: "none",
    });
    expect(following).toBe(true);
    expect(anchorActionAfterContentChange(following)).toBe("stickToBottom");
  });

  it("User向上滚动与 terminal commit 同帧：User意图优先于临时在底几何", () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metrics(600, 600, 1200),
        lastObservedScrollTop: 1400,
        userScrollIntent: "awayFromBottom",
      }),
    ).toBe(false);
  });

  it("FollowMediumStreaming增Long（scrollTop 未动，仅inner容撑High）：照常贴底", () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metrics(1400, 600, 2400),
        lastObservedScrollTop: 1400,
      }),
    ).toBe(true);
  });

  it("视口增High把 scrollTop 钳回底部（回退但在底）：Follow保持，不误判为上滚", () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metrics(1200, 800, 2000),
        lastObservedScrollTop: 1400,
      }),
    ).toBe(true);
  });

  it("亚像素回退（≤ 容差）不解除Follow", () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metrics(1300 - UNOBSERVED_SCROLL_EPSILON_PX, 600, 2400),
        lastObservedScrollTop: 1300,
      }),
    ).toBe(true);
  });

  it("未观察的下滚落点在底：恢复Follow（与 scroll Events语义One致）", () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: false,
        metrics: metrics(1400, 600, 2000),
        lastObservedScrollTop: 500,
      }),
    ).toBe(true);
  });

  it("解除Follow的Medium部阅读位（scrollTop 未动）：inner容变化 commit 保持解除", () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: false,
        metrics: metrics(500, 600, 2400),
        lastObservedScrollTop: 500,
      }),
    ).toBe(false);
  });
});

describe("timeline user scroll intent", () => {
  it("区分 wheel 向上离底与向下回底", () => {
    expect(timelineWheelScrollIntent(-20)).toBe("awayFromBottom");
    expect(timelineWheelScrollIntent(20)).toBe("towardBottom");
    expect(timelineWheelScrollIntent(0)).toBe("none");
  });

  it("touch 手Point to下移表示阅读更早inner容", () => {
    expect(timelineTouchScrollIntent(300, 340)).toBe("awayFromBottom");
    expect(timelineTouchScrollIntent(340, 300)).toBe("towardBottom");
  });

  it("键盘导航区分方向，并IgnoreInput控件里的光Label按键", () => {
    expect(
      timelineKeyboardScrollIntent({
        key: "PageUp",
        shiftKey: false,
        editableTarget: false,
      }),
    ).toBe("awayFromBottom");
    expect(
      timelineKeyboardScrollIntent({
        key: "End",
        shiftKey: false,
        editableTarget: false,
      }),
    ).toBe("towardBottom");
    expect(
      timelineKeyboardScrollIntent({
        key: "ArrowUp",
        shiftKey: false,
        editableTarget: true,
      }),
    ).toBe("none");
  });

  it("滚动条方向Unknown时只由真实 scroll 落点Adjudication", () => {
    expect(
      reconcileFollowingForContentAnchor({
        following: true,
        metrics: metrics(800, 600, 2000),
        lastObservedScrollTop: 1400,
        userScrollIntent: "unknown",
      }),
    ).toBe(false);
  });
});

describe("prependScrollAdjustment", () => {
  it("优先按同One可见 turn 的稳定 virtual measurement 校正 prepend", () => {
    expect(
      prependVirtualAnchorAdjustment(
        { key: "turn-21", offsetTop: -88, start: 12 },
        { key: "turn-21", offsetTop: -88, start: 227 },
        100,
      ),
    ).toBe(215);
    expect(
      prependVirtualAnchorAdjustment(
        { key: "turn-21", offsetTop: -88, start: 12 },
        { key: "turn-other", offsetTop: -88, start: 227 },
        100,
      ),
    ).toBeNull();
  });

  it("触发补页后 scrollTop 又被布局改写时仍恢复触发瞬间的视口偏移", () => {
    expect(
      prependVirtualAnchorAdjustment(
        { key: "turn-21", offsetTop: -80, start: 120 },
        { key: "turn-21", offsetTop: 0, start: 420 },
        660,
      ),
    ).toBe(-160);
  });

  it("真前插（首行 rowId 变小且总High度增Long）→ 平移量 = High度差", () => {
    expect(
      prependScrollAdjustment({
        prevFirstRowId: 61,
        nextFirstRowId: 1,
        prevTotalSize: 6000,
        nextTotalSize: 12000,
      }),
    ).toBe(6000);
  });

  it("尾部Append/Streaming增Long（首行不变）→ 不平移", () => {
    expect(
      prependScrollAdjustment({
        prevFirstRowId: 1,
        nextFirstRowId: 1,
        prevTotalSize: 6000,
        nextTotalSize: 6400,
      }),
    ).toBeNull();
  });

  it("首帧（prev 无行）与Clear（next 无行）→ 不平移", () => {
    expect(
      prependScrollAdjustment({
        prevFirstRowId: null,
        nextFirstRowId: 1,
        prevTotalSize: 0,
        nextTotalSize: 6000,
      }),
    ).toBeNull();
    expect(
      prependScrollAdjustment({
        prevFirstRowId: 1,
        nextFirstRowId: null,
        prevTotalSize: 6000,
        nextTotalSize: 0,
      }),
    ).toBeNull();
  });

  it("row.removed 截断（首行变大）→ 不平移（交To底部锚定）", () => {
    expect(
      prependScrollAdjustment({
        prevFirstRowId: 1,
        nextFirstRowId: 10,
        prevTotalSize: 6000,
        nextTotalSize: 3000,
      }),
    ).toBeNull();
  });

  it("异常：首行变小但总High度未增Long（同帧收缩测量）→ 不产生负平移", () => {
    expect(
      prependScrollAdjustment({
        prevFirstRowId: 61,
        nextFirstRowId: 1,
        prevTotalSize: 6000,
        nextTotalSize: 5000,
      }),
    ).toBeNull();
  });
});

describe("shouldTriggerLoadOlder", () => {
  it("HLP02：提前两个视口进入预取区，Unknown视口回落到顶边阈Value", () => {
    const triggerPx = historyPrefetchTriggerPx(700);
    expect(triggerPx).toBe(700 * LOAD_OLDER_PREFETCH_VIEWPORTS);
    expect(historyPrefetchTriggerPx(0)).toBe(LOAD_OLDER_TRIGGER_PX);
    expect(historyPrefetchTriggerPx(Number.NaN)).toBe(LOAD_OLDER_TRIGGER_PX);
    expect(
      shouldTriggerLoadOlder({
        scrollTop: triggerPx - 1,
        canLoadOlder: true,
        loadingOlder: false,
        triggerPx,
      }),
    ).toBe(true);
    expect(
      shouldTriggerLoadOlder({
        scrollTop: triggerPx + 1,
        canLoadOlder: true,
        loadingOlder: false,
        triggerPx,
      }),
    ).toBe(false);
  });

  it("到顶 + 可拉 + 非在途 → 触发", () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: 0,
        canLoadOlder: true,
        loadingOlder: false,
      }),
    ).toBe(true);
    expect(
      shouldTriggerLoadOlder({
        scrollTop: LOAD_OLDER_TRIGGER_PX,
        canLoadOlder: true,
        loadingOlder: false,
      }),
    ).toBe(true);
  });

  it("离顶 / 已到全序首行 / 在途Medium → 不触发", () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: LOAD_OLDER_TRIGGER_PX + 1,
        canLoadOlder: true,
        loadingOlder: false,
      }),
    ).toBe(false);
    expect(
      shouldTriggerLoadOlder({
        scrollTop: 0,
        canLoadOlder: false,
        loadingOlder: false,
      }),
    ).toBe(false);
    expect(
      shouldTriggerLoadOlder({
        scrollTop: 0,
        canLoadOlder: true,
        loadingOlder: true,
      }),
    ).toBe(false);
  });
});
