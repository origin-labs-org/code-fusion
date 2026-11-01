import {
  restartIntoWorkspace,
  seedBigModelConnectionSelection,
  seedBigModelOAuthCredential,
} from "./helpers/model-provider-restart.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TID_AUTOMATION_CREATE_MANUALLY,
  TID_AUTOMATIONS_OPEN,
  TID_OFFPEAK_CREATE_BUTTON,
} from "@origin-ai/cf-shared/test-ids";
import {
  clearAppData,
  clickTestIdByDom,
  restoreElectronRendererContentSize,
  setCurrentElectronRendererContentSize,
  type ElectronRendererContentSizeSnapshot,
  waitForTestIdByDom,
} from "./helpers/desktop-app.js";
import { prepareV4ConversationE2E } from "./helpers/v4-conversation.js";

describe("Automations empty home page Figma layout E2E", () => {
  let rendererSizeSnapshot: ElectronRendererContentSizeSnapshot | undefined;

  after(async () => {
    if (rendererSizeSnapshot) {
      await restoreElectronRendererContentSize(rendererSizeSnapshot);
    }
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Render in order of empty state, keep awake, and two sets of two-column templates", async function () {
    this.timeout(150000);

    await prepareV4ConversationE2E({ skipProvider: true });
    await restartIntoWorkspace({
      afterElectronProcessExit: async () => {
        await seedBigModelConnectionSelection({ kind: "individual-coding-plan" });
        await seedBigModelOAuthCredential();
      },
    });
    rendererSizeSnapshot = await setCurrentElectronRendererContentSize(1440);
    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "侧栏没有出现 Automations 入口",
    });
    await waitForTestIdByDom(TID_OFFPEAK_CREATE_BUTTON, {
      timeoutMsg: "Idle task creation button did not appear (mock rollout not hit?)",
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          [
            "[data-automations-content]",
            "[data-automations-empty-state]",
            "[data-automations-keep-awake]",
            "[data-automations-idle-templates]",
            "[data-automations-scheduled-templates]",
          ].every((selector) => document.querySelector(selector)?.getBoundingClientRect().width),
        ),
      {
        timeout: 10000,
        timeoutMsg: "Automations empty home page component was not fully rendered",
      },
    );
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          ["[data-automations-idle-templates]", "[data-automations-scheduled-templates]"].every(
            (selector) => {
              const section = document.querySelector<HTMLElement>(selector);
              return (
                section?.getAttribute("aria-busy") === "false" &&
                !section.querySelector("[data-automation-template-skeleton-card]")
              );
            },
          ),
        ),
      {
        timeout: 30000,
        timeoutMsg: "Automations templates are still in skeleton loading state",
      },
    );

    const layout = await browser.execute(
      (offPeakCreateTestId, manualCreateTestId) => {
        const requireElement = (selector: string): HTMLElement => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) throw new Error(`Missing element: ${selector}`);
          return element;
        };
        const rect = (element: HTMLElement) => {
          const value = element.getBoundingClientRect();
          return {
            top: value.top,
            right: value.right,
            bottom: value.bottom,
            left: value.left,
            width: value.width,
            height: value.height,
          };
        };
        const gridMetrics = (section: HTMLElement) => {
          const grid = section.querySelector<HTMLElement>(".grid");
          if (!grid) throw new Error("Missing template grid");
          return {
            columns: getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length,
            cards: grid.children.length,
            firstCardRadius:
              grid.querySelector("button") instanceof HTMLElement
                ? getComputedStyle(grid.querySelector("button") as HTMLElement).borderRadius
                : "",
          };
        };

        const content = requireElement("[data-automations-content]");
        const empty = requireElement("[data-automations-empty-state]");
        const keepAwake = requireElement("[data-automations-keep-awake]");
        const idle = requireElement("[data-automations-idle-templates]");
        const scheduled = requireElement("[data-automations-scheduled-templates]");
        const manualCreate = requireElement(`[data-testid="${manualCreateTestId}"]`);
        const idleCreate = requireElement(`[data-testid="${offPeakCreateTestId}"]`);
        const contentStyle = getComputedStyle(content);

        return {
          contentWidth:
            content.getBoundingClientRect().width -
            Number.parseFloat(contentStyle.paddingLeft) -
            Number.parseFloat(contentStyle.paddingRight),
          empty: rect(empty),
          keepAwake: rect(keepAwake),
          idle: rect(idle),
          scheduled: rect(scheduled),
          manualCreate: rect(manualCreate),
          idleCreate: rect(idleCreate),
          emptyRadius: getComputedStyle(empty).borderRadius,
          keepAwakeRadius: getComputedStyle(keepAwake).borderRadius,
          idleGrid: gridMetrics(idle),
          scheduledGrid: gridMetrics(scheduled),
        };
      },
      TID_OFFPEAK_CREATE_BUTTON,
      TID_AUTOMATION_CREATE_MANUALLY,
    );

    assertNear(layout.contentWidth, 832, 1, "桌面内容列宽度");
    assertNear(layout.empty.height, 226, 1, "空状态卡高度");
    assertNear(layout.keepAwake.height, 44, 1, "Keep-awake banner height");
    assertNear(layout.keepAwake.top - layout.empty.bottom, 16, 1, "Spacing between empty state and banner");
    if (!(layout.empty.top < layout.keepAwake.top && layout.keepAwake.top < layout.idle.top)) {
      throw new Error("Homepage order is not Empty state → Keep-awake → Idle-time template");
    }
    if (!(layout.idle.top < layout.scheduled.top)) {
      throw new Error("Scheduled task template 没有位于 Idle-time task template 之后");
    }
    if (!(layout.manualCreate.right < layout.idleCreate.left)) {
      throw new Error("空状态按钮顺序不是 Create via chat → Idle-time task");
    }
    if (layout.emptyRadius !== "16px" || layout.keepAwakeRadius !== "10px") {
      throw new Error(
        `圆角不符合Design映射：empty=${layout.emptyRadius}, keepAwake=${layout.keepAwakeRadius}`,
      );
    }
    assertTemplateGrid(layout.idleGrid, "Idle-time task template", 3);
    assertTemplateGrid(layout.scheduledGrid, "Scheduled task template", 4);

    if (process.env.CF_E2E_VISUAL_CAPTURE === "1") {
      await browser.saveScreenshot(join(tmpdir(), "cf-automations-home-4798-2443.png"));
    }
  });
});

function assertNear(actual: number, expected: number, tolerance: number, label: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}应为 ${expected}px，实际为 ${actual}px`);
  }
}

function assertTemplateGrid(
  grid: { columns: number; cards: number; firstCardRadius: string },
  label: string,
  expectedCards: number,
): void {
  if (grid.columns !== 2 || grid.cards !== expectedCards || grid.firstCardRadius !== "12px") {
    throw new Error(
      `${label} 应为双列 ${expectedCards} 卡且卡片圆角 12px，实际 columns=${grid.columns}, cards=${grid.cards}, radius=${grid.firstCardRadius}`,
    );
  }
}
