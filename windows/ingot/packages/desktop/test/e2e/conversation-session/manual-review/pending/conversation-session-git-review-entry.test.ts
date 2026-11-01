import { open, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  TID_CHAT_SUMMARY_PANEL,
  TID_GIT_PANE,
  TID_TASK_ITEM,
  testId,
} from "@origin-ai/cf-shared/test-ids";
import type { ChainablePromiseElement } from "webdriverio";
import {
  DEFAULT_WORKSPACE,
  clearAppData,
  waitForTestIdByDom,
  waitForWorkspaceApp,
} from "../../../helpers/desktop-app.js";
import { PROVIDER_READINESS_HISTORY_SESSION_ID } from "../../../helpers/provider-readiness-history-fixture.js";
import { selectV4TaskById } from "../../../helpers/v4-conversation.js";

const CASE_TIMEOUT_MS = 120_000;
const FILE_NAME = "status-panel-review.txt";
const CHANGES_LABELS = ["更改", "Changes"];
const EXPAND_LABELS = ["Expand status", "Expanded"];
const UNSTAGED_LABELS = ["未暂存", "Unstaged"];

describe("SP13：status panel Git Changes 打开变更审阅", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Click Changes to open Git pane, select unstaged, and show target file", async function () {
    this.timeout(CASE_TIMEOUT_MS);

    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    await waitForTestIdByDom(
      testId(TID_TASK_ITEM, PROVIDER_READINESS_HISTORY_SESSION_ID),
      {
        timeout: 30_000,
        timeoutMsg: "SP13 preset read-only historical session not found in task list",
      },
    );
    await selectV4TaskById(PROVIDER_READINESS_HISTORY_SESSION_ID);
    await waitForExpandedStatusPanel();

    expect(await isGitPaneMounted()).toBe(false);
    await clickStatusPanelChanges();
    const review = await waitForGitReview();

    expect(UNSTAGED_LABELS).toContain(review.sourceLabel);
    expect(review.text).toContain(FILE_NAME);
    expect(review.rowCount).toBeGreaterThan(0);
  });

  it("Git auto-refresh skips line counts over limit and Host memory is bounded", async function () {
    this.timeout(CASE_TIMEOUT_MS);
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    await selectV4TaskById(PROVIDER_READINESS_HISTORY_SESSION_ID);
    await waitForExpandedStatusPanel();
    const caseRoot = join(DEFAULT_WORKSPACE, ".cf-e2e/conversation-session-git-review-entry");
    const largeText = "large-untracked.txt";
    await browser.electron.execute((electron) => {
      const state = globalThis as typeof globalThis & {
        gitMemoryProbe?: { baseline: number; peak: number; timer: ReturnType<typeof setInterval> };
      };
      const readHostKb = () =>
        electron.app
          .getAppMetrics()
          .filter((metric) => metric.name?.startsWith("cf-host"))
          .reduce((total, metric) => total + metric.memory.workingSetSize, 0);
      const baseline = readHostKb();
      if (!baseline) throw new Error("No real Host process found for sampling");
      const probe = {
        baseline,
        peak: baseline,
        timer: setInterval(() => {
          probe.peak = Math.max(probe.peak, readHostKb());
        }, 25),
      };
      state.gitMemoryProbe = probe;
    });
    try {
      await writeFile(join(caseRoot, largeText), "line\n".repeat(300_000));
      for (let index = 0; index < 8; index++) {
        const file = await open(join(caseRoot, `large-${index}.bin`), "w");
        try {
          await file.truncate(32 * 1024 * 1024);
        } finally {
          await file.close();
        }
      }
      await writeFile(join(caseRoot, FILE_NAME), "one\ntwo\nthree\nfour\n");
      const changedAt = new Date();
      await utimes(join(DEFAULT_WORKSPACE, ".git", "HEAD"), changedAt, changedAt);
      await browser.waitUntil(
        async () => {
          const changes = await findButtonByLabels(
            $(`[data-testid="${TID_CHAT_SUMMARY_PANEL}"]`),
            CHANGES_LABELS,
          );
          return Boolean(changes && /\+4\s+-0/u.test(await changes.getText()));
        },
        {
          timeout: 90_000,
          interval: 500,
          timeoutMsg: "Auto-refresh should update small files to +4, large text should not count toward line numbers",
        },
      );
    } finally {
      const memory = await browser.electron.execute(() => {
        const state = globalThis as typeof globalThis & {
          gitMemoryProbe?: {
            baseline: number;
            peak: number;
            timer: ReturnType<typeof setInterval>;
          };
        };
        const probe = state.gitMemoryProbe;
        if (!probe) throw new Error("Host 内存探针不存在");
        clearInterval(probe.timer);
        delete state.gitMemoryProbe;
        return {
          baselineKb: probe.baseline,
          peakKb: probe.peak,
          deltaKb: probe.peak - probe.baseline,
        };
      });
      console.log("[git-untracked-memory]", JSON.stringify(memory));
      expect(memory.deltaKb).toBeLessThan(96 * 1024);
    }
  });
});

async function waitForExpandedStatusPanel() {
  await waitForTestIdByDom(TID_CHAT_SUMMARY_PANEL, {
    timeout: 30_000,
    timeoutMsg: "SP13 status panel containing Git Tools not displayed",
  });

  const panel = $(`[data-testid="${TID_CHAT_SUMMARY_PANEL}"]`);
  if ((await panel.getAttribute("data-state")) !== "expanded") {
    const expandButton = await findButtonByLabels(panel, EXPAND_LABELS);
    if (!expandButton) {
      throw new Error("SP13 status panel is collapsed, but lacks clickable expand entry");
    }
    await expandButton.click();
  }

  await browser.waitUntil(
    async () =>
      (await panel.getAttribute("data-state")) === "expanded" &&
      Boolean(await findButtonByLabels(panel, CHANGES_LABELS)),
    {
      timeout: 30_000,
      timeoutMsg: "SP13 status panel lacks clickable Changes entry after expansion",
    },
  );
}

async function clickStatusPanelChanges() {
  const panel = $(`[data-testid="${TID_CHAT_SUMMARY_PANEL}"]`);
  const changesButton = await findButtonByLabels(panel, CHANGES_LABELS);
  if (!changesButton) {
    throw new Error("SP13 Changes button not found");
  }
  expect(await changesButton.isEnabled()).toBe(true);
  await changesButton.click();
}

async function findButtonByLabels(
  root: ChainablePromiseElement,
  labels: readonly string[],
) {
  const buttons = await root.$$("button");
  for (const button of buttons) {
    const text = (await button.getText()).trim();
    const firstLine = text.split(/\r?\n/u, 1)[0] ?? "";
    const ariaLabel = (await button.getAttribute("aria-label"))?.trim() ?? "";
    if (
      labels.some(
        (label) => ariaLabel === label || firstLine === label,
      )
    ) {
      return button;
    }
  }
  return null;
}

function isGitPaneMounted() {
  return browser.execute(
    (gitPaneTestId) =>
      Boolean(document.querySelector(`[data-testid="${gitPaneTestId}"]`)),
    TID_GIT_PANE,
  );
}

interface GitReviewSnapshot {
  rowCount: number;
  sourceLabel: string;
  text: string;
}

async function waitForGitReview() {
  let latest: GitReviewSnapshot | null = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await readGitReviewSnapshot();
        return (
          UNSTAGED_LABELS.includes(latest.sourceLabel) &&
          latest.text.includes(FILE_NAME) &&
          latest.rowCount > 0
        );
      },
      {
        timeout: 30_000,
        timeoutMsg: "SP13 Git review did not show unstaged target file",
      },
    );
  } catch (error) {
    latest = await readGitReviewSnapshot().catch(() => latest);
    throw new Error(
      `SP13 Git review 断言Failed: ${JSON.stringify(latest)}`,
      { cause: error },
    );
  }
  return readGitReviewSnapshot();
}

function readGitReviewSnapshot(): Promise<GitReviewSnapshot> {
  return browser.execute((gitPaneTestId) => {
    const pane = document.querySelector<HTMLElement>(
      `[data-testid="${gitPaneTestId}"]`,
    );
    const sourceTrigger = pane?.querySelector<HTMLElement>(
      '[data-slot="select-trigger"]',
    );
    return {
      rowCount:
        pane?.querySelectorAll("[data-git-pane-change-virtual-row]").length ?? 0,
      sourceLabel: sourceTrigger?.textContent?.trim() ?? "",
      text: pane?.innerText ?? "",
    };
  }, TID_GIT_PANE);
}
