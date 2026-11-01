import { TID_TASK_ITEM, testId } from "@origin-ai/cf-shared/test-ids";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import {
  TASK_INDEX_ROW_AUTHORITY_MISSING_SUMMARY_ID,
  TASK_INDEX_ROW_AUTHORITY_MISSING_SUMMARY_TITLE,
  TASK_INDEX_ROW_AUTHORITY_TASK_IDS,
  TASK_INDEX_ROW_AUTHORITY_TOTAL,
} from "../../../helpers/task-list-row-authority-fixture.js";
import { ensureProjectExpanded, projectSectionSelector } from "../../../helpers/project-sidebar.js";

const CASE_TIMEOUT_MS = 120_000;
const SHOW_MORE_LABELS = ["显示更多", "Show more"];

describe("TSL23: tasks-index is the authoritative source for persistent Project task rows", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Cold start still paginates 25 persistent tasks when sessions-index has only one summary", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    await ensureProjectExpanded(DEFAULT_WORKSPACE);
    await waitForAuthorityTaskCount(5, "Project initial screen did not display 5 tasks-index tasks");

    let visibleCount = await readAuthorityTaskIds().then((ids) => ids.length);
    while (visibleCount < TASK_INDEX_ROW_AUTHORITY_TOTAL) {
      const clicked = await clickWorkspaceShowMore();
      expect(clicked).toBe(true);
      const previousCount = visibleCount;
      await browser.waitUntil(
        async () => {
          visibleCount = await readAuthorityTaskIds().then((ids) => ids.length);
          return visibleCount > previousCount;
        },
        {
          timeout: 15_000,
          timeoutMsg: `Project 点击Show more后TaskCount没有增Long: previous=${previousCount}`,
        },
      );
    }

    const visibleTaskIds = await readAuthorityTaskIds();
    expect(visibleTaskIds).toHaveLength(TASK_INDEX_ROW_AUTHORITY_TOTAL);
    expect(new Set(visibleTaskIds).size).toBe(TASK_INDEX_ROW_AUTHORITY_TOTAL);
    expect(new Set(visibleTaskIds)).toEqual(new Set(TASK_INDEX_ROW_AUTHORITY_TASK_IDS));

    const missingSummaryRow = await browser.execute(
      (taskItemTestId) => {
        const row = document.querySelector<HTMLElement>(`[data-testid="${taskItemTestId}"]`);
        return {
          exists: Boolean(row),
          hasLoadingIndicator: Boolean(row?.querySelector(".animate-spin")),
          text: row?.textContent?.trim() ?? "",
        };
      },
      testId(TID_TASK_ITEM, TASK_INDEX_ROW_AUTHORITY_MISSING_SUMMARY_ID),
    );
    expect(missingSummaryRow.exists).toBe(true);
    expect(missingSummaryRow.text).toContain(TASK_INDEX_ROW_AUTHORITY_MISSING_SUMMARY_TITLE);
    expect(missingSummaryRow.hasLoadingIndicator).toBe(false);
  });
});

async function waitForAuthorityTaskCount(expected: number, timeoutMsg: string) {
  await browser.waitUntil(async () => (await readAuthorityTaskIds()).length >= expected, {
    timeout: 45_000,
    timeoutMsg,
  });
}

function readAuthorityTaskIds(): Promise<string[]> {
  return browser.execute(
    (taskIds, taskItemPrefix) => {
      const visibleTestIds = new Set(
        Array.from(
          document.querySelectorAll<HTMLElement>(`[data-testid^="${taskItemPrefix}-"]`),
        ).map((element) => element.dataset.testid ?? ""),
      );
      return taskIds.filter((taskId) => visibleTestIds.has(`${taskItemPrefix}-${taskId}`));
    },
    TASK_INDEX_ROW_AUTHORITY_TASK_IDS,
    TID_TASK_ITEM,
  );
}

function clickWorkspaceShowMore(): Promise<boolean> {
  return browser.execute(
    (workspaceTestId, labels) => {
      const workspaceRow = document.querySelector<HTMLElement>(workspaceTestId);
      const workspaceListItem = workspaceRow;
      const showMore = Array.from(
        workspaceListItem?.querySelectorAll<HTMLElement>("span") ?? [],
      ).find((element) => labels.includes((element.textContent ?? "").trim()));
      showMore?.click();
      return Boolean(showMore);
    },
    projectSectionSelector(DEFAULT_WORKSPACE),
    SHOW_MORE_LABELS,
  );
}
