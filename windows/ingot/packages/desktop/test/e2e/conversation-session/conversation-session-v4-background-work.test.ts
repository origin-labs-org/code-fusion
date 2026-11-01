import { clearAppData } from "../helpers/desktop-app.js";
import {
  approveV4Permission,
  clickV4BackgroundWorkCancel,
  getV4ComposerBackgroundWorkCounts,
  getLatestV4CommandAck,
  getV4BackgroundWorks,
  openV4ComposerRunningBackgroundWorks,
  prepareV4ConversationE2E,
  sendV4Prompt,
  setV4ElectronWindowSize,
  waitForV4PermissionDialog,
} from "../helpers/v4-conversation.js";

describe("v4 M4 门禁：cancelBackgroundWork", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Background bash starts → panel shows running → cancel → cancelled", async function () {
    this.timeout(120000);
    await prepareV4ConversationE2E();
    await setV4ElectronWindowSize(1280, 800);

    await sendV4Prompt("E2E_V4_BGWORK 起一个后台任务");
    try {
      await waitForV4PermissionDialog(15000);
      await approveV4Permission();
    } catch {
    }

    await browser.waitUntil(
      async () => {
        const counts = await getV4ComposerBackgroundWorkCounts();
        return (
          counts?.bashCount === 1 &&
          counts.subagentCount === 0 &&
          counts.totalCount === 1 &&
          counts.typedVisible &&
          !counts.compactVisible
        );
      },
      { timeout: 60000, timeoutMsg: "Composer 没有显示 running Bash typed count" },
    );

    await setV4ElectronWindowSize(480, 800);
    await browser.waitUntil(
      async () => {
        const counts = await getV4ComposerBackgroundWorkCounts();
        return counts?.totalCount === 1 && counts.compactVisible && !counts.typedVisible;
      },
      { timeout: 15000, timeoutMsg: "Narrow Composer did not merge into Activity total count" },
    );
    await openV4ComposerRunningBackgroundWorks(60000);
    const narrowLayout = await browser.execute(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      timelineClass:
        document.querySelector<HTMLElement>('[data-v4-timeline-content-column="true"]')
          ?.className ?? "",
    }));
    expect(narrowLayout.scrollWidth).toBeLessThanOrEqual(narrowLayout.clientWidth + 1);
    expect(narrowLayout.timelineClass).not.toContain("-translate-x-[10.75rem]");

    let workId = "";
    await browser.waitUntil(
      async () => {
        const works = await getV4BackgroundWorks();
        const running = works.find((w) => w.status === "running");
        if (running) {
          workId = running.workId;
          return true;
        }
        return false;
      },
      { timeout: 60000, timeoutMsg: "No running item appeared in background tasks panel" },
    );
    expect(workId).toBeTruthy();

    const clicked = await clickV4BackgroundWorkCancel(workId);
    expect(clicked).toBe(true);
    await browser.waitUntil(
      async () => {
        const works = await getV4BackgroundWorks();
        return !works.some((work) => work.workId === workId);
      },
      { timeout: 60000, timeoutMsg: "取消后 running background item 没有消失" },
    );
    const ack = await getLatestV4CommandAck("cancelBackgroundWork");
    expect(["accepted", "noop"]).toContain(ack?.status);
    await browser.waitUntil(async () => (await getV4ComposerBackgroundWorkCounts()) === null, {
      timeout: 30000,
      timeoutMsg: "Composer entry still exists after the last running task finished",
    });
  });
});
