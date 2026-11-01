import { access } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import { readDynamicWorkflowGrayMockStatus } from "../../../helpers/dynamic-workflow-gray.js";
import {
  denyV4PermissionWithFeedback,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4PermissionDialogInComposerDock,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

//
const MARKER = "E2E_DWF_SAVE_WINDOW_BOUNDS";
const FINAL_MARKER = "E2E_DWF_SAVE_WINDOW_BOUNDS_DONE";
const SAVED_FILE = join(DEFAULT_WORKSPACE, ".cf", "workflows", "release-check-overlong.dwf.ts");
const PANEL = '[data-permission-dialog-bounded="true"]';
const SCROLL_AREA = '[data-permission-dialog-scroll="true"]';
const PANEL_CAP_REM_PX = 672;
const ARGS_PREVIEW_ROWS = 8;
const ARGS_TOTAL = 40;

const SHORT_VIEWPORT_PX = 480;

interface SaveWindowState {
  viewportHeight: number;
  panelTop: number;
  panelBottom: number;
  areaTop: number;
  areaScrollTop: number;
  areaClientHeight: number;
  areaScrollHeight: number;
  
  verticalScrollers: string[];
  
  outsideScrollTops: number[];
  argRows: number;
  clampToggles: number;
  argsHeaderTop: number | null;
  
  confirmHit: boolean;
}

async function readSaveWindowState(): Promise<SaveWindowState | null> {
  return browser.execute(
    (panelSelector: string, areaSelector: string) => {
      const panel = document.querySelector<HTMLElement>(panelSelector);
      const area = document.querySelector<HTMLElement>(areaSelector);
      const confirm = Array.from(document.querySelectorAll("button")).find((button) =>
        ["确认", "Confirm"].includes(button.getAttribute("aria-label") ?? ""),
      );
      if (!panel || !area || !confirm) return null;
      const scrollsVertically = (element: Element) => {
        const overflowY = getComputedStyle(element).overflowY;
        return (
          (overflowY === "auto" || overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight + 1
        );
      };
      const verticalScrollers = [panel, ...Array.from(panel.querySelectorAll("*"))]
        .filter(scrollsVertically)
        .map((element) =>
          element === area
            ? "scroll-area"
            : element === panel
              ? "panel"
              : `${element.tagName}.${String(element.className)}`,
        );
      const outsideScrollTops = Array.from(document.querySelectorAll<HTMLElement>("*"))
        .filter((element) => !panel.contains(element) && scrollsVertically(element))
        .map((element) => element.scrollTop);
      const confirmRect = confirm.getBoundingClientRect();
      const hit = document.elementFromPoint(
        confirmRect.left + confirmRect.width / 2,
        confirmRect.top + confirmRect.height / 2,
      );
      const header = panel.querySelector('[data-workflow-save-args="true"] th');
      const panelRect = panel.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        panelTop: panelRect.top,
        panelBottom: panelRect.bottom,
        areaTop: area.getBoundingClientRect().top,
        areaScrollTop: area.scrollTop,
        areaClientHeight: area.clientHeight,
        areaScrollHeight: area.scrollHeight,
        verticalScrollers,
        outsideScrollTops,
        argRows: panel.querySelectorAll("[data-workflow-save-arg]").length,
        clampToggles: panel.querySelectorAll('[data-workflow-save-clamp-toggle="true"]').length,
        argsHeaderTop: header ? header.getBoundingClientRect().top : null,
        confirmHit: hit === confirm || confirm.contains(hit),
      };
    },
    PANEL,
    SCROLL_AREA,
  );
}

async function wheelOverScrollArea(deltaY: number) {
  await browser
    .action("wheel")
    .scroll({ origin: await $(SCROLL_AREA), deltaY, duration: 0 })
    .perform();
}

describe("Dynamic Workflow · Long Content in Save Confirmation Modal", () => {
  before(async () => {
    await prepareV4ConversationE2E();
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("DWS-01 Long description + 40 arguments + long script: single scroll area, pinned options, collapsible keyboard-accessible long content, mouse wheel scrolls only scroll area, short screens scroll entire window", async function () {
    this.timeout(240000);

    expect((await readDynamicWorkflowGrayMockStatus()).scenario).toBe("alwaysOn");

    await sendV4Prompt(`${MARKER} 把刚才的WorkflowSave下来`);
    await waitForV4PermissionDialogInComposerDock();

    let state: SaveWindowState | null = null;
    await browser.waitUntil(
      async () => {
        state = await readSaveWindowState();
        return state !== null && state.confirmHit;
      },
      { timeout: 30000, timeoutMsg: "Save confirmation modal failed to render height-limited layout, or confirm button pushed out of viewport" },
    );
    const initial = state as unknown as SaveWindowState;
    expect(initial.panelTop).toBeGreaterThanOrEqual(0);
    expect(initial.panelBottom).toBeLessThanOrEqual(initial.viewportHeight);
    expect(initial.panelBottom - initial.panelTop).toBeLessThanOrEqual(
      Math.min(initial.viewportHeight * 0.72, PANEL_CAP_REM_PX) + 1,
    );
    expect(initial.verticalScrollers).toEqual(["scroll-area"]);

    expect(initial.clampToggles).toBe(2);
    expect(initial.argRows).toBe(ARGS_PREVIEW_ROWS);

    const readFocus = () =>
      browser.execute((areaSelector: string) => {
        const active = document.activeElement;
        return {
          inArea: Boolean(active?.closest(areaSelector)),
          isOption: active?.getAttribute("role") === "option",
          text: active?.textContent?.trim() ?? "",
        };
      }, SCROLL_AREA);
    await browser.waitUntil(async () => (await readFocus()).isOption, {
      timeout: 5000,
      timeoutMsg: "保存确认窗打开后焦点不在选项上",
    });
    await browser.keys(["Shift", "Tab"]);
    const onScript = await readFocus();
    expect(onScript.inArea).toBe(true);
    expect(onScript.text).toContain("Show full script");
    await browser.keys(["Shift", "Tab"]);
    const onShowAll = await readFocus();
    expect(onShowAll.inArea).toBe(true);
    expect(onShowAll.text).toContain(`ShowAll ${ARGS_TOTAL} 个参Count`);
    await browser.keys(["Enter"]);

    const scriptToggle = await $("button*=Show full script");
    await scriptToggle.click();
    await browser.waitUntil(
      async () => {
        state = await readSaveWindowState();
        return state !== null && state.argRows === ARGS_TOTAL;
      },
      { timeout: 15000, timeoutMsg: "Arguments not fully expanded after pressing Enter on \"Show all\"" },
    );
    const expanded = state as unknown as SaveWindowState;
    expect(expanded.verticalScrollers).toEqual(["scroll-area"]);
    expect(expanded.panelBottom - expanded.panelTop).toBeLessThanOrEqual(
      Math.min(expanded.viewportHeight * 0.72, PANEL_CAP_REM_PX) + 1,
    );
    expect(expanded.confirmHit).toBe(true);

    await browser.execute((areaSelector: string) => {
      const area = document.querySelector(areaSelector);
      if (area) area.scrollTop = 0;
    }, SCROLL_AREA);
    const before = await readSaveWindowState();
    await wheelOverScrollArea(600);
    await browser.waitUntil(async () => ((await readSaveWindowState())?.areaScrollTop ?? 0) > 0, {
      timeout: 5000,
      timeoutMsg: "Mouse wheel did not scroll the scrollable area of the save confirmation dialog",
    });
    const afterWheel = await readSaveWindowState();
    expect(afterWheel?.outsideScrollTops).toEqual(before?.outsideScrollTops);

    await browser.execute((areaSelector: string) => {
      const area = document.querySelector(areaSelector);
      const row = area?.querySelector('[data-workflow-save-arg="arg20"]');
      if (area && row) {
        area.scrollTop += row.getBoundingClientRect().top - area.getBoundingClientRect().top;
      }
    }, SCROLL_AREA);
    const midTable = await readSaveWindowState();
    expect(midTable?.argsHeaderTop).not.toBeNull();
    expect(Math.abs((midTable?.argsHeaderTop ?? 0) - (midTable?.areaTop ?? 0))).toBeLessThanOrEqual(
      1,
    );

    await browser.execute((areaSelector: string) => {
      const area = document.querySelector(areaSelector);
      if (area) area.scrollTop = area.scrollHeight;
    }, SCROLL_AREA);
    const atEnd = await readSaveWindowState();
    await wheelOverScrollArea(600);
    const pastEnd = await readSaveWindowState();
    expect(pastEnd?.areaScrollTop).toBe(atEnd?.areaScrollTop);
    expect(pastEnd?.outsideScrollTops).toEqual(atEnd?.outsideScrollTops);

    const originalSize = await browser.electron.execute((electron, shortHeight: number) => {
      const win = electron.BrowserWindow.getAllWindows().find((w) => w.isVisible())!;
      const [width, height] = win.getContentSize() as [number, number];
      win.setMinimumSize(320, 400);
      win.setContentSize(width, shortHeight);
      return { width, height };
    }, SHORT_VIEWPORT_PX);
    await browser.waitUntil(
      async () => (await browser.execute(() => window.innerHeight)) === SHORT_VIEWPORT_PX,
      { timeout: 10000, timeoutMsg: "Window did not shrink to short-screen height" },
    );
    const short = await readSaveWindowState();
    expect(short?.verticalScrollers).toEqual(["panel"]);
    expect((short?.panelBottom ?? 0) - (short?.panelTop ?? 0)).toBeLessThanOrEqual(
      SHORT_VIEWPORT_PX * 0.72 + 1,
    );
    await browser.execute((panelSelector: string) => {
      const panel = document.querySelector(panelSelector);
      if (panel) panel.scrollTop = panel.scrollHeight;
    }, PANEL);
    expect((await readSaveWindowState())?.confirmHit).toBe(true);
    await browser.electron.execute((electron, size: { width: number; height: number }) => {
      const win = electron.BrowserWindow.getAllWindows().find((w) => w.isVisible())!;
      win.setContentSize(size.width, size.height);
    }, originalSize);
    await browser.waitUntil(
      async () => (await browser.execute(() => window.innerHeight)) === originalSize.height,
      { timeout: 10000, timeoutMsg: "窗口没有恢复原尺寸" },
    );

    await denyV4PermissionWithFeedback("Don't save for now");
    await waitForV4TimelineContaining(FINAL_MARKER, 60000);
    await expect(access(SAVED_FILE)).rejects.toThrow();
  });
});
