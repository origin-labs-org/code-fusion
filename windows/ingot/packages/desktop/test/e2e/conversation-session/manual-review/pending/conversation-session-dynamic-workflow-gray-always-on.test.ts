import { readFile } from "node:fs/promises";
import { clearAppData, waitForTestIdByDom } from "../../../helpers/desktop-app.js";
import {
  getV4SlashOptionIds,
  prepareV4ConversationE2E,
  waitForV4SlashOption,
} from "../../../helpers/v4-conversation.js";
import {
  AUTOMATIONS_CONTENT_SELECTOR,
  PLUS_GOAL_OPTION_ID,
  PLUS_WORKFLOW_OPTION_ID,
  SLASH_GOAL_OPTION_ID,
  SLASH_WORKFLOW_OPTION_ID,
  automationsPageTabTestId,
  closePlusMenu,
  closeSlashPanel,
  openAutomationsPage,
  openPlusMenu,
  openSlashPanelWithCatalogReady,
  readDynamicWorkflowGrayMockStatus,
  readPlusMenuAddOptionIds,
  setComposerDraft,
} from "../../../helpers/dynamic-workflow-gray.js";

describe("Dynamic workflow canary hit (alwaysOn)", () => {
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

  it("DWG-08 When hit, + menu, / panel, and Automation page all provide workflow entry", async function () {
    this.timeout(180000);

    const status = await readDynamicWorkflowGrayMockStatus();
    expect(status.scenario).toBe("alwaysOn");
    expect(status.mode).toBe("alwaysOn");
    await browser.waitUntil(
      async () => (await readDynamicWorkflowGrayMockStatus()).configRequests > 0,
      { timeout: 60000, timeoutMsg: "Host 没有向 case-local 配置网关请求 /client/configs" },
    );

    await openSlashPanelWithCatalogReady();
    await waitForV4SlashOption(SLASH_WORKFLOW_OPTION_ID, 60000);
    const slashIds = await getV4SlashOptionIds();
    expect(slashIds.indexOf(SLASH_WORKFLOW_OPTION_ID)).toBe(
      slashIds.indexOf(SLASH_GOAL_OPTION_ID) + 1,
    );
    await closeSlashPanel();

    await setComposerDraft("");
    await openPlusMenu();
    await $(`[data-trigger="+"] [data-option-id="${PLUS_WORKFLOW_OPTION_ID}"]`).waitForDisplayed();
    const addIds = await readPlusMenuAddOptionIds();
    expect(addIds.indexOf(PLUS_WORKFLOW_OPTION_ID)).toBe(addIds.indexOf(PLUS_GOAL_OPTION_ID) + 1);
    await closePlusMenu();

    await openAutomationsPage();
    expect(await $(AUTOMATIONS_CONTENT_SELECTOR).isDisplayed()).toBe(true);
    await waitForTestIdByDom(automationsPageTabTestId("workflow"), {
      timeout: 30000,
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    await waitForTestIdByDom(automationsPageTabTestId("automation"), {
      timeout: 30000,
      timeoutMsg: "Automation page title lacks \"Automation\" switch",
    });
  });
});
