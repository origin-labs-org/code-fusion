import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_WORKSPACE, clearAppData } from "../helpers/desktop-app.js";
import { waitForUpstreamRequest } from "../helpers/conversation-session-network.js";
import { waitForToolCallBlockByToolName } from "../helpers/conversation-session-tool.js";
import {
  E2E_REPLY_TOKEN,
  getV4ConfigProjection,
  getV4ComposerText,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const PROMPT_MARKER = "E2E_PLAN_APPROVAL_PRIMARY_SUBMIT";
const ENTER_MARKER = "E2E_PLAN_APPROVAL_PRIMARY_SUBMIT_ENTER_PLAN";
const EXIT_MARKER = "E2E_PLAN_APPROVAL_PRIMARY_SUBMIT_EXIT_PLAN";
const PLAN_MARKER = "E2E_PLAN_APPROVAL_PRIMARY_SUBMIT_PLAN_BODY";
const APPROVED_PLAN_TEXT = `${PLAN_MARKER}: verify footer submit approves an unchanged plan.`;
const EXIT_TOOL_CALL_ID = "toolu_e2e_plan_approval_primary_submit_exit";
const APPROVED_MESSAGE = "User has approved your plan";
const DENIED_MESSAGE = "The plan was not approved by the user.";

let createdPlanFilePath: string | null = null;

describe("conversation session plan approval primary submit", () => {
  after(async () => {
    if (createdPlanFilePath) {
      await rm(createdPlanFilePath, { force: true });
    }
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("空反馈时只点击 footer 主提交应批准 ExitPlanMode", async function () {
    this.timeout(120_000);
    await prepareV4ConversationE2E();
    await switchV4Mode("yolo");

    const runId = Date.now();
    const prompt = [
      `${PROMPT_MARKER}_${runId}: enter plan mode and request approval.`,
      `${ENTER_MARKER}: call EnterPlanMode before drafting.`,
      `${EXIT_MARKER}: call ExitPlanMode with the proposed plan.`,
    ].join(" ");

    await sendV4Prompt(prompt);
    await waitForEmptyV4Composer();
    await waitForV4TimelineContaining(PROMPT_MARKER);

    const activeTask = await waitForV4Pane(
      (snapshot) => snapshot.sessionId !== null && snapshot.sessionId !== "draft",
      "plan approval primary submit did not create a session",
      30_000,
    );
    const sessionId = activeTask.sessionId;
    if (!sessionId || sessionId === "draft") {
      throw new Error("plan approval primary submit sessionId is empty");
    }
    createdPlanFilePath = join(DEFAULT_WORKSPACE, ".cf", "plans", `plan-${sessionId}.md`);

    await waitForUpstreamRequest(
      {
        includes: [PROMPT_MARKER, ENTER_MARKER, EXIT_MARKER],
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      },
      "plan approval primary submit initial request",
      60_000,
    );

    await waitForUpstreamRequest(
      {
        includes: [EXIT_MARKER, "toolu_e2e_plan_approval_primary_submit_enter"],
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      },
      "plan approval primary submit ExitPlanMode request",
      60_000,
    );
    await waitForToolCallBlockByToolName("ExitPlanMode", 60_000);
    await waitForPlanApprovalDialog(60_000);
    await browser.waitUntil(async () => (await getV4ConfigProjection()).planEnabled === true, {
      timeout: 10000,
      timeoutMsg: "EnterPlanMode result did not enable input box Plan indicator",
    });
    expect((await getV4ConfigProjection()).mode).toBe("yolo");
    expect(await readPlanApprovalCustomInputSemantics()).toEqual({
      tagName: "TEXTAREA",
      rows: "1",
      autoSizing: true,
      maxVisibleLines: 5,
      index: "2.",
      indexVisible: true,
      indexCenteredOnFirstLine: true,
    });

    await expectApproveOptionInitiallyFocused();

    await clickPrimarySubmitWithoutSelectingApprove();
    await waitForPlanApprovalDialogClosed(30_000);
    await browser.waitUntil(async () => (await getV4ConfigProjection()).planEnabled === false, {
      timeout: 10000,
      timeoutMsg: "Approval result did not clear input box Plan indicator",
    });
    expect((await getV4ConfigProjection()).mode).toBe("yolo");

    const planFileContent = await waitForPlanFileContent(createdPlanFilePath, 30_000);
    expect(planFileContent).toBe(APPROVED_PLAN_TEXT);

    await waitForUpstreamRequest(
      {
        includes: [EXIT_TOOL_CALL_ID, APPROVED_PLAN_TEXT, APPROVED_MESSAGE],
        excludes: [DENIED_MESSAGE, "Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      },
      "plan approval primary submit continuation request",
      60_000,
    );
    await waitForV4AssistantMessageContaining(E2E_REPLY_TOKEN);
    await waitForV4Pane(
      (snapshot) => snapshot.sessionId === sessionId && !snapshot.canStop,
      "plan approval primary submit continuation did not complete",
      60_000,
    );
  });
});

async function waitForEmptyV4Composer() {
  let latest: string | null = null;
  await browser.waitUntil(
    async () => {
      latest = await getV4ComposerText();
      return latest === "";
    },
    {
      timeout: 30_000,
      timeoutMsg: `plan approval primary submit Input field was not cleared after initial send; latest=${JSON.stringify(latest)}`,
    },
  );
}

async function waitForPlanApprovalDialog(timeoutMs: number) {
  let latestDialogText = "";
  await browser.waitUntil(
    async () => {
      latestDialogText = await browser.execute(() => {
        const body = document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]');
        const footer = document.querySelector<HTMLElement>(
          '[data-elicitation-dialog-footer="true"]',
        );
        return [body?.innerText, footer?.innerText].filter(Boolean).join("\n");
      });
      return ["批准", "Approve"].some((text) => latestDialogText.includes(text));
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `ExitPlanMode Plan审批弹窗没有出现; latest=${latestDialogText}`,
    },
  );
}

function readPlanApprovalCustomInputSemantics() {
  return browser.execute(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-elicitation-dialog-body="true"] textarea',
    );
    const index = textarea?.previousElementSibling;
    const style = textarea ? getComputedStyle(textarea) : null;
    const indexRect = index?.getBoundingClientRect();
    return {
      tagName: textarea?.tagName ?? null,
      rows: textarea?.getAttribute("rows") ?? null,
      autoSizing: textarea?.classList.contains("field-sizing-content") ?? false,
      maxVisibleLines: textarea
        ? parseFloat(getComputedStyle(textarea).maxHeight) /
          parseFloat(getComputedStyle(textarea).lineHeight)
        : null,
      index: index?.textContent ?? null,
      indexCenteredOnFirstLine: Boolean(
        textarea &&
        style &&
        indexRect &&
        Math.abs(
          indexRect.top +
            indexRect.height / 2 -
            (textarea.getBoundingClientRect().top +
              parseFloat(style.borderTopWidth) +
              parseFloat(style.paddingTop) +
              parseFloat(style.lineHeight) / 2),
        ) <= 0.5,
      ),
      indexVisible: Boolean(
        index &&
        index.getBoundingClientRect().width > 0 &&
        getComputedStyle(index).visibility !== "hidden" &&
        index.getAttribute("aria-hidden") !== "true",
      ),
    };
  });
}

async function expectApproveOptionInitiallyFocused() {
  let latest: {
    activeText: string;
    approveFound: boolean;
    approveSelected: boolean;
    focusedIsApprove: boolean;
  } | null = null;
  await browser.waitUntil(
    async () => {
      latest = await browser.execute(() => {
        const normalizeText = (value: string | null | undefined) =>
          (value ?? "").replace(/\u00a0/g, " ").trim();
        const body = document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]');
        const approve = Array.from(
          body?.querySelectorAll<HTMLButtonElement>('button[role="option"]') ?? [],
        ).find((button) =>
          ["批准", "Approve"].some((label) => normalizeText(button.textContent).includes(label)),
        );
        return {
          activeText: normalizeText((document.activeElement as HTMLElement | null)?.textContent),
          approveFound: Boolean(approve),
          approveSelected: approve?.getAttribute("aria-selected") === "true",
          focusedIsApprove: document.activeElement === approve,
        };
      });
      return latest.approveFound && latest.focusedIsApprove && !latest.approveSelected;
    },
    {
      timeout: 10_000,
      timeoutMsg: `ExitPlanMode Approve项没有获得初始真实焦点，or被提前选Medium; latest=${JSON.stringify(latest)}`,
    },
  );
}

async function clickPrimarySubmitWithoutSelectingApprove() {
  const result = await browser.execute(() => {
    const normalizeText = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    const body = document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]');
    const footer = document.querySelector<HTMLElement>('[data-elicitation-dialog-footer="true"]');
    const approveOption = Array.from(
      body?.querySelectorAll<HTMLButtonElement>('button[role="option"]') ?? [],
    ).find((button) =>
      ["批准", "Approve"].some((label) => normalizeText(button.textContent).includes(label)),
    );
    const buttons = Array.from(footer?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const submitButton = buttons.find((button) =>
      ["提交", "Submit"].includes(normalizeText(button.textContent)),
    );
    const customAnswer = body?.querySelector<HTMLTextAreaElement>("textarea")?.value ?? null;
    if (submitButton && !submitButton.disabled && customAnswer === "") {
      submitButton.click();
    }
    return {
      approveOptionFound: Boolean(approveOption),
      approveOptionSelected: approveOption?.getAttribute("aria-selected") === "true",
      customAnswer,
      submitButtonClicked: Boolean(submitButton && !submitButton.disabled && customAnswer === ""),
    };
  });

  expect(result).toEqual({
    approveOptionFound: true,
    approveOptionSelected: false,
    customAnswer: "",
    submitButtonClicked: true,
  });
}

async function waitForPlanApprovalDialogClosed(timeoutMs: number) {
  await browser.waitUntil(
    async () =>
      !(await browser.execute(() =>
        Boolean(document.querySelector('[data-elicitation-dialog-footer="true"]')),
      )),
    {
      timeout: timeoutMs,
      timeoutMsg: "点击 footer 主提交后 ExitPlanMode 计划审批弹窗没有关闭",
    },
  );
}

async function waitForPlanFileContent(planFilePath: string, timeoutMs: number) {
  let latestError = "";
  await browser.waitUntil(
    async () => {
      try {
        return (await readFile(planFilePath, "utf8")) === APPROVED_PLAN_TEXT;
      } catch (error) {
        latestError = error instanceof Error ? error.message : String(error);
        return false;
      }
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `主SubmitApprove后的 plan 没有Write ${planFilePath}: ${latestError}`,
    },
  );
  return readFile(planFilePath, "utf8");
}
