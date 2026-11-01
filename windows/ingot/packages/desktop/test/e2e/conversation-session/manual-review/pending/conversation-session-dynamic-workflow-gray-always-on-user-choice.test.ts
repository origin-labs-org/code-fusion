import { readFile } from "node:fs/promises";
import { TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM } from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, readSettings, waitForTestIdByDom } from "../../../helpers/desktop-app.js";
import { prepareV4ConversationE2E, startNewV4Draft } from "../../../helpers/v4-conversation.js";
import {
  AUTOMATIONS_CONTENT_SELECTOR,
  PLUS_GOAL_OPTION_ID,
  PLUS_WORKFLOW_OPTION_ID,
  automationsPageTabTestId,
  closePlusMenu,
  expectTestIdAbsentThroughout,
  openAutomationsPage,
  openDynamicWorkflowModeSelect,
  openGeneralSettings,
  openPlusMenu,
  readDynamicWorkflowGrayMockStatus,
  readDynamicWorkflowModeTriggerText,
  readPlusMenuAddOptionIds,
  selectDynamicWorkflowMode,
  setComposerDraft,
} from "../../../helpers/dynamic-workflow-gray.js";
import { sel } from "../../../helpers/selectors.js";

describe("Dynamic workflow user selection (server alwaysOn)", () => {
  before(async () => {
    await prepareV4ConversationE2E();
  });
  afterEach(async () => {
    const capturePath = process.env.E2E_PROVIDER_CAPTURE_PATH?.trim();
    if (!capturePath) throw new Error("Missing provider capture evidence");
    expect(JSON.parse(await readFile(capturePath, "utf8")).records).toEqual([]);
  });
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("DWG-23 Settings row displays default value; entry disappears when disabled, selecting default deletes choice", async function () {
    this.timeout(240000);

    const status = await readDynamicWorkflowGrayMockStatus();
    expect(status.scenario).toBe("alwaysOn");
    await browser.waitUntil(
      async () => (await readDynamicWorkflowGrayMockStatus()).configRequests > 0,
      { timeout: 60000, timeoutMsg: "Host 没有向 case-local 配置网关请求 /client/configs" },
    );

    await openGeneralSettings();
    await browser.waitUntil(
      async () => (await readDynamicWorkflowModeTriggerText()).includes("Always on"),
      { timeout: 30000, timeoutMsg: "Dynamic workflow mode row did not display server default \"Always on\"" },
    );
    await openDynamicWorkflowModeSelect();
    const itemText = (mode: string) =>
      $(sel(testId(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM, mode))).getText();
    expect(await itemText("alwaysOn")).toContain("默认");
    expect(await itemText("onDemand")).not.toContain("默认");
    expect(await itemText("disabled")).not.toContain("默认");
    await browser.keys("Escape");

    await selectDynamicWorkflowMode("disabled");
    await browser.waitUntil(async () => (await readSettings()).dynamicWorkflowMode === "disabled", {
      timeout: 15000,
      timeoutMsg: "Selecting \"Disabled\" was not written to settings file",
    });
    expect(await readDynamicWorkflowModeTriggerText()).toContain("关闭");

    await openAutomationsPage();
    expect(await $(AUTOMATIONS_CONTENT_SELECTOR).isDisplayed()).toBe(true);
    await expectTestIdAbsentThroughout(automationsPageTabTestId("workflow"));

    await startNewV4Draft();
    await setComposerDraft("");
    await browser.waitUntil(
      async () => {
        await openPlusMenu();
        const ids = await readPlusMenuAddOptionIds();
        await closePlusMenu();
        return ids.includes(PLUS_GOAL_OPTION_ID) && !ids.includes(PLUS_WORKFLOW_OPTION_ID);
      },
      { timeout: 30000, timeoutMsg: "Workflow still present in + menu of new draft after selecting \"Disabled\"" },
    );

    await openGeneralSettings();
    await selectDynamicWorkflowMode("alwaysOn");
    await browser.waitUntil(async () => !("dynamicWorkflowMode" in (await readSettings())), {
      timeout: 15000,
      timeoutMsg: "dynamicWorkflowMode remains in settings file after switching back to default mode",
    });
    await openAutomationsPage();
    await waitForTestIdByDom(automationsPageTabTestId("workflow"), {
      timeout: 30000,
      timeoutMsg: "Automation page did not restore \"Workflow\" switch after switching back to default mode",
    });
  });
});
