import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  TID_AUTOMATIONS_PAGE_TAB,
  TID_CHAT_WORKFLOW_RUN_DIGEST,
  TID_WORKFLOW_ACTION_DELETE,
  TID_WORKFLOW_ACTION_MOVE,
  TID_WORKFLOW_ARTIFACT_CARD,
  TID_WORKFLOW_ARTIFACT_PANE,
  TID_WORKFLOW_CARD,
  TID_WORKFLOW_CARD_MENU,
  TID_WORKFLOW_CARD_RUN,
  TID_WORKFLOW_DETAIL,
  TID_WORKFLOW_DETAIL_DESCRIPTION,
  TID_WORKFLOW_DETAIL_MENU,
  TID_WORKFLOW_DETAIL_PROJECT,
  TID_WORKFLOW_GLOBAL_GROUP,
  TID_WORKFLOW_LAUNCH_ARG,
  TID_WORKFLOW_LAUNCH_DIALOG,
  TID_WORKFLOW_LAUNCH_ERROR,
  TID_WORKFLOW_LAUNCH_FIELDS,
  TID_WORKFLOW_LAUNCH_SUBMIT,
  TID_WORKFLOW_META_SAVE,
  TID_WORKFLOW_MOVE_DIALOG,
  TID_WORKFLOW_MOVE_DIALOG_SUBMIT,
  TID_WORKFLOW_PROJECT_GROUP,
  TID_WORKFLOWS_CREATE_VIA_CHAT,
  TID_WORKFLOWS_EMPTY,
} from "@origin-ai/cf-shared";
import {
  TID_AUTOMATIONS_OPEN,
  TID_CHAT_SUMMARY_PANEL,
  TID_CONFIRM_DIALOG_CONFIRM,
  TID_TASK_ITEM,
  TID_V4_COMPOSER_BACKGROUND_WORK_TRIGGER,
  TID_V4_TIMELINE,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  clickTestIdByDom,
  clickTestIdByWebDriver,
  setInputValueByTestIdDom,
  waitForTestIdByDom,
} from "./helpers/desktop-app.js";
import {
  getMessages,
  prepareConversationE2E,
  waitForUserMessageContaining,
} from "./helpers/conversation-session.js";
import { getV4ComposerBackgroundWorkCounts } from "./helpers/v4-conversation.js";
import { readDynamicWorkflowGrayMockStatus } from "#e2e/helpers/dynamic-workflow-gray";
import { startDraftFromProject } from "#e2e/helpers/project-sidebar";

const WORKFLOW_NAME = "release-check";
const WORKFLOWS_DIR = join(DEFAULT_WORKSPACE, ".cf", "workflows");
const WORKFLOW_FILE = join(WORKFLOWS_DIR, `${WORKFLOW_NAME}.dwf.ts`);
const EDITED_DESCRIPTION = "发布前检查（E2E 已编辑）";
const SCRIPT = [
  "export default async ({ agent }) => {",
  '  await agent("跑测试并整理发布说明");',
  "};",
  "",
].join("\n");
const SEED = [
  "",
  SCRIPT,
].join("\n");

interface GroupHeaderInfo {
  groupTestId: string | null;
  text: string;
  createTestId: string | null;
}

beforeEach(async () => {
  const launchDialog = $(`[data-testid="${TID_WORKFLOW_LAUNCH_DIALOG}"]`);
  if (await launchDialog.isDisplayed()) {
    await browser.keys("Escape");
    await launchDialog.waitForDisplayed({ reverse: true });
  }
  const automationsOpen = await browser.execute(() =>
    Boolean(document.querySelector("[data-automations-content]")),
  );
  if (automationsOpen) {
    await startDraftFromProject(DEFAULT_WORKSPACE);
  }
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readTestIdText(currentTestId: string): Promise<string | null> {
  return browser.execute((tid) => {
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
      (item) => item.dataset.testid === tid && item.checkVisibility(),
    );
    return element?.textContent?.trim() ?? null;
  }, currentTestId);
}

async function clickRunSidePaneControl(currentTestId: string): Promise<void> {
  const control = $(`[role="tabpanel"][data-state="active"] [data-testid="${currentTestId}"]`);
  await control.waitForClickable();
  await control.click();
}

describe("已保存工作流中枢 E2E", () => {
  before(async () => {
    await mkdir(WORKFLOWS_DIR, { recursive: true });
    await writeFile(WORKFLOW_FILE, SEED, "utf-8");
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(WORKFLOWS_DIR, { recursive: true, force: true });
    await clearAppData();
  });

  it("Preset workflows are visible; changing description only rewrites frontmatter; returns to empty state after deletion", async function () {
    this.timeout(150000);

    await prepareConversationE2E({ skipProvider: true });

    const configStatus = await readDynamicWorkflowGrayMockStatus();
    expect(configStatus.mode).toBe("alwaysOn");
    expect(configStatus.configRequests).toBeGreaterThan(0);

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, {
      timeoutMsg: "Sidebar missing Automation entry",
    });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });

    const readGroupInfo = () =>
      browser.execute(
        (groupPrefix: string, createPrefix: string) => {
          const group = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
            (item) => item.dataset.testid?.startsWith(groupPrefix),
          );
          if (!group) return null;
          const createButton = group.querySelector<HTMLElement>(`[data-testid^="${createPrefix}"]`);
          return {
            groupTestId: group.dataset.testid ?? null,
            text: group.textContent ?? "",
            createTestId: createButton?.dataset.testid ?? null,
          };
        },
        TID_WORKFLOW_PROJECT_GROUP,
        testId(TID_WORKFLOWS_CREATE_VIA_CHAT, ""),
      ) as Promise<GroupHeaderInfo | null>;

    let groupInfo: GroupHeaderInfo | null = null;
    await browser.waitUntil(
      async () => {
        groupInfo = await readGroupInfo();
        return Boolean(groupInfo && groupInfo.createTestId);
      },
      { timeout: 20000, timeoutMsg: "Workflow page missing project group for default workspace" },
    );
    const seen = groupInfo as GroupHeaderInfo | null;
    expect(seen?.groupTestId?.startsWith(TID_WORKFLOW_PROJECT_GROUP)).toBe(true);
    expect(seen?.text).toContain("CfProject");
    expect(seen?.createTestId?.startsWith(testId(TID_WORKFLOWS_CREATE_VIA_CHAT, ""))).toBe(true);
    expect(seen?.createTestId).toContain("CfProject");

    const cardTestId = testId(TID_WORKFLOW_CARD, WORKFLOW_NAME);
    await waitForTestIdByDom(cardTestId, {
      timeout: 20000,
      timeoutMsg: "Workflow list missing preset release-check card",
    });
    expect(await readTestIdText(cardTestId)).toContain("发布前检查");

    await clickTestIdByDom(cardTestId, { timeoutMsg: "无法点击工作流卡片进入详情" });
    await waitForTestIdByDom(TID_WORKFLOW_DETAIL, { timeoutMsg: "Did not enter workflow details page" });

    await waitForTestIdByDom(TID_WORKFLOW_DETAIL_PROJECT, {
      timeoutMsg: "Details page title missing project attribution badge",
    });
    expect(await readTestIdText(TID_WORKFLOW_DETAIL_PROJECT)).toBe("CfProject");
    const crumbs = (await browser.execute(() => {
      const nav = document.querySelector('[data-testid="automations-main-drag-region"] nav');
      return nav
        ? Array.from(nav.querySelectorAll("li")).map((item) => ({
            text: item.textContent?.trim() ?? "",
            clickable: item.querySelector("button") !== null,
          }))
        : null;
    })) as { text: string; clickable: boolean }[] | null;
    expect(crumbs).toHaveLength(2);
    expect(crumbs?.[1]?.text).toBe(WORKFLOW_NAME);
    expect(crumbs?.map((crumb) => crumb.clickable)).toEqual([true, false]);

    await clickTestIdByDom("settings-breadcrumb-section", {
      timeoutMsg: "Details page missing clickable top-level breadcrumb",
    });
    await waitForTestIdByDom(cardTestId, { timeoutMsg: "Did not return to workflow list after clicking top-level breadcrumb" });
    await clickTestIdByDom(cardTestId, { timeoutMsg: "无法再次点击工作流卡片进入详情" });
    await waitForTestIdByDom(TID_WORKFLOW_DETAIL, { timeoutMsg: "Did not enter workflow details page again" });

    await setInputValueByTestIdDom(TID_WORKFLOW_DETAIL_DESCRIPTION, EDITED_DESCRIPTION, {
      timeoutMsg: "Details page missing description input",
    });
    await clickTestIdByDom(TID_WORKFLOW_META_SAVE, {
      timeoutMsg: "\"Save metadata\" did not appear after changing description",
    });

    await browser.waitUntil(
      async () => (await readFile(WORKFLOW_FILE, "utf-8")).includes(EDITED_DESCRIPTION),
      { timeout: 15000, timeoutMsg: "Description in file on disk was not updated after saving" },
    );
    const saved = await readFile(WORKFLOW_FILE, "utf-8");
    expect(saved.startsWith("/* cf-workflow\n")).toBe(true);
    expect(saved.endsWith(`*/\n${SCRIPT}`)).toBe(true);
    expect(saved).toContain("whenToUse: When preparing to release");
    expect(saved).toContain("required: true");

    await clickTestIdByWebDriver(TID_WORKFLOW_DETAIL_MENU, {
      timeoutMsg: "Details page missing \"More actions\" menu",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_ACTION_DELETE, WORKFLOW_NAME), {
      timeoutMsg: "Details page menu missing \"Delete workflow\" item",
    });
    await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM, {
      timeoutMsg: "Delete confirmation popup did not appear",
    });
    await waitForTestIdByDom(TID_WORKFLOWS_EMPTY, {
      timeout: 15000,
      timeoutMsg: "Did not return to empty workflow state after deletion",
    });
    await browser.waitUntil(async () => !(await fileExists(WORKFLOW_FILE)), {
      timeout: 10000,
      timeoutMsg: "File on disk still exists after deletion",
    });
  });
});

const E2E_HOME = dirname(DEFAULT_WORKSPACE);
const GLOBAL_WORKFLOW_NAME = "global-note";
const GLOBAL_WORKFLOWS_DIR = join(E2E_HOME, ".cf", "workflows");
const GLOBAL_WORKFLOW_FILE = join(GLOBAL_WORKFLOWS_DIR, `${GLOBAL_WORKFLOW_NAME}.dwf.ts`);
const GLOBAL_PROJECT_WORKFLOWS_DIR = join(DEFAULT_WORKSPACE, ".cf", "workflows");
const GLOBAL_PROJECT_WORKFLOW_FILE = join(
  GLOBAL_PROJECT_WORKFLOWS_DIR,
  `${GLOBAL_WORKFLOW_NAME}.dwf.ts`,
);
const GLOBAL_SCRIPT = [
  "export default async ({ agent }) => {",
  '  await agent("做一次深度调研");',
  "};",
  "",
].join("\n");
const GLOBAL_SEED = [
  "",
  GLOBAL_SCRIPT,
].join("\n");

describe("Global workflow hub E2E", () => {
  before(async () => {
    await mkdir(GLOBAL_WORKFLOWS_DIR, { recursive: true });
    await writeFile(GLOBAL_WORKFLOW_FILE, GLOBAL_SEED, "utf-8");
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(GLOBAL_WORKFLOW_FILE, { force: true });
    await rm(GLOBAL_PROJECT_WORKFLOW_FILE, { force: true });
    await clearAppData();
  });

  it("Global group pinned to top; Global -> Project moves files; Project -> Global opens new session with summary prompt without moving files", async function () {
    this.timeout(150000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });

    await waitForTestIdByDom(TID_WORKFLOW_GLOBAL_GROUP, {
      timeout: 20000,
      timeoutMsg: "Workflow page missing \"Global\" group",
    });
    const globalCardTestId = testId(TID_WORKFLOW_CARD, GLOBAL_WORKFLOW_NAME);
    await waitForTestIdByDom(globalCardTestId, {
      timeout: 20000,
      timeoutMsg: "\"Global\" group missing preset global-note card",
    });

    await clickTestIdByWebDriver(testId(TID_WORKFLOW_CARD_MENU, GLOBAL_WORKFLOW_NAME), {
      timeoutMsg: "Global card missing \"More actions\" menu",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_ACTION_MOVE, GLOBAL_WORKFLOW_NAME), {
      timeoutMsg: "Global card menu missing \"Move to project...\" item",
    });
    await waitForTestIdByDom(TID_WORKFLOW_MOVE_DIALOG, { timeoutMsg: "\"Move to project\" modal did not appear" });
    await clickTestIdByDom(TID_WORKFLOW_MOVE_DIALOG_SUBMIT, {
      timeoutMsg: "\"Move to project\" modal missing submit button",
    });

    await browser.waitUntil(async () => fileExists(GLOBAL_PROJECT_WORKFLOW_FILE), {
      timeout: 15000,
      timeoutMsg: "移到项目后文件没有出现在项目目录",
    });
    await browser.waitUntil(async () => !(await fileExists(GLOBAL_WORKFLOW_FILE)), {
      timeout: 10000,
      timeoutMsg: "移到项目后 HOME 里的文件仍然存在",
    });

    const projectGroupTestId = await browser.waitUntil(
      async () => {
        const tid = await browser.execute((prefix: string) => {
          const group = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
            (item) => item.dataset.testid?.startsWith(prefix),
          );
          return group?.dataset.testid ?? null;
        }, TID_WORKFLOW_PROJECT_GROUP);
        return tid ?? false;
      },
      { timeout: 15000, timeoutMsg: "移到项目后没有出现项目组" },
    );
    const order = await browser.execute(
      (globalTid: string, projectTid: string) => {
        const globalEl = document.querySelector<HTMLElement>(`[data-testid="${globalTid}"]`);
        const projectEl = document.querySelector<HTMLElement>(`[data-testid="${projectTid}"]`);
        if (!globalEl || !projectEl) return null;
        return (globalEl.compareDocumentPosition(projectEl) & 4) !== 0
          ? "global-first"
          : "project-first";
      },
      TID_WORKFLOW_GLOBAL_GROUP,
      projectGroupTestId as string,
    );
    expect(order).toBe("global-first");
    await waitForTestIdByDom(globalCardTestId, { timeoutMsg: "移到项目后卡片消失了" });

    await clickTestIdByWebDriver(testId(TID_WORKFLOW_CARD_MENU, GLOBAL_WORKFLOW_NAME), {
      timeoutMsg: "Project card missing \"More actions\" menu",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_ACTION_MOVE, GLOBAL_WORKFLOW_NAME), {
      timeoutMsg: "Project card menu missing \"Promote to global\" item",
    });
    await waitForUserMessageContaining(GLOBAL_WORKFLOW_NAME);
    const promoteMessage = (await getMessages("user")).find((message) =>
      message.text.includes(GLOBAL_WORKFLOW_NAME),
    );
    expect(promoteMessage?.text ?? "").toContain(GLOBAL_PROJECT_WORKFLOW_FILE);
    expect(promoteMessage?.text ?? "").toContain('scope: "global"');
    expect(await fileExists(GLOBAL_PROJECT_WORKFLOW_FILE)).toBe(true);
    expect(await fileExists(GLOBAL_WORKFLOW_FILE)).toBe(false);
  });
});

const LAUNCH_OK_NAME = "direct-launch-ok";
const LAUNCH_OK_ARG = "topic";
const LAUNCH_OK_ARG_VALUE = "adaptive concurrency in agent runtimes";
const LAUNCH_OK_FILE = join(WORKFLOWS_DIR, `${LAUNCH_OK_NAME}.dwf.ts`);
const LAUNCH_OK_SEED = [
  "",
  "return { ok: true };",
  "",
].join("\n");

const LAUNCH_SLEEP_NAME = "direct-launch-sleeping";
const LAUNCH_SLEEP_FILE = join(WORKFLOWS_DIR, `${LAUNCH_SLEEP_NAME}.dwf.ts`);
const LAUNCH_SLEEP_SEED = [
  "",
  'await world.run("sleep", ["40"]);',
  "return { ok: true };",
  "",
].join("\n");

const LAUNCH_SAVE_NAME = "direct-launch-save";
const LAUNCH_SAVE_FILE = join(WORKFLOWS_DIR, `${LAUNCH_SAVE_NAME}.dwf.ts`);
const LAUNCH_SAVE_SCRIPT = "return { ok: true, savedFromRun: 1 };\n";
const LAUNCH_SAVE_SEED = [
  "",
  LAUNCH_SAVE_SCRIPT,
].join("\n");

const LAUNCH_ARTIFACT_NAME = "direct-launch-artifact";
const LAUNCH_ARTIFACT_FILE = join(WORKFLOWS_DIR, `${LAUNCH_ARTIFACT_NAME}.dwf.ts`);
const LAUNCH_ARTIFACT_ID = "e2e-report";
const LAUNCH_ARTIFACT_MARKDOWN = "# E2E Report\n\n作为File打开。\n";
const LAUNCH_ARTIFACT_SEED = [
  "",
  `await artifact.markdown(${JSON.stringify(LAUNCH_ARTIFACT_ID)}, ${JSON.stringify(
    LAUNCH_ARTIFACT_MARKDOWN,
  )}, { title: "E2E 报告" });`,
  "return { ok: true };",
  "",
].join("\n");

const LAUNCH_FAIL_NAME = "direct-launch-broken";
const LAUNCH_FAIL_FILE = join(WORKFLOWS_DIR, `${LAUNCH_FAIL_NAME}.dwf.ts`);
const LAUNCH_FAIL_SEED = [
  "",
  'const answer: number = "not a number";',
  "return answer;",
  "",
].join("\n");

const LAUNCH_MODEL_NAME = "direct-launch-unknown-model";
const LAUNCH_MODEL_FILE = join(WORKFLOWS_DIR, `${LAUNCH_MODEL_NAME}.dwf.ts`);
const LAUNCH_MODEL_UNKNOWN = "no-such-model-e2e";
const LAUNCH_MODEL_SEED = [
  "",
  `agent("judge", { model: "${LAUNCH_MODEL_UNKNOWN}" });`,
  "return 1;",
  "",
].join("\n");

const LAUNCH_MANY_NAME = "direct-launch-many-args";
const LAUNCH_MANY_FILE = join(WORKFLOWS_DIR, `${LAUNCH_MANY_NAME}.dwf.ts`);
const LAUNCH_MANY_COUNT = 40;
const LAUNCH_MANY_REQUIRED = "arg20";
const LAUNCH_MANY_SEED = [
  "",
  "return { ok: true };",
  "",
].join("\n");

interface LaunchDialogGeometry {
  viewportHeight: number;
  dialogTop: number;
  dialogBottom: number;
  
  submitHit: boolean;
  
  dialogScrolls: boolean;
  fieldsClientHeight: number;
  fieldsScrollHeight: number;
  
  argVisible: boolean;
  argFocused: boolean;
}

async function readLaunchDialogGeometry(argName: string): Promise<LaunchDialogGeometry | null> {
  return browser.execute(
    (dialogTid, fieldsTid, submitTid, argTid) => {
      const byTestId = (tid: string) =>
        Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
          (item) => item.dataset.testid === tid,
        );
      const dialog = byTestId(dialogTid);
      const fields = byTestId(fieldsTid);
      const submit = byTestId(submitTid);
      const arg = byTestId(argTid);
      if (!dialog || !fields || !submit || !arg) return null;
      const dialogRect = dialog.getBoundingClientRect();
      const submitRect = submit.getBoundingClientRect();
      const fieldsRect = fields.getBoundingClientRect();
      const argRect = arg.getBoundingClientRect();
      const top = document.elementFromPoint(
        submitRect.left + submitRect.width / 2,
        submitRect.top + submitRect.height / 2,
      );
      return {
        viewportHeight: window.innerHeight,
        dialogTop: dialogRect.top,
        dialogBottom: dialogRect.bottom,
        submitHit: top !== null && submit.contains(top),
        dialogScrolls: dialog.scrollHeight > dialog.clientHeight,
        fieldsClientHeight: fields.clientHeight,
        fieldsScrollHeight: fields.scrollHeight,
        argVisible: argRect.top >= fieldsRect.top && argRect.bottom <= fieldsRect.bottom,
        argFocused: document.activeElement === arg,
      };
    },
    TID_WORKFLOW_LAUNCH_DIALOG,
    TID_WORKFLOW_LAUNCH_FIELDS,
    TID_WORKFLOW_LAUNCH_SUBMIT,
    testId(TID_WORKFLOW_LAUNCH_ARG, argName),
  );
}

async function readTestIdPrefixText(prefix: string): Promise<string | null> {
  return browser.execute((currentPrefix) => {
    const element = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
      (item) => item.dataset.testid?.startsWith(currentPrefix),
    );
    return element?.textContent?.replace(/ /g, " ").trim() ?? null;
  }, prefix);
}

async function readLaunchCardStatus(): Promise<string | null> {
  return browser.execute(
    (prefix) => {
      const card = Array.from(document.querySelectorAll<HTMLElement>("[data-testid]")).find(
        (item) => item.dataset.testid?.startsWith(prefix),
      );
      return card?.getAttribute("data-workflow-run-status") ?? null;
    },
    testId(TID_CHAT_WORKFLOW_RUN_DIGEST, ""),
  );
}

async function readLaunchProvenanceText(): Promise<string | null> {
  return browser.execute(() => {
    const element = document.querySelector<HTMLElement>('[data-testid="workflow-run-provenance"]');
    return element?.textContent?.replace(/ /g, " ").trim() ?? null;
  });
}

async function countTaskItems(): Promise<number> {
  return browser.execute(
    (prefix) => document.querySelectorAll(`[data-testid^="${prefix}"]`).length,
    testId(TID_TASK_ITEM, ""),
  );
}

async function readTaskItemsText(): Promise<string> {
  return browser.execute(
    (prefix) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`))
        .map((item) => item.textContent?.replace(/ /g, " ") ?? "")
        .join("\n"),
    testId(TID_TASK_ITEM, ""),
  );
}

async function readTimelineText(): Promise<string> {
  return browser.execute((timelineTestId) => {
    const element = document.querySelector<HTMLElement>(`[data-testid="${timelineTestId}"]`);
    return element?.textContent?.replace(/ /g, " ") ?? "";
  }, TID_V4_TIMELINE);
}

describe("Launch E2E directly", () => {
  before(async () => {
    await mkdir(WORKFLOWS_DIR, { recursive: true });
    await writeFile(LAUNCH_OK_FILE, LAUNCH_OK_SEED, "utf-8");
    await writeFile(LAUNCH_FAIL_FILE, LAUNCH_FAIL_SEED, "utf-8");
    await writeFile(LAUNCH_MANY_FILE, LAUNCH_MANY_SEED, "utf-8");
    await writeFile(LAUNCH_MODEL_FILE, LAUNCH_MODEL_SEED, "utf-8");
    await writeFile(LAUNCH_SLEEP_FILE, LAUNCH_SLEEP_SEED, "utf-8");
    await writeFile(LAUNCH_SAVE_FILE, LAUNCH_SAVE_SEED, "utf-8");
    await writeFile(LAUNCH_ARTIFACT_FILE, LAUNCH_ARTIFACT_SEED, "utf-8");
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await rm(WORKFLOWS_DIR, { recursive: true, force: true });
    await clearAppData();
  });

  it("Hub \"Run\" Constant Workflow: Start card at top of new session reaches completed, no user bubbles, no confirmation dialog", async function () {
    this.timeout(180000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    const okCardTestId = testId(TID_WORKFLOW_CARD, LAUNCH_OK_NAME);
    await waitForTestIdByDom(okCardTestId, {
      timeout: 20000,
      timeoutMsg: "Constant workflow card did not appear in workflow list",
    });

    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_OK_NAME), {
      timeoutMsg: "Constant workflow card has no \"Run\" button",
    });
    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_DIALOG, {
      timeout: 15000,
      timeoutMsg: "Argument dialog did not pop up after clicking \"Run\"",
    });
    const dialogText = (await readTestIdPrefixText(TID_WORKFLOW_LAUNCH_DIALOG)) ?? "";
    expect(dialogText).toContain(LAUNCH_OK_NAME);
    expect(dialogText).toContain("项目");
    expect(dialogText).toContain("Run in new session of");

    const tasksBeforeLaunch = await countTaskItems();
    await setInputValueByTestIdDom(
      testId(TID_WORKFLOW_LAUNCH_ARG, LAUNCH_OK_ARG),
      LAUNCH_OK_ARG_VALUE,
      {
        timeoutMsg: "topic input field did not appear in argument dialog",
      },
    );
    await clickTestIdByDom(TID_WORKFLOW_LAUNCH_SUBMIT, {
      timeoutMsg: "Argument dialog has no \"Run\" submit button",
    });

    const launchCardPrefix = testId(TID_CHAT_WORKFLOW_RUN_DIGEST, "");
    await browser.waitUntil(
      async () =>
        (await readLaunchCardStatus()) !== null ||
        Boolean(await readTestIdPrefixText(launchCardPrefix)),
      {
        timeout: 60000,
        timeoutMsg: "run card did not appear at top of new session",
      },
    );
    const cardText = (await readTestIdPrefixText(launchCardPrefix)) ?? "";
    expect(cardText).toContain(LAUNCH_OK_NAME);
    expect(cardText).not.toContain(LAUNCH_OK_ARG_VALUE);

    await clickTestIdByDom("workflow-card-open-details", {
      timeoutMsg: "run card has no \"Open Run Details\"",
    });
    await browser.waitUntil(async () => (await readLaunchProvenanceText()) !== null, {
      timeout: 30000,
      timeoutMsg: "Context section did not appear in run details side panel",
    });
    const provenanceText = (await readLaunchProvenanceText()) ?? "";
    expect(provenanceText).toContain(LAUNCH_OK_ARG_VALUE);

    expect(await readTimelineText()).not.toContain("Run the saved workflow");

    const hasConfirmDialog = await browser.execute(
      (confirmTestId) => Boolean(document.querySelector(`[data-testid="${confirmTestId}"]`)),
      TID_CONFIRM_DIALOG_CONFIRM,
    );
    expect(hasConfirmDialog).toBe(false);

    await browser.waitUntil(async () => (await readLaunchCardStatus()) === "completed", {
      timeout: 90000,
      timeoutMsg: "run card status did not reach completed",
    });

    await browser.waitUntil(async () => (await countTaskItems()) === tasksBeforeLaunch + 1, {
      timeout: 20000,
      timeoutMsg: "直接启动后没有新增一个会话",
    });
    expect(await readTaskItemsText()).toContain(LAUNCH_OK_NAME);
  });

  it("Compilation-Failed Workflow: Argument dialog inline error shows compile_failed, no new session in list", async function () {
    this.timeout(150000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    const failCardTestId = testId(TID_WORKFLOW_CARD, LAUNCH_FAIL_NAME);
    await waitForTestIdByDom(failCardTestId, {
      timeout: 20000,
      timeoutMsg: "Compilation-failed workflow card did not appear in workflow list",
    });

    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_FAIL_NAME), {
      timeoutMsg: "Compilation-failed workflow card has no \"Run\" button",
    });
    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_DIALOG, {
      timeout: 15000,
      timeoutMsg: "Argument dialog did not pop up after clicking \"Run\"",
    });
    const tasksBeforeReject = await countTaskItems();
    await setInputValueByTestIdDom(testId(TID_WORKFLOW_LAUNCH_ARG, LAUNCH_OK_ARG), "x", {
      timeoutMsg: "topic input field did not appear in argument dialog",
    });
    await clickTestIdByDom(TID_WORKFLOW_LAUNCH_SUBMIT, {
      timeoutMsg: "Argument dialog has no \"Run\" submit button",
    });

    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_ERROR, {
      timeout: 30000,
      timeoutMsg: "Compilation failure not displayed in argument dialog inline error area",
    });
    const errorText = (await readTestIdPrefixText(TID_WORKFLOW_LAUNCH_ERROR)) ?? "";
    expect(errorText).toContain("工作流脚本编译失败");
    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_DIALOG, {
      timeoutMsg: "编译失败后实参窗被意外关闭",
    });

    await browser.waitUntil(async () => (await countTaskItems()) === tasksBeforeReject, {
      timeout: 15000,
      timeoutMsg: "A new session was added despite compilation failure",
    });
  });

  it("Many-Argument Workflow: Argument dialog does not overflow viewport, argument area scrolls internally, validation failure scrolls error field into view", async function () {
    this.timeout(150000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    await waitForTestIdByDom(testId(TID_WORKFLOW_CARD, LAUNCH_MANY_NAME), {
      timeout: 20000,
      timeoutMsg: "Many-argument workflow card did not appear in workflow list",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_MANY_NAME), {
      timeoutMsg: "Many-argument workflow card has no \"Run\" button",
    });
    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_DIALOG, {
      timeout: 15000,
      timeoutMsg: "Argument dialog did not pop up after clicking \"Run\"",
    });
    const tasksBefore = await countTaskItems();

    await browser.waitUntil(
      async () => {
        const geometry = await readLaunchDialogGeometry(LAUNCH_MANY_REQUIRED);
        return (
          geometry !== null &&
          geometry.dialogTop >= 0 &&
          geometry.dialogBottom <= geometry.viewportHeight &&
          geometry.submitHit
        );
      },
      { timeout: 15000, timeoutMsg: "Argument dialog overflowed viewport or submit button was unreachable when arguments were numerous" },
    );
    const opened = await readLaunchDialogGeometry(LAUNCH_MANY_REQUIRED);
    expect(opened?.fieldsScrollHeight ?? 0).toBeGreaterThan(opened?.fieldsClientHeight ?? 0);
    expect(opened?.argVisible).toBe(false);
    expect(opened?.dialogScrolls).toBe(false);

    await clickTestIdByDom(TID_WORKFLOW_LAUNCH_SUBMIT, {
      timeoutMsg: "Argument dialog has no \"Run\" submit button",
    });
    await browser.waitUntil(
      async () => {
        const geometry = await readLaunchDialogGeometry(LAUNCH_MANY_REQUIRED);
        return geometry !== null && geometry.argVisible && geometry.argFocused;
      },
      { timeout: 15000, timeoutMsg: "Failed required field was not scrolled into view or focused after validation failure" },
    );
    const revealed = await readLaunchDialogGeometry(LAUNCH_MANY_REQUIRED);
    expect(revealed?.submitHit).toBe(true);
    expect(revealed?.dialogScrolls).toBe(false);
    expect(revealed?.dialogTop ?? -1).toBeGreaterThanOrEqual(0);

    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_DIALOG, {
      timeoutMsg: "校验失败后实参窗被意外关闭",
    });
    expect(await countTaskItems()).toBe(tasksBefore);
  });

  it("Script Named Model Unresolvable: Argument dialog displays compile_failed and 9011 for that name inline, no new session in list", async function () {
    this.timeout(150000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    await waitForTestIdByDom(testId(TID_WORKFLOW_CARD, LAUNCH_MODEL_NAME), {
      timeout: 20000,
      timeoutMsg: "Workflow card naming unknown model did not appear in workflow list",
    });

    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_MODEL_NAME), {
      timeoutMsg: "Workflow card naming unknown model has no \"Run\" button",
    });
    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_DIALOG, {
      timeout: 15000,
      timeoutMsg: "Argument dialog did not pop up after clicking \"Run\"",
    });
    const tasksBefore = await countTaskItems();
    await setInputValueByTestIdDom(testId(TID_WORKFLOW_LAUNCH_ARG, LAUNCH_OK_ARG), "x", {
      timeoutMsg: "topic input field did not appear in argument dialog",
    });
    await clickTestIdByDom(TID_WORKFLOW_LAUNCH_SUBMIT, {
      timeoutMsg: "Argument dialog has no \"Run\" submit button",
    });

    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_ERROR, {
      timeout: 30000,
      timeoutMsg: "Unresolvable model not displayed in argument dialog inline error area",
    });
    const errorText = (await readTestIdPrefixText(TID_WORKFLOW_LAUNCH_ERROR)) ?? "";
    expect(errorText).toContain("工作流脚本编译失败");
    expect(errorText).toMatch(/L\d+:C\d+/);
    expect(
      errorText.includes(LAUNCH_MODEL_UNKNOWN) || errorText.includes("cannot choose models"),
    ).toBe(true);
    await waitForTestIdByDom(TID_WORKFLOW_LAUNCH_DIALOG, {
      timeoutMsg: "解不出来的模型让实参窗被意外关闭",
    });
    await browser.waitUntil(async () => (await countTaskItems()) === tasksBefore, {
      timeout: 15000,
      timeoutMsg: "A new session was added despite unresolvable model",
    });
  });

  it("Sole Running Workflow: composer badge links directly to details side tab, status pill does not expand", async function () {
    this.timeout(180000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    await waitForTestIdByDom(testId(TID_WORKFLOW_CARD, LAUNCH_SLEEP_NAME), {
      timeout: 20000,
      timeoutMsg: "Constant workflow card staying in running did not appear in workflow list",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_SLEEP_NAME), {
      timeoutMsg: "Constant workflow card has no \"Run\" button",
    });

    const launchCardPrefix = testId(TID_CHAT_WORKFLOW_RUN_DIGEST, "");
    await browser.waitUntil(async () => Boolean(await readTestIdPrefixText(launchCardPrefix)), {
      timeout: 60000,
      timeoutMsg: "run card did not appear at top of new session",
    });

    await browser.waitUntil(
      async () =>
        browser.execute(
          (prefix) => {
            const rows = Array.from(
              document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`),
            );
            return rows.some((row) => {
              const line = row.querySelector<HTMLElement>(
                '[data-workflow-run-line][data-run-status="running"]',
              );
              return (
                line !== null &&
                line.querySelector('[data-workflow-run-rail][data-implicit="true"]') !== null
              );
            });
          },
          testId(TID_TASK_ITEM, ""),
        ),
      { timeout: 60000, timeoutMsg: "No running subrow sprouted under the triggering session row in sidebar" },
    );

    await browser.waitUntil(
      async () =>
        browser.execute((panelTestId) => {
          const panel = document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
          const pill = panel?.querySelector<HTMLElement>("[data-workflow-pill]");
          const button = pill?.closest("button");
          return (
            pill !== null &&
            pill !== undefined &&
            (pill.textContent ?? "").trim().length > 0 &&
            button?.querySelector('[data-workflow-run-lamp="running"]') !== null
          );
        }, TID_CHAT_SUMMARY_PANEL),
      { timeout: 30000, timeoutMsg: "Status pill did not display running workflow by name" },
    );

    await browser.waitUntil(
      async () => {
        const counts = await getV4ComposerBackgroundWorkCounts();
        return (
          counts?.workflowCount === 1 &&
          counts.bashCount === 0 &&
          counts.subagentCount === 0 &&
          counts.totalCount === 1 &&
          counts.openTarget === "workflow-run"
        );
      },
      { timeout: 60000, timeoutMsg: "composer badge did not display the sole running workflow targeting workflow-run" },
    );
    const panelModeBefore = await browser.execute(
      (panelTestId) =>
        document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`)?.dataset
          .displayMode ?? null,
      TID_CHAT_SUMMARY_PANEL,
    );
    expect(panelModeBefore).not.toBe("panel");

    await clickTestIdByDom(TID_V4_COMPOSER_BACKGROUND_WORK_TRIGGER, {
      timeoutMsg: "composer background task entry is not clickable",
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          Boolean(document.querySelector('[data-side-pane-tab-id^="workflow-run:"]')),
        ),
      { timeout: 30000, timeoutMsg: "workflow-run tab did not open in side panel after clicking badge" },
    );
    const panelModeAfter = await browser.execute(
      (panelTestId) =>
        document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`)?.dataset
          .displayMode ?? null,
      TID_CHAT_SUMMARY_PANEL,
    );
    expect(panelModeAfter).not.toBe("panel");

    await browser.execute((panelTestId) => {
      const panel = document.querySelector<HTMLElement>(`[data-testid="${panelTestId}"]`);
      panel?.querySelector<HTMLElement>("[data-workflow-pill]")?.closest("button")?.click();
    }, TID_CHAT_SUMMARY_PANEL);
    const rowSelector = 'li[data-background-task-kind="workflow"]';
    await browser.waitUntil(
      async () =>
        browser.execute((selector) => {
          const row = document.querySelector<HTMLElement>(selector);
          return (
            row !== null &&
            row.querySelector('[data-workflow-island-line="name"] [data-workflow-run-elapsed]') !==
              null &&
            row.querySelector(
              '[data-workflow-island-line="phase"] [data-workflow-run-lamp="running"]',
            ) !== null
          );
        }, rowSelector),
      {
        timeout: 15000,
        timeoutMsg: "\"Workflow\" section did not directly display run row (name + duration / indicator + terms across two lines) after expanding pill",
      },
    );
    await browser.waitUntil(
      async () => {
        await $(rowSelector).moveTo();
        return browser.execute((selector) => {
          const row = document.querySelector<HTMLElement>(selector);
          const stop = row?.querySelector<HTMLElement>(
            '[data-testid^="v4-background-work-cancel-"]',
          );
          return Boolean(row?.matches(":hover") && stop && getComputedStyle(stop).opacity === "1");
        }, rowSelector);
      },
      { timeout: 5000, timeoutMsg: "Stop did not appear on hovering run row" },
    );
  });

  it("Concurrency Chip: Running run displays \"Max Concurrency N\" after lowering limit in place, chip dismisses upon run completion", async function () {
    this.timeout(180000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    await waitForTestIdByDom(testId(TID_WORKFLOW_CARD, LAUNCH_SLEEP_NAME), {
      timeout: 20000,
      timeoutMsg: "Constant workflow card staying in running did not appear in workflow list",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_SLEEP_NAME), {
      timeoutMsg: "Constant workflow card has no \"Run\" button",
    });
    await browser.waitUntil(async () => (await readLaunchCardStatus()) === "running", {
      timeout: 60000,
      timeoutMsg: "run card did not enter running",
    });
    await clickTestIdByDom("workflow-card-open-details", {
      timeoutMsg: "run card has no \"Open Run Details\"",
    });
    await waitForTestIdByDom("workflow-run-configure", {
      timeout: 30000,
      timeoutMsg: "Configure is missing from running run side panel",
    });

    expect(await readTestIdText("workflow-run-concurrency")).toBeNull();

    await clickRunSidePaneControl("workflow-run-configure");
    await waitForTestIdByDom("workflow-run-settings-popover", {
      timeoutMsg: "Settings popover did not appear after clicking Configure",
    });
    const boundInput = $('[data-testid="workflow-run-settings-bound-value"]');
    const defaultBound = Number(await boundInput.getValue());
    expect(defaultBound).toBeGreaterThan(1);
    expect(await readTestIdText("workflow-run-settings-consequence")).toBe("");
    await clickTestIdByDom("workflow-run-settings-bound-decrease", {
      timeoutMsg: "Settings popover has no \"Reduce Max Concurrency\"",
    });
    await expect(boundInput).toHaveValue(String(defaultBound - 1));
    expect(await readTestIdText("workflow-run-settings-consequence")).toMatch(
      /^(立即应用到CurrentRun，不会NewFromOne次Run。|Applies to this run right away; no new run is started\.)$/,
    );
    await clickTestIdByDom("workflow-run-settings-apply", { timeoutMsg: "Settings popover has no \"Apply\"" });

    await browser.waitUntil(
      async () => {
        const text = await readTestIdText("workflow-run-concurrency");
        return (
          text !== null &&
          new RegExp(`^(最大ConcurrencyCount|Max concurrency) ${defaultBound - 1}\\b`).test(text)
        );
      },
      { timeout: 30000, timeoutMsg: "\"Max Concurrency N\" chip did not appear in run side panel after lowering limit in place" },
    );

    await browser.waitUntil(async () => (await readLaunchCardStatus()) === "completed", {
      timeout: 90000,
      timeoutMsg: "run card status did not reach completed",
    });
    await browser.waitUntil(
      async () =>
        (await readTestIdText("workflow-run-concurrency")) === null &&
        (await readTestIdText("workflow-run-configure")) === null,
      { timeout: 20000, timeoutMsg: "Concurrency chip or Configure still present on side panel after run completion" },
    );
  });

  it("Completed Run: Side panel shows \"Saved\" and \"Run Again\", chip links directly to Hub; after deletion, \"Save\" writes back identical script", async function () {
    this.timeout(240000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    await waitForTestIdByDom(testId(TID_WORKFLOW_CARD, LAUNCH_SAVE_NAME), {
      timeout: 20000,
      timeoutMsg: "Workflow card for save test case did not appear in workflow list",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_SAVE_NAME), {
      timeoutMsg: "Workflow card for save test case has no \"Run\" button",
    });
    await browser.waitUntil(async () => (await readLaunchCardStatus()) === "completed", {
      timeout: 90000,
      timeoutMsg: "run card status did not reach completed",
    });

    await clickTestIdByDom("workflow-card-open-details", {
      timeoutMsg: "run card has no \"Open Run Details\"",
    });
    await waitForTestIdByDom("workflow-saved-chip", {
      timeout: 30000,
      timeoutMsg: "\"Saved\" chip did not appear in run side panel status row",
    });
    await waitForTestIdByDom("workflow-save-run-again", {
      timeout: 10000,
      timeoutMsg: "run side panel has no \"Run Again\"",
    });

    await clickRunSidePaneControl("workflow-saved-chip");
    await waitForTestIdByDom(TID_WORKFLOW_DETAIL, {
      timeout: 20000,
      timeoutMsg: "Did not enter workflow details page after clicking chip",
    });
    expect((await readTestIdText(TID_WORKFLOW_DETAIL)) ?? "").toContain(LAUNCH_SAVE_NAME);

    await clickTestIdByWebDriver(TID_WORKFLOW_DETAIL_MENU, {
      timeoutMsg: "Details page missing \"More actions\" menu",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_ACTION_DELETE, LAUNCH_SAVE_NAME), {
      timeoutMsg: "Details page menu missing \"Delete workflow\" item",
    });
    await clickTestIdByDom(TID_CONFIRM_DIALOG_CONFIRM, {
      timeoutMsg: "Delete confirmation popup did not appear",
    });
    await browser.waitUntil(async () => !(await fileExists(LAUNCH_SAVE_FILE)), {
      timeout: 10000,
      timeoutMsg: "File on disk still exists after deletion",
    });

    const sessionTaskTestId = await browser.execute(
      (prefix, name) =>
        Array.from(document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)).find(
          (item) => item.textContent?.includes(name),
        )?.dataset.testid ?? null,
      testId(TID_TASK_ITEM, ""),
      LAUNCH_SAVE_NAME,
    );
    expect(sessionTaskTestId).not.toBeNull();
    await clickTestIdByDom(sessionTaskTestId!, { timeoutMsg: "Triggering session cannot be clicked in sidebar" });
    await clickTestIdByDom("workflow-card-open-details", {
      timeout: 20000,
      timeoutMsg: "run card has no \"Open Run Details\" after returning to session",
    });
    await waitForTestIdByDom("workflow-save-open", {
      timeout: 30000,
      timeoutMsg: "run side panel did not revert to \"Save\" after deleting workflow",
    });

    await clickRunSidePaneControl("workflow-save-open");
    await waitForTestIdByDom("workflow-save-popover", { timeoutMsg: "Popover did not appear after clicking \"Save\"" });
    await setInputValueByTestIdDom("workflow-save-name", LAUNCH_SAVE_NAME, {
      timeoutMsg: "Save popover has no name input field",
    });
    await clickTestIdByDom("workflow-save-submit", { timeoutMsg: "Save popover has no \"Save Directly\"" });
    await browser.waitUntil(async () => fileExists(LAUNCH_SAVE_FILE), {
      timeout: 20000,
      timeoutMsg: "Workflow file did not appear on disk after direct save",
    });
    const written = await readFile(LAUNCH_SAVE_FILE, "utf-8");
    expect(written.startsWith("/* cf-workflow")).toBe(true);
    expect(written.endsWith(`*/\n${LAUNCH_SAVE_SCRIPT}`)).toBe(true);

    await waitForTestIdByDom("workflow-saved-chip", {
      timeout: 20000,
      timeoutMsg: "\"Saved\" chip did not appear on run side panel after direct save",
    });
    await waitForTestIdByDom("workflow-save-run-again", {
      timeout: 10000,
      timeoutMsg: "run side panel did not switch to \"Run Again\" after direct save",
    });
  });

  it("Artifact Tab \"Open as File\": Saves this markdown version as a local copy and delegates to system default app", async function () {
    this.timeout(240000);

    await prepareConversationE2E({ skipProvider: true });

    await clickTestIdByDom(TID_AUTOMATIONS_OPEN, { timeoutMsg: "Sidebar missing Automation entry" });
    await clickTestIdByDom(testId(TID_AUTOMATIONS_PAGE_TAB, "workflow"), {
      timeoutMsg: "Automation page header missing \"Workflows\" toggle",
    });
    await waitForTestIdByDom(testId(TID_WORKFLOW_CARD, LAUNCH_ARTIFACT_NAME), {
      timeout: 20000,
      timeoutMsg: "Workflow card for artifact test case did not appear in workflow list",
    });
    await clickTestIdByDom(testId(TID_WORKFLOW_CARD_RUN, LAUNCH_ARTIFACT_NAME), {
      timeoutMsg: "Workflow card for artifact test case has no \"Run\" button",
    });
    await browser.waitUntil(async () => (await readLaunchCardStatus()) === "completed", {
      timeout: 90000,
      timeoutMsg: "run card status did not reach completed",
    });

    await clickTestIdByDom("workflow-card-open-details", {
      timeoutMsg: "run card has no \"Open Run Details\"",
    });
    await clickTestIdByDom(TID_WORKFLOW_ARTIFACT_CARD, {
      timeout: 30000,
      timeoutMsg: "Artifact row did not appear in run side panel",
    });
    await waitForTestIdByDom(TID_WORKFLOW_ARTIFACT_PANE, {
      timeout: 20000,
      timeoutMsg: "点产物行后没有打开产物 tab",
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() => Boolean(document.querySelector('[data-artifact-body="markdown"]'))),
      { timeout: 20000, timeoutMsg: "Artifact tab did not render markdown body" },
    );

    const openPath = await browser.electron.mock("shell", "openPath");
    await openPath.mockResolvedValue("");
    try {
      const readOpenedPaths = async (): Promise<string[]> => {
        await openPath.update();
        return openPath.mock.calls.map(([path]) => String(path));
      };
      await clickTestIdByDom("workflow-artifact-open-as-file", {
        timeoutMsg: "\"Open as File\" is missing from artifact tab header",
      });
      await browser.waitUntil(async () => (await readOpenedPaths()).length === 1, {
        timeout: 15000,
        timeoutMsg: "\"Open as File\" did not open file via shell.openPath",
      });
      const [openedPath] = await readOpenedPaths();
      expect(openedPath).toContain(join("tmp", "workflow-artifacts"));
      expect(openedPath!.endsWith(join("v1", `${LAUNCH_ARTIFACT_ID}.md`))).toBe(true);
      expect(await readFile(openedPath!, "utf-8")).toBe(LAUNCH_ARTIFACT_MARKDOWN);

      await clickTestIdByDom("workflow-artifact-open-as-file", {
        timeoutMsg: "\"Open as File\" is missing from artifact tab header",
      });
      await browser.waitUntil(async () => (await readOpenedPaths()).length === 2, {
        timeout: 15000,
        timeoutMsg: "Second \"Open as File\" did not open file",
      });
      expect((await readOpenedPaths())[1]).toBe(openedPath);
    } finally {
      await browser.electron.restoreAllMocks();
    }
  });
});
