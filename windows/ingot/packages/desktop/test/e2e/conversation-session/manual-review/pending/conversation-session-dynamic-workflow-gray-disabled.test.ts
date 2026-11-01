import { readFile } from "node:fs/promises";
import { TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM } from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import { clearAppData, readSettings, waitForTestIdByDom } from "../../../helpers/desktop-app.js";
import { prepareV4ConversationE2E, startNewV4Draft } from "../../../helpers/v4-conversation.js";
import {
  AUTOMATIONS_CONTENT_SELECTOR,
  PLUS_GOAL_OPTION_ID,
  PLUS_WORKFLOW_OPTION_ID,
  SLASH_GOAL_OPTION_ID,
  SLASH_WORKFLOW_OPTION_ID,
  automationsPageTabTestId,
  closePlusMenu,
  closeSlashPanel,
  expectTestIdAbsentThroughout,
  hasTestIdInDom,
  openAutomationsPage,
  openDynamicWorkflowModeSelect,
  openGeneralSettings,
  openPlusMenu,
  openSlashPanelWithCatalogReady,
  readDynamicWorkflowGrayMockStatus,
  readDynamicWorkflowModeTriggerText,
  readPlusMenuAddOptionIds,
  selectDynamicWorkflowMode,
  setComposerDraft,
} from "../../../helpers/dynamic-workflow-gray.js";
import { sel } from "../../../helpers/selectors.js";

describe("Dynamic workflow canary miss (disabled)", () => {
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

  it("DWG-08 When disabled, + menu, / panel, and Automation page have no workflow entry", async function () {
    this.timeout(180000);

    const status = await readDynamicWorkflowGrayMockStatus();
    expect(status.scenario).toBe("disabled");
    expect(status.mode).toBe(null);
    await browser.waitUntil(
      async () => (await readDynamicWorkflowGrayMockStatus()).configRequests > 0,
      { timeout: 60000, timeoutMsg: "Host 没有向 case-local 配置网关请求 /client/configs" },
    );

    const slashIds = await openSlashPanelWithCatalogReady();
    expect(slashIds).toContain(SLASH_GOAL_OPTION_ID);
    expect(slashIds).not.toContain(SLASH_WORKFLOW_OPTION_ID);
    await closeSlashPanel();

    await setComposerDraft("");
    await openPlusMenu();
    const addIds = await readPlusMenuAddOptionIds();
    expect(addIds).toContain(PLUS_GOAL_OPTION_ID);
    expect(addIds).not.toContain(PLUS_WORKFLOW_OPTION_ID);
    await closePlusMenu();

    await openAutomationsPage();
    expect(await $(AUTOMATIONS_CONTENT_SELECTOR).isDisplayed()).toBe(true);
    expect(await hasTestIdInDom(automationsPageTabTestId("workflow"))).toBe(false);
    expect(await hasTestIdInDom(automationsPageTabTestId("automation"))).toBe(false);
    await expectTestIdAbsentThroughout(automationsPageTabTestId("workflow"));
  });

  it("DWG-23 Settings row appears even when default is disabled; workflow entry returns after selecting \"Always on\"", async function () {
    this.timeout(240000);

    await openGeneralSettings();
    await browser.waitUntil(
      async () => (await readDynamicWorkflowModeTriggerText()).includes("关闭"),
      { timeout: 30000, timeoutMsg: "Dynamic workflow mode row did not appear or did not display \"Disabled\" when server default is disabled" },
    );
    await openDynamicWorkflowModeSelect();
    const itemText = (mode: string) =>
      $(sel(testId(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM, mode))).getText();
    expect(await itemText("disabled")).toContain("默认");
    expect(await itemText("onDemand")).not.toContain("默认");
    expect(await itemText("alwaysOn")).not.toContain("默认");
    await browser.keys("Escape");

    await selectDynamicWorkflowMode("alwaysOn");
    await browser.waitUntil(async () => (await readSettings()).dynamicWorkflowMode === "alwaysOn", {
      timeout: 15000,
      timeoutMsg: "Selecting \"Always on\" was not written to settings file",
    });

    await openAutomationsPage();
    await waitForTestIdByDom(automationsPageTabTestId("workflow"), {
      timeout: 30000,
      timeoutMsg: "Automation page did not display \"Workflow\" switch after selecting \"Always on\"",
    });

    await startNewV4Draft();
    await setComposerDraft("");
    await browser.waitUntil(
      async () => {
        await openPlusMenu();
        const ids = await readPlusMenuAddOptionIds();
        await closePlusMenu();
        return ids.includes(PLUS_GOAL_OPTION_ID) && ids.includes(PLUS_WORKFLOW_OPTION_ID);
      },
      { timeout: 30000, timeoutMsg: "+ menu of new draft still lacks workflow after selecting \"Always on\"" },
    );
  });
});
