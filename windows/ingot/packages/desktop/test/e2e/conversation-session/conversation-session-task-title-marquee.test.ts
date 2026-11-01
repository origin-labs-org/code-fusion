import {
  TID_TASK_ITEM,
  TID_WORKSPACE_HEADER,
  TID_WORKSPACE_PATH,
  TID_WORKSPACE_TITLE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import { DEFAULT_WORKSPACE, clearAppData, waitForWorkspaceApp } from "../helpers/desktop-app.js";
import { ensureProjectExpanded } from "../helpers/project-sidebar.js";
import {
  TASK_TITLE_MARQUEE_LONG_ID,
  TASK_TITLE_MARQUEE_PINNED_ID,
  TASK_TITLE_MARQUEE_SHORT_ID,
} from "../helpers/task-title-marquee-fixture.js";

const CASE_TIMEOUT_MS = 180_000;

interface TitleSnapshot {
  animationCount: number;
  copyCount: number;
  duplicateAriaHidden: string | null;
  maskImage: string;
  nativeTitle: string | null;
  overflow: boolean;
  rowWidth: number;
  titleWidth: number;
  trackWidth: number;
}

describe("TTL：Task 名称溢出走马灯", () => {
  before(async () => {
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    await ensureProjectExpanded(DEFAULT_WORKSPACE);
    await waitForTask(TASK_TITLE_MARQUEE_LONG_ID);
  });

  afterEach(async () => {
    await setReducedMotion(false);
    await browser.execute(() => document.documentElement.classList.remove("dark"));
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("TTL01：短标题不挂载 mask、副本、动画或原生 title", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    const snapshot = await readTitleSnapshot(TASK_TITLE_MARQUEE_SHORT_ID);
    expect(snapshot.overflow).toBe(false);
    expect(snapshot.copyCount).toBe(1);
    expect(snapshot.maskImage).toBe("none");
    expect(snapshot.nativeTitle).toBe(null);
    await hoverTaskRow(TASK_TITLE_MARQUEE_SHORT_ID);
    expect((await readTitleSnapshot(TASK_TITLE_MARQUEE_SHORT_ID)).animationCount).toBe(0);
  });

  it("TTL02: Project long title shows 24px mask only on overflow, hover on non-text row areas starts animation", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    const beforeHover = await readTitleSnapshot(TASK_TITLE_MARQUEE_LONG_ID);
    expect(beforeHover.overflow).toBe(true);
    expect(beforeHover.copyCount).toBe(2);
    expect(beforeHover.duplicateAriaHidden).toBe("true");
    expect(beforeHover.maskImage).toContain("24px");
    expect(beforeHover.nativeTitle).toBe(null);

    const hoveredOutsideTitle = await hoverTaskRow(TASK_TITLE_MARQUEE_LONG_ID);
    expect(hoveredOutsideTitle).toBe(true);
    await waitForAnimationCount(TASK_TITLE_MARQUEE_LONG_ID, 2);
  });

  it("TTL03: Mask switches directly when body tail reaches left edge, pauses 2 seconds after clone head aligns before looping", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    await hoverTaskRow(TASK_TITLE_MARQUEE_LONG_ID);
    await waitForAnimationCount(TASK_TITLE_MARQUEE_LONG_ID, 2);
    const timeline = await readAnimationTimeline(TASK_TITLE_MARQUEE_LONG_ID);
    expect(timeline.animations).toHaveLength(2);
    expect(timeline.trackOffsets).toHaveLength(3);
    expect(timeline.maskOffsets).toHaveLength(5);
    expect(timeline.maskOffsets[2]).toBeCloseTo(timeline.maskOffsets[3] ?? -1, 8);
    expect(timeline.maskFrames[2]).toContain("transparent 0px");
    expect(timeline.maskFrames[3]).toContain("black 0px");
    expect(timeline.pauseMs).toBeCloseTo(2_000, -1);
    expect(timeline.distance).toBeCloseTo(timeline.originalWidth + 24, 0);
    expect(timeline.finalTransform).toBe(timeline.movementTransform);
  });

  it("TTL04: mouseleave resets immediately, next hover scrolls again from start", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    await hoverTaskRow(TASK_TITLE_MARQUEE_LONG_ID);
    await waitForAnimationCount(TASK_TITLE_MARQUEE_LONG_ID, 2);
    await setAnimationCurrentTime(TASK_TITLE_MARQUEE_LONG_ID, 2_000);
    await leaveTaskRow(TASK_TITLE_MARQUEE_LONG_ID);
    const reset = await readTitleSnapshot(TASK_TITLE_MARQUEE_LONG_ID);
    expect(reset.animationCount).toBe(0);
    expect(reset.maskImage).toContain("calc(100% - 24px)");
    await hoverTaskRow(TASK_TITLE_MARQUEE_LONG_ID);
    await waitForAnimationCount(TASK_TITLE_MARQUEE_LONG_ID, 2);
    const restarted = await readAnimationTimeline(TASK_TITLE_MARQUEE_LONG_ID);
    expect(restarted.currentTimes.every((time) => time < 500)).toBe(true);
  });

  it("TTL05：ResizeObserver 驱动 fit → overflow → fit，并同步副本与 mask", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    await setTitleProbeWidth(TASK_TITLE_MARQUEE_LONG_ID, 2_000);
    await waitForOverflow(TASK_TITLE_MARQUEE_LONG_ID, false);
    expect((await readTitleSnapshot(TASK_TITLE_MARQUEE_LONG_ID)).copyCount).toBe(1);
    await setTitleProbeWidth(TASK_TITLE_MARQUEE_LONG_ID, 100);
    await waitForOverflow(TASK_TITLE_MARQUEE_LONG_ID, true);
    expect((await readTitleSnapshot(TASK_TITLE_MARQUEE_LONG_ID)).copyCount).toBe(2);
    await setTitleProbeWidth(TASK_TITLE_MARQUEE_LONG_ID, 2_000);
    await waitForOverflow(TASK_TITLE_MARQUEE_LONG_ID, false);
    await setTitleProbeWidth(TASK_TITLE_MARQUEE_LONG_ID, null);
    await waitForOverflow(TASK_TITLE_MARQUEE_LONG_ID, true);
  });

  it("TTL06: Preserves static overflow indicator under reduced-motion without starting animation", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    await setReducedMotion(true);
    await hoverTaskRow(TASK_TITLE_MARQUEE_LONG_ID);
    const snapshot = await readTitleSnapshot(TASK_TITLE_MARQUEE_LONG_ID);
    expect(snapshot.overflow).toBe(true);
    expect(snapshot.copyCount).toBe(2);
    expect(snapshot.animationCount).toBe(0);
  });

  it("TTL07: Project task row, global pinned area, and dark theme reuse identical overflow semantics", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    await assertOverflowSurface(TASK_TITLE_MARQUEE_LONG_ID);
    await assertOverflowSurface(TASK_TITLE_MARQUEE_PINNED_ID);
    await browser.execute(() => document.documentElement.classList.add("dark"));
    await assertOverflowSurface(TASK_TITLE_MARQUEE_PINNED_ID);

    await ensureProjectExpanded(DEFAULT_WORKSPACE);
    const task = await $(`[data-testid="${testId(TID_TASK_ITEM, TASK_TITLE_MARQUEE_SHORT_ID)}"]`);
    await task.click();
    const icon = await $(
      `[data-testid="${TID_WORKSPACE_HEADER}"] [data-testid="${TID_WORKSPACE_PATH}"]`,
    );
    await icon.waitForDisplayed({ timeout: 15000 });
    expect(await icon.getTagName()).toBe("button");
    expect(
      await browser.execute(
        (pathId, titleId) => {
          const icon = document.querySelector(`[data-testid="${pathId}"]`)!;
          const title = document.querySelector(`[data-testid="${titleId}"]`)!;
          return Boolean(icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING);
        },
        TID_WORKSPACE_PATH,
        TID_WORKSPACE_TITLE,
      ),
    ).toBe(true);
    expect(await $("[data-workspace-header-branch]").isExisting()).toBe(false);
    await icon.moveTo();
    const info = await $("[data-workspace-header-context-info]");
    await info.waitForDisplayed({ timeout: 5000 });
    expect(await info.getText()).toContain("CfProject");
    expect(await info.$("[data-workspace-context-path]").getText()).toContain("CfProject");
    const activity = await info.$("[data-workspace-last-activity]");
    await activity.waitForDisplayed({ timeout: 10000 });
    expect(await activity.getText()).toMatch(/Last active|RecentEvents/);
    expect(await info.$("[data-workspace-chat-counts]").isExisting()).toBe(false);
    await $(`[data-testid="${TID_WORKSPACE_TITLE}"]`).moveTo();
    await icon.click();
    await info.waitForDisplayed({ timeout: 5000 });
  });
});

async function waitForTask(taskId: string) {
  const selectors = taskRowSelectors(taskId);
  await browser.waitUntil(
    () =>
      browser.execute(
        (values) => values.some((selector) => Boolean(document.querySelector(selector))),
        selectors,
      ),
    { timeout: 30_000, timeoutMsg: `Sidebar未Show task: ${taskId}` },
  );
}

function taskRowSelectors(taskId: string): string[] {
  return [`[data-testid="${testId(TID_TASK_ITEM, taskId)}"]`];
}

async function readTitleSnapshot(taskId: string): Promise<TitleSnapshot> {
  return browser.execute(
    (selectors, id) => {
      const row = selectors
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find(Boolean);
      const original = row?.querySelector<HTMLElement>('[data-task-title-copy="original"]');
      const title = original?.parentElement?.parentElement as HTMLElement | null;
      const track = original?.parentElement as HTMLElement | null;
      if (!row || !original || !title || !track) throw new Error(`找不到 task title: ${id}`);
      const style = getComputedStyle(title);
      return {
        animationCount: title.getAnimations({ subtree: true }).length,
        copyCount: track.querySelectorAll("[data-task-title-copy]").length,
        duplicateAriaHidden:
          track.querySelector('[data-task-title-copy="duplicate"]')?.getAttribute("aria-hidden") ??
          null,
        maskImage: style.maskImage || style.webkitMaskImage,
        nativeTitle: title.getAttribute("title"),
        overflow: title.classList.contains("task-title-marquee"),
        rowWidth: row.getBoundingClientRect().width,
        titleWidth: title.getBoundingClientRect().width,
        trackWidth: track.getBoundingClientRect().width,
      };
    },
    taskRowSelectors(taskId),
    taskId,
  );
}

async function hoverTaskRow(taskId: string): Promise<boolean> {
  return browser.execute(
    (selectors, id) => {
      const row = selectors
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find(Boolean);
      const original = row?.querySelector<HTMLElement>('[data-task-title-copy="original"]');
      if (!row || !original) throw new Error(`找不到 hover task: ${id}`);
      const rowRect = row.getBoundingClientRect();
      const titleRect = original.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent("mouseenter", {
          bubbles: false,
          clientX: rowRect.left + 4,
          clientY: rowRect.top + rowRect.height / 2,
        }),
      );
      return rowRect.left + 4 < titleRect.left;
    },
    taskRowSelectors(taskId),
    taskId,
  );
}

async function leaveTaskRow(taskId: string) {
  await browser.execute((selectors) => {
    selectors
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find(Boolean)
      ?.dispatchEvent(new MouseEvent("mouseleave"));
  }, taskRowSelectors(taskId));
}

async function waitForAnimationCount(taskId: string, count: number) {
  await browser.waitUntil(async () => (await readTitleSnapshot(taskId)).animationCount === count, {
    timeout: 5_000,
    timeoutMsg: `task ${taskId} 没有Start ${count} 个走H灯动画`,
  });
}

async function readAnimationTimeline(taskId: string) {
  return browser.execute((selectors) => {
    const row = selectors
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .find(Boolean);
    const original = row?.querySelector<HTMLElement>('[data-task-title-copy="original"]');
    if (!original) throw new Error("Cannot find marquee original title");
    const track = original?.parentElement as HTMLElement;
    const title = track?.parentElement as HTMLElement;
    const animations = title.getAnimations({ subtree: true });
    const trackEffect = animations.find(
      (animation) => (animation.effect as KeyframeEffect).target === track,
    )?.effect as KeyframeEffect;
    const maskEffect = animations.find(
      (animation) => (animation.effect as KeyframeEffect).target === title,
    )?.effect as KeyframeEffect;
    const trackFrames = trackEffect.getKeyframes();
    const maskFrames = maskEffect.getKeyframes();
    const duration = Number(trackEffect.getTiming().duration);
    const movementOffset = Number(trackFrames[1]?.offset);
    const movementTransform = String(trackFrames[1]?.transform);
    return {
      animations: animations.map((animation) => animation.playState),
      currentTimes: animations.map((animation) => Number(animation.currentTime ?? 0)),
      distance: Math.abs(Number(movementTransform.match(/-([\d.]+)px/)?.[1] ?? 0)),
      finalTransform: String(trackFrames[2]?.transform),
      maskFrames: maskFrames.map((frame) => String(frame.maskImage ?? frame.webkitMaskImage)),
      maskOffsets: maskFrames.map((frame) => Number(frame.offset)),
      movementTransform,
      originalWidth: original.scrollWidth,
      pauseMs: duration * (1 - movementOffset),
      trackOffsets: trackFrames.map((frame) => Number(frame.offset)),
    };
  }, taskRowSelectors(taskId));
}

async function setAnimationCurrentTime(taskId: string, currentTime: number) {
  await browser.execute(
    (selectors, time) => {
      const row = selectors
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find(Boolean);
      row?.getAnimations({ subtree: true }).forEach((animation) => {
        animation.currentTime = time;
      });
    },
    taskRowSelectors(taskId),
    currentTime,
  );
}

async function setTitleProbeWidth(taskId: string, width: number | null) {
  await browser.execute(
    (selectors, nextWidth, id) => {
      const row = selectors
        .map((selector) => document.querySelector<HTMLElement>(selector))
        .find(Boolean);
      const original = row?.querySelector<HTMLElement>('[data-task-title-copy="original"]');
      const title = original?.parentElement?.parentElement as HTMLElement | undefined;
      if (!title) throw new Error(`找不到 resize title: ${id}`);
      title.style.flex = nextWidth === null ? "" : "0 0 auto";
      title.style.width = nextWidth === null ? "" : `${nextWidth}px`;
    },
    taskRowSelectors(taskId),
    width,
    taskId,
  );
}

async function waitForOverflow(taskId: string, expected: boolean) {
  await browser.waitUntil(async () => (await readTitleSnapshot(taskId)).overflow === expected, {
    timeout: 5_000,
    timeoutMsg: `task ${taskId} overflow 未切换为 ${expected}`,
  });
}

async function setReducedMotion(reduce: boolean) {
  await sendRendererEmulationCommand("Emulation.setEmulatedMedia", {
    features: [
      {
        name: "prefers-reduced-motion",
        value: reduce ? "reduce" : "no-preference",
      },
    ],
  });
}

async function assertOverflowSurface(taskId: string) {
  const selectors = taskRowSelectors(taskId);
  await browser.waitUntil(
    () =>
      browser.execute(
        (values) => values.some((selector) => Boolean(document.querySelector(selector))),
        selectors,
      ),
    {
      timeout: 15_000,
      timeoutMsg: `Sidebar未Show ${taskId}`,
    },
  );
  const snapshot = await readTitleSnapshot(taskId);
  expect(snapshot.overflow).toBe(true);
  expect(snapshot.copyCount).toBe(2);
  expect(snapshot.maskImage).toContain("24px");
  expect(snapshot.nativeTitle).toBe(null);
}

async function sendRendererEmulationCommand(method: string, params: Record<string, unknown>) {
  const sent = await browser.electron.execute(
    async (electron, command, commandParams) => {
      const window = electron.BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.isVisible(),
      );
      if (!window) return false;
      const devtools = window.webContents.debugger;
      if (!devtools.isAttached()) devtools.attach("1.3");
      await devtools.sendCommand(command, commandParams);
      return true;
    },
    method,
    params,
  );
  if (!sent) throw new Error(`没有找到可Execute ${method} 的 Electron Window`);
}
