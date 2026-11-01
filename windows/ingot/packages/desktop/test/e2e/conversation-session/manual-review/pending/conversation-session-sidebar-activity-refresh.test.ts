import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import {
  clickV4Stop,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../../../helpers/v4-conversation.js";

async function readQueryCounts() {
  const directory = await browser.electron.execute(() => process.env.CF_E2E_RUNTIME_LOG_DIR!);
  const logs = await Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith(".log"))
      .map((name) => readFile(join(directory, name), "utf8")),
  );
  const text = logs.join("\n");
  const count = (method: string) => text.split(`[rpc:call] ${method} OK (`).length - 1;
  return { list: count("window-controller.listTaskList"), tree: count("project.readTree") };
}

describe("TSL40: Continuous full desktop output does not re-read sidebar directory", () => {
  it("Zero re-queries in active window; Stop and real rename remain synchronized", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E();
    await sendV4Prompt("E2E_SLOW_STREAM E2E_SIDEBAR_ACTIVITY_REFRESH");
    await waitForV4TimelineContaining("ACTIVITY_02", 45_000);
    const taskId = (await getV4PaneSnapshot()).sessionId;
    expect(taskId && taskId !== "draft").toBeTruthy();
    const selector = `[data-testid="${testId(TID_TASK_ITEM, taskId!)}"]`;
    await $(selector).waitForDisplayed();
    expect(await $(selector).getText()).toContain("E2E_SIDEBAR_ACTIVITY_REFRESH");
    const before = await readQueryCounts();
    expect(before.list).toBeGreaterThan(0);
    expect(before.tree).toBeGreaterThan(0);
    await waitForV4TimelineContaining("ACTIVITY_29", 30_000);
    const after = await readQueryCounts();
    await writeFile(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "sidebar-query-counts.json"),
      JSON.stringify({ before, after }),
    );
    expect(after).toEqual(before);
    await clickV4Stop();
    await waitForV4Pane((pane) => !pane.canStop, "Stop not completed", 30_000);
    await browser.waitUntil(async () => !(await $(selector).$("svg.animate-spin").isExisting()));
    await $(selector).click({ button: "right" });
    const rename = $(
      '//*[@role="menuitem" and (normalize-space(.)="重命名任务" or normalize-space(.)="重命名任务")]',
    );
    await rename.waitForDisplayed();
    await rename.click();
    const input = $('[role="dialog"] input');
    await input.waitForDisplayed();
    await input.setValue("E2E_ACTIVITY_RENAMED");
    await input.addValue("\uE007");
    await browser.waitUntil(async () =>
      (await $(selector).getText()).includes("E2E_ACTIVITY_RENAMED"),
    );
    await browser.saveScreenshot(
      join(process.env.CF_E2E_ARTIFACT_DIR!, "sidebar-activity-renamed.png"),
    );
  });
});
