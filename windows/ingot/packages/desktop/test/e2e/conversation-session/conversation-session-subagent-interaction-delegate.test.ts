import { clearAppData } from "../helpers/desktop-app.js";
import { waitForUpstreamRequest } from "../helpers/conversation-session-network.js";
import {
  approveV4Permission,
  clickV4Stop,
  getV4ConfigProjection,
  getV4PaneSnapshot,
  prepareV4ConversationE2E,
  sendV4Prompt,
  switchV4Mode,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
  waitForV4PermissionDialogInComposerDock,
  waitForV4TimelineContaining,
} from "../helpers/v4-conversation.js";

const YOLO_PARENT_MARKER = "E2E_SUBAGENT_HITL_YOLO_PARENT";
const YOLO_CHILD_MARKER = "E2E_SUBAGENT_HITL_YOLO_CHILD";
const YOLO_QUESTION_MARKER = "E2E_SUBAGENT_HITL_YOLO_QUESTION";
const YOLO_ANSWER_MARKER = "E2E_SUBAGENT_HITL_YOLO_ANSWER";
const YOLO_CHILD_DONE = "E2E_SUBAGENT_HITL_YOLO_CHILD_DONE";
const YOLO_PARENT_DONE = "E2E_SUBAGENT_HITL_YOLO_PARENT_DONE";
const YOLO_AGENT_TOOL_CALL_ID = "toolu_e2e_subagent_hitl_yolo_agent";
const YOLO_ASK_TOOL_CALL_ID = "toolu_e2e_subagent_hitl_yolo_ask";

const PERMISSION_PARENT_MARKER = "E2E_SUBAGENT_HITL_PERMISSION_PARENT";
const PERMISSION_CHILD_MARKER = "E2E_SUBAGENT_HITL_PERMISSION_CHILD";
const PERMISSION_BASH_OUTPUT = "E2E_SUBAGENT_HITL_PERMISSION_BASH_OUTPUT";
const PERMISSION_CHILD_DONE = "E2E_SUBAGENT_HITL_PERMISSION_CHILD_DONE";
const PERMISSION_PARENT_DONE = "E2E_SUBAGENT_HITL_PERMISSION_PARENT_DONE";
const PERMISSION_AGENT_TOOL_CALL_ID = "toolu_e2e_subagent_hitl_permission_agent";
const PERMISSION_BASH_TOOL_CALL_ID = "toolu_e2e_subagent_hitl_permission_bash";

describe("Chat area subagent human-in-the-loop proxy E2E", () => {
  afterEach(async () => {
    try {
      let snapshot = await getV4PaneSnapshot();
      if (snapshot.sessionId === "draft") {
        try {
          snapshot = await waitForV4Pane(
            (current) => current.sessionId !== "draft",
            "subagent interaction case teardown timed out waiting for real session binding",
            10_000,
          );
        } catch {
        }
      }
      if (snapshot.canStop) {
        await clickV4Stop();
        await waitForV4Pane(
          (snapshot) => !snapshot.canStop,
          "subagent interaction case teardown 后仍处于运行态",
          30_000,
        );
      }
    } catch {
    }
  });

  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("T01: Child AskUserQuestion still proxies to parent task under Full access", async function () {
    this.timeout(180_000);

    await prepareConversationE2EInMode("yolo");

    const runId = Date.now();
    const prompt = [
      `${YOLO_PARENT_MARKER}_${runId}: Use the Agent tool with subagent_type "general-purpose".`,
      `Ask the child to trigger ${YOLO_CHILD_MARKER}, ask one question, and then finish.`,
      `After the child returns, reply with exactly ${YOLO_PARENT_DONE}.`,
    ].join(" ");
    const answer = `${YOLO_ANSWER_MARKER}_${runId}`;

    await sendV4Prompt(prompt);
    const parentPane = await waitForV4Pane(
      (snapshot) => Boolean(snapshot.sessionId && snapshot.sessionId !== "draft"),
      "No real session bound after subagent AskUserQuestion case sent",
      30_000,
    );
    await waitForV4TimelineContaining(`${YOLO_PARENT_MARKER}_${runId}`, 30_000);

    const interaction = await waitForSubagentInteractionInParentDock(
      "elicitation",
      YOLO_QUESTION_MARKER,
      60_000,
    );
    expect(interaction.parentSessionId).toBe(parentPane.sessionId);
    expect(interaction.originTitle).toContain("general-purpose");

    await submitCustomElicitationAnswer(answer);
    await waitForInteractionClosed("elicitation", 30_000);

    await waitForUpstreamRequest(
      {
        includes: [answer, YOLO_CHILD_MARKER, YOLO_ASK_TOOL_CALL_ID],
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      },
      "Child AskUserQuestion answer did not enter child's next model request",
      60_000,
    );
    await waitForUpstreamRequest(
      {
        includes: [YOLO_PARENT_MARKER, YOLO_CHILD_DONE, YOLO_AGENT_TOOL_CALL_ID],
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      },
      "child AskUserQuestion 完成后父会话没有收到 Agent tool_result continuation",
      60_000,
    );
    await waitForV4AssistantMessageContaining(YOLO_PARENT_DONE, 60_000);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "subagent AskUserQuestion delegate case 完成后没有回到 idle",
      60_000,
    );
  });

  it("T02: Child Bash permission request proxies to parent task in build mode", async function () {
    this.timeout(180_000);

    await prepareConversationE2EInMode("build");

    const runId = Date.now();
    const prompt = [
      `${PERMISSION_PARENT_MARKER}_${runId}: Use the Agent tool with subagent_type "general-purpose".`,
      `Ask the child to trigger ${PERMISSION_CHILD_MARKER}, run one Bash command, and then finish.`,
      `After the child returns, reply with exactly ${PERMISSION_PARENT_DONE}.`,
    ].join(" ");

    await sendV4Prompt(prompt);
    const parentPane = await waitForV4Pane(
      (snapshot) => Boolean(snapshot.sessionId && snapshot.sessionId !== "draft"),
      "No real session bound after subagent permission case sent",
      30_000,
    );
    await waitForV4TimelineContaining(`${PERMISSION_PARENT_MARKER}_${runId}`, 30_000);

    const dockState = await waitForV4PermissionDialogInComposerDock(60_000);
    expect(dockState.inDock).toBe(true);
    expect(dockState.composerHidden).toBe(true);
    const interaction = await waitForSubagentInteractionInParentDock(
      "permission",
      PERMISSION_BASH_OUTPUT,
      60_000,
    );
    expect(interaction.parentSessionId).toBe(parentPane.sessionId);
    expect(interaction.originTitle).toContain("general-purpose");
    expect(await hasInteraction("elicitation")).toBe(false);

    expect(await approveV4Permission()).toBe(true);
    await waitForInteractionClosed("permission", 30_000);

    await waitForUpstreamRequest(
      {
        includes: [PERMISSION_CHILD_MARKER, PERMISSION_BASH_OUTPUT, PERMISSION_BASH_TOOL_CALL_ID],
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      },
      "Output did not enter child's next model request after child Bash allowed",
      60_000,
    );
    await waitForUpstreamRequest(
      {
        includes: [PERMISSION_PARENT_MARKER, PERMISSION_CHILD_DONE, PERMISSION_AGENT_TOOL_CALL_ID],
        excludes: ["Generate a concise title", "CRITICAL: Respond with TEXT ONLY"],
      },
      "child Bash 完成后父会话没有收到 Agent tool_result continuation",
      60_000,
    );
    await waitForV4AssistantMessageContaining(PERMISSION_PARENT_DONE, 60_000);
    await waitForV4Pane(
      (snapshot) => !snapshot.canStop,
      "subagent permission delegate case 完成后没有回到 idle",
      60_000,
    );
  });
});

type InteractionKind = "elicitation" | "permission";

interface InteractionDockSnapshot {
  parentSessionId: string | null;
  originTitle: string;
  text: string;
}

async function prepareConversationE2EInMode(mode: "build" | "yolo") {
  await prepareV4ConversationE2E();
  await switchV4Mode(mode);
  await browser.waitUntil(async () => (await getV4ConfigProjection()).mode === mode, {
    timeout: 30_000,
    timeoutMsg: `subagent interaction case 没有切换到 mode=${mode}`,
  });
}

async function waitForSubagentInteractionInParentDock(
  kind: InteractionKind,
  expectedText: string,
  timeoutMs: number,
): Promise<InteractionDockSnapshot> {
  let latest: InteractionDockSnapshot | null = null;
  await browser.waitUntil(
    async () => {
      latest = await readInteractionDock(kind);
      return Boolean(
        latest?.parentSessionId && latest.originTitle && latest.text.includes(expectedText),
      );
    },
    {
      timeout: timeoutMs,
      timeoutMsg: `父 task 没有出现带 subagent Source的 ${kind} interaction; latest=${JSON.stringify(
        latest,
      )}`,
    },
  );
  const snapshot = await readInteractionDock(kind);
  if (!snapshot) {
    throw new Error(`WaitingCompleted后 ${kind} interaction 仍不存在`);
  }
  return snapshot;
}

function readInteractionDock(kind: InteractionKind): Promise<InteractionDockSnapshot | null> {
  return browser.execute((kindArg) => {
    const normalize = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    const anchor =
      kindArg === "elicitation"
        ? document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]')
        : Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).find((element) => {
            const label = normalize(element.getAttribute("aria-label"));
            return label === "需要权限" || label === "Permission required";
          });
    const dock = anchor?.closest<HTMLElement>('[data-v4-composer-dock="true"]');
    const pane = dock?.closest<HTMLElement>('[data-testid^="v4-session-pane-"]');
    const badge = dock?.querySelector<HTMLElement>('[data-interaction-origin-badge="subagent"]');
    if (!anchor || !dock || !pane || !badge) {
      return null;
    }
    return {
      parentSessionId: pane.getAttribute("data-session-id"),
      originTitle: normalize(badge.getAttribute("title")),
      text: normalize(dock.innerText || dock.textContent),
    };
  }, kind);
}

function hasInteraction(kind: InteractionKind): Promise<boolean> {
  return browser.execute((kindArg) => {
    if (kindArg === "elicitation") {
      return Boolean(document.querySelector<HTMLElement>('[data-elicitation-dialog-body="true"]'));
    }
    const normalize = (value: string | null | undefined) =>
      (value ?? "").replace(/\u00a0/g, " ").trim();
    return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"]')).some(
      (element) => {
        const label = normalize(element.getAttribute("aria-label"));
        return label === "需要权限" || label === "Permission required";
      },
    );
  }, kind);
}

async function waitForInteractionClosed(kind: InteractionKind, timeoutMs: number) {
  await browser.waitUntil(async () => !(await hasInteraction(kind)), {
    timeout: timeoutMs,
    timeoutMsg: `${kind} interaction 响应后没有从父 task 清除`,
  });
}

async function submitCustomElicitationAnswer(answer: string) {
  const input = await $('[data-elicitation-dialog-body="true"] textarea');
  await input.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: "AskUserQuestion 自定义回答输入框没有出现",
  });
  await input.setValue(answer);
  await browser.waitUntil(async () => (await input.getValue()) === answer, {
    timeout: 10_000,
    timeoutMsg: "Custom AskUserQuestion answer was not entered into input box",
  });

  const submitButton = await $("//button[contains(., '提交') or contains(., 'Submit')]");
  await submitButton.waitForEnabled({
    timeout: 30_000,
    timeoutMsg: "AskUserQuestion 提交按钮没有启用",
  });
  await submitButton.click();
}
