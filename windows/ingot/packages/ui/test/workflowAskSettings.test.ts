// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type CfPermissionRequest } from "@origin-ai/cf-shared";
import { TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER } from "@origin-ai/cf-shared/test-ids";
import type { ConversationSnapshot } from "@origin-ai/cf-shared/cf-protocol-v4";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlock: ({ code }: { code: string }) =>
    createElement("pre", { "data-testid": "code-block" }, code),
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock("@/hooks/useWorkflowSubagentModelProviderName.js", () => ({
  useWorkflowSubagentModelProviderName: () => undefined,
}));

const VIEW = {
  revision: 1,
  providers: [
    {
      providerId: "zhipu",
      providerName: "Zhipu",
      config: { api: { type: "openai-chat-completions" } },
      models: [
        {
          modelId: "glm-5.3",
          config: { optionSpecs: { reasoningLevel: { values: [], map: "{}" } } },
        },
        {
          modelId: "glm-5.3-flash",
          config: { optionSpecs: { reasoningLevel: { values: ["low", "high"], map: "{}" } } },
        },
      ],
    },
  ],
};
const modelRead = vi.hoisted(() => ({
  state: { status: "ready", view: null as unknown } as { status: string; view?: unknown },
}));
vi.mock("@/hooks/useModelSelectionView.js", () => ({
  useModelSelectionView: () => ({ state: modelRead.state, reload: vi.fn() }),
}));

const capturedSelects = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@/ModelConfigSelect.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ModelConfigSelect.js")>();
  const react = await import("react");
  return {
    ...actual,
    ModelConfigSelect: (props: Record<string, unknown>) => {
      capturedSelects.push(props);
      return react.createElement(
        actual.ModelConfigSelect as unknown as (p: Record<string, unknown>) => ReactNode,
        props,
      );
    },
  };
});

const sendCommand = vi.hoisted(() => vi.fn());
vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({ sendCommand }),
}));

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import { PermissionDialog } from "@/PermissionDialog.js";
// eslint-disable-next-line import/first
import {
  isWorkflowSettingsCarrier,
  workflowAdjustedOptionDescriptionId,
} from "@/permissionWorkflowSettings.js";
// eslint-disable-next-line import/first
import {
  initialWorkflowAskSettingsDraft,
  workflowAskSettingsChangedLines,
  workflowAskSettingsContent,
} from "@/components/workflow-timeline/workflowAskSettings.js";
// eslint-disable-next-line import/first
import { encodeCustomModelValue } from "@/lib/cfCustomModelValue.js";
// eslint-disable-next-line import/first
import { V4InteractionDialogs } from "@/v4/V4InteractionDialogs.js";

const SCRIPT = 'const r = await agent("a").ask<string>("do");';
const ALLOW = { optionId: "allowOnce", kind: "allowOnce", name: "Allow" };
const SESSION = {
  optionId: "allowSession",
  kind: "allowAlways",
  name: "Always allow in this session",
};
const DENY = { optionId: "deny", kind: "deny", name: "Deny" };

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  modelRead.state = { status: "ready", view: VIEW };
  capturedSelects.length = 0;
  sendCommand.mockReset();
});

afterEach(() => {
  cleanup();
});

function workflowRequest(
  raw: Record<string, unknown>,
  overrides: Partial<CfPermissionRequest> = {},
): CfPermissionRequest {
  return {
    type: "permission_request",
    taskId: "task-1",
    traceId: "trace-1",
    requestId: "perm-1",
    description: "createWorkflow.runConfirmation",
    kind: "CreateWorkflow",
    title: "CreateWorkflow",
    options: [
      { ...ALLOW, response: { decision: "allow" } },
      { ...SESSION, response: { decision: "allow" } },
      { ...DENY, response: { decision: "deny" } },
    ],
    raw: { name: "Research", script: SCRIPT, ...raw },
    ...overrides,
  };
}

const ADJUSTABLE = { adjustable_settings: { subagent_model: true, concurrency_ceiling: 13 } };

function renderDialog(
  request: CfPermissionRequest,
  options: { locale?: "en-US" | "zh-CN"; responding?: boolean } = {},
) {
  const onRespond = vi.fn();
  const element = (next: CfPermissionRequest) =>
    createElement(
      CfIntlProvider,
      { initialLocale: options.locale ?? "en-US" },
      createElement(PermissionDialog, {
        request: next,
        onRespond,
        workspacePath: "/w",
        workflowSessionModel: { providerId: "zhipu", modelId: "glm-5.3" },
        ...(options.responding === undefined ? {} : { responding: options.responding }),
      }),
    );
  const view = render(element(request));
  return { onRespond, rerender: (next: CfPermissionRequest) => view.rerender(element(next)) };
}

function modelLine(): HTMLElement {
  return screen.getByTestId("workflow-permission-settings-model");
}
function boundLine(): HTMLElement {
  return screen.getByTestId("workflow-permission-settings-bound");
}
function boundValue(): HTMLInputElement {
  return screen.getByTestId<HTMLInputElement>("workflow-permission-settings-bound-value");
}
function option(name: string): HTMLElement {
  return screen.getByRole("option", { name });
}
function pickModel(value: string) {
  const onValueChange = capturedSelects.at(-1)?.onValueChange as (value: string) => void;
  act(() => onValueChange(value));
}

describe("纯规则：From点、应Answer content、改过的行", () => {
  it("From点读入参：缺席的ModelYesSessionModel，缺席的上BoundaryYesDefaultConcurrency，Default也Unknown即空", () => {
    expect(initialWorkflowAskSettingsDraft({}, 13)).toEqual({
      model: { kind: "session" },
      bound: 13,
    });
    expect(
      initialWorkflowAskSettingsDraft(
        { subagent_model: "zhipu/glm-5.3-flash$high", max_concurrency: 4 },
        13,
      ),
    ).toEqual({
      model: { kind: "model", providerId: "zhipu", modelId: "glm-5.3-flash", level: "high" },
      bound: 4,
    });
    expect(initialWorkflowAskSettingsDraft({}, undefined)).toEqual({
      model: { kind: "session" },
      bound: null,
    });
  });

  it("只发改过的Character段；上Boundary回到Default发 null，换回SessionModel发 null，只改Thinking档也算改了Model", () => {
    const initial = initialWorkflowAskSettingsDraft(
      { subagent_model: "zhipu/glm-5.3-flash$low", max_concurrency: 4 },
      13,
    );
    expect(workflowAskSettingsContent(initial, initial, 13)).toBeUndefined();
    expect(workflowAskSettingsContent(initial, { ...initial, bound: 13 }, 13)).toEqual({
      max_concurrency: null,
    });
    expect(workflowAskSettingsContent(initial, { ...initial, bound: 40 }, 13)).toEqual({
      max_concurrency: 40,
    });
    expect(
      workflowAskSettingsContent(initial, { ...initial, model: { kind: "session" } }, 13),
    ).toEqual({
      subagent_model: null,
    });
    const levelOnly = {
      ...initial,
      model: {
        kind: "model" as const,
        providerId: "zhipu",
        modelId: "glm-5.3-flash",
        level: "high",
      },
    };
    expect(workflowAskSettingsContent(initial, levelOnly, 13)).toEqual({
      subagent_model: "zhipu/glm-5.3-flash$high",
    });
    expect(workflowAskSettingsChangedLines(initial, levelOnly, 13)).toEqual({
      model: true,
      bound: false,
    });
  });

  it("只有放行的两项带Settings；改过Settings时换描述的也只有它们", () => {
    expect(isWorkflowSettingsCarrier({ ...ALLOW, response: { decision: "allow" } })).toBe(true);
    expect(isWorkflowSettingsCarrier({ ...SESSION, response: { decision: "allow" } })).toBe(true);
    expect(isWorkflowSettingsCarrier({ ...DENY, response: { decision: "deny" } })).toBe(false);
    expect(workflowAdjustedOptionDescriptionId("chat.permission.allowOnce.description")).toBe(
      "chat.permission.workflow.allowOnce.adjusted",
    );
    expect(
      workflowAdjustedOptionDescriptionId("chat.permission.workflow.allowForSession.description"),
    ).toBe("chat.permission.workflow.allowForSession.adjusted");
    expect(workflowAdjustedOptionDescriptionId("chat.permission.denyOnce.description")).toBe(
      "chat.permission.denyOnce.description",
    );
  });
});

describe("确认窗里的两句话", () => {
  it("没设过的调用也说出k会发生什么：Model在上（SessionModel徽Label），上Boundary在下（= Default），没有「原为」", () => {
    renderDialog(workflowRequest(ADJUSTABLE));
    const block = screen.getByTestId("workflow-permission-settings");
    expect(block.textContent?.indexOf("Subagents run on")).toBeLessThan(
      block.textContent?.indexOf("At most") ?? -1,
    );
    expect(modelLine().textContent).toContain("glm-5.3");
    expect(modelLine().textContent).toContain("session model");
    expect(boundValue().value).toBe("13");
    expect(boundLine().textContent).toContain("subagents at once");
    expect(boundLine().textContent).toContain("= default");
    expect(
      screen.getByTestId<HTMLButtonElement>("workflow-permission-settings-bound-increase").disabled,
    ).toBe(false);
    expect(screen.queryByTestId("workflow-permission-settings-model-was")).toBeNull();
    expect(screen.queryByTestId("workflow-permission-settings-bound-was")).toBeNull();
    expect(screen.queryByTestId("workflow-permission-max-concurrency")).toBeNull();
    expect(option("Allow").textContent).toContain("Allow only this time");
  });

  it("改上Boundary：那One行加粗并带「· was 13 ↺」，前两个选项换描述，Allow 带 content；↺ 放回去即不带", () => {
    const { onRespond } = renderDialog(workflowRequest(ADJUSTABLE));
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    expect(boundValue().value).toBe("11");
    expect(boundLine().getAttribute("data-changed")).toBe("true");
    expect(boundValue().className).toContain("font-medium");
    expect(boundLine().textContent).toContain("default 13");
    expect(screen.getByTestId("workflow-permission-settings-bound-was").textContent).toBe(
      "· was 13",
    );
    expect(option("Allow").textContent).toContain("Run once with the adjusted settings");
    expect(option("Always allow in this session").textContent).toContain(
      "later runs are not asked and carry their own",
    );

    fireEvent.click(option("Allow"));
    expect(onRespond).toHaveBeenLastCalledWith(
      "perm-1",
      expect.objectContaining({ optionId: "allowOnce" }),
      undefined,
      { max_concurrency: 11 },
    );

    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-reset"));
    expect(boundValue().value).toBe("13");
    expect(screen.queryByTestId("workflow-permission-settings-bound-was")).toBeNull();
    expect(option("Allow").textContent).toContain("Allow only this time");
    fireEvent.click(option("Allow"));
    expect(onRespond.mock.lastCall).toEqual([
      "perm-1",
      expect.objectContaining({ optionId: "allowOnce" }),
      undefined,
    ]);
  });

  it("换Model：content Yes规范串，「原为」说From点（SessionModel）；Session免确认同样带着这One次的Settings", () => {
    const { onRespond } = renderDialog(workflowRequest(ADJUSTABLE));
    pickModel(encodeCustomModelValue("zhipu", "glm-5.3-flash"));
    expect(modelLine().getAttribute("data-changed")).toBe("true");
    expect(screen.getByTestId("workflow-permission-settings-model-was").textContent).toBe(
      "· was Zhipu/glm-5.3 · session model",
    );

    fireEvent.click(option("Always allow in this session"));
    fireEvent.click(option("Always allow in this session"));
    const content = onRespond.mock.lastCall?.[3] as { subagent_model?: string };
    expect(onRespond.mock.lastCall?.[1]).toMatchObject({ optionId: "allowSession" });
    expect(content.subagent_model?.startsWith("zhipu/glm-5.3-flash")).toBe(true);
    expect(Object.keys(content)).toEqual(["subagent_model"]);
  });

  it("所选Model有Thinking档：Model芯片旁边出现Thinking档芯片；没有档位的Model没有它", () => {
    renderDialog(workflowRequest(ADJUSTABLE));
    expect(screen.queryByTestId(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER)).toBeNull();
    pickModel(encodeCustomModelValue("zhipu", "glm-5.3-flash"));
    expect(screen.getByTestId(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER)).toBeTruthy();
  });

  it("Deny不带Settings：改过之后点 Deny 也只Yes普通Deny", () => {
    const { onRespond } = renderDialog(workflowRequest(ADJUSTABLE));
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    fireEvent.click(option("Deny"));
    fireEvent.click(option("Deny"));
    expect(onRespond.mock.lastCall).toEqual([
      "perm-1",
      expect.objectContaining({ optionId: "deny" }),
      undefined,
    ]);
  });

  it("入参里的Model已不在清单：「Unavailable」徽Label，Allow 与确认键等User换One个，Deny 照常", async () => {
    const { onRespond } = renderDialog(
      workflowRequest({ ...ADJUSTABLE, subagent_model: "gone/model-x" }),
    );
    expect(screen.getByTestId("workflow-permission-settings-model-unavailable").textContent).toBe(
      "unavailable",
    );
    await waitFor(() => expect(option("Allow").getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(option("Allow"));
    expect(onRespond).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Confirm" }).disabled).toBe(true);

    pickModel(encodeCustomModelValue("zhipu", "glm-5.3"));
    await waitFor(() => expect(option("Allow").getAttribute("aria-disabled")).toBeNull());
    fireEvent.click(option("Allow"));
    expect(onRespond.mock.lastCall?.[3]).toEqual({ subagent_model: "zhipu/glm-5.3" });
  });

  it("agent 没有ModelTable of Contents：Model那One行YesOne句话，上Boundary照样可调", () => {
    const { onRespond } = renderDialog(
      workflowRequest({ adjustable_settings: { subagent_model: false, concurrency_ceiling: 8 } }),
    );
    expect(modelLine().textContent).toBe(
      "Subagents stay on the session model· this agent has no model catalog",
    );
    expect(screen.queryByTestId("workflow-permission-settings-model-trigger")).toBeNull();
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    fireEvent.click(option("Allow"));
    expect(onRespond.mock.lastCall?.[3]).toEqual({ max_concurrency: 7 });
  });

  it("选不了Model、入参却带着One个（沿用来的）：照实说它，不说「沿用SessionModel」", () => {
    renderDialog(
      workflowRequest({
        adjustable_settings: { subagent_model: false, concurrency_ceiling: 8 },
        subagent_model: "zhipu/glm-5.3-flash",
      }),
    );
    expect(modelLine().textContent).toBe("Subagents run on Zhipu/glm-5.3-flash");
  });

  it("天花板Unknown、调用也没设上Boundary：步进器留空，句尾「不设上限」；敲One个Count就成了调整", () => {
    const { onRespond } = renderDialog(
      workflowRequest({ adjustable_settings: { subagent_model: true } }),
    );
    expect(boundValue().value).toBe("");
    expect(screen.getByTestId("workflow-permission-settings-bound-tail").textContent).toBe(
      "· no limit of its own",
    );
    fireEvent.change(boundValue(), { target: { value: "5" } });
    expect(screen.queryByTestId("workflow-permission-settings-bound-tail")).toBeNull();
    fireEvent.click(option("Allow"));
    expect(onRespond.mock.lastCall?.[3]).toEqual({ max_concurrency: 5 });
  });

  it("应Answer在途：控件与选项OneFrom禁用", () => {
    renderDialog(workflowRequest(ADJUSTABLE), { responding: true });
    expect(boundValue().disabled).toBe(true);
    expect(
      screen.getByTestId<HTMLButtonElement>("workflow-permission-settings-bound-decrease").disabled,
    ).toBe(true);
    expect(
      screen.getByTestId<HTMLButtonElement>("workflow-permission-settings-model-trigger").disabled,
    ).toBe(true);
  });

  it("zh-CN：两句与「原为」", () => {
    renderDialog(workflowRequest(ADJUSTABLE), { locale: "zh-CN" });
    expect(modelLine().textContent).toContain("Sub-agentRun在");
    expect(boundLine().textContent).toContain("最多");
    expect(boundLine().textContent).toContain("个Sub-agent同时Run");
    expect(boundLine().textContent).toContain("= Default");
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    expect(boundLine().textContent).toContain("默认 13");
    expect(screen.getByTestId("workflow-permission-settings-bound-was").textContent).toBe(
      "· 原为 13",
    );
    expect(
      screen.getByTestId("workflow-permission-settings-bound-reset").getAttribute("title"),
    ).toBe("恢复原Value");
    expect(option("允许").textContent).toContain("按调整后的SettingsRunOne次");
  });

  it("换Request：Settings回到New入参的From点，上One个窗的改动不带进下One个", () => {
    const { onRespond, rerender } = renderDialog(workflowRequest(ADJUSTABLE));
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    rerender(workflowRequest(ADJUSTABLE, { requestId: "perm-2" }));
    expect(boundValue().value).toBe("13");
    expect(option("Allow").textContent).toContain("Allow only this time");
    fireEvent.click(option("Allow"));
    expect(onRespond.mock.lastCall).toEqual([
      "perm-2",
      expect.objectContaining({ optionId: "allowOnce" }),
      undefined,
    ]);
  });
});

describe("脚本点名了Model", () => {
  const BINDINGS = {
    model_bindings: { "GLM-5.3-Flash": "zhipu/glm-5.3-flash$low", judge: "zhipu/glm-5.3" },
  };

  it("不逐名列出，Model那One句说「Default」；只有One个Model菜单", () => {
    renderDialog(workflowRequest({ ...ADJUSTABLE, ...BINDINGS }));
    const text = screen.getByTestId("workflow-permission-settings").textContent ?? "";
    expect(modelLine().textContent).toContain("By default, subagents run on");
    expect(text).not.toContain("judge");
    expect(text).not.toContain("glm-5.3-flash");
    expect(screen.getAllByTestId("workflow-permission-settings-model-trigger")).toHaveLength(1);
  });

  it("改Settings后 Allow 只带那两项，不带 model_bindings", () => {
    const { onRespond } = renderDialog(workflowRequest({ ...ADJUSTABLE, ...BINDINGS }));
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    fireEvent.click(option("Allow"));
    expect(onRespond.mock.lastCall?.[3]).toEqual({ max_concurrency: 12 });
  });

  it("没点名Model的脚本照Old说「Sub-agentRun在」", () => {
    renderDialog(workflowRequest({ ...ADJUSTABLE, model_bindings: {} }));
    expect(modelLine().textContent).toContain("Subagents run on");
    expect(modelLine().textContent).not.toContain("By default");
  });

  it("选不了Model：「Sub-agentDefault沿用SessionModel」", () => {
    renderDialog(
      workflowRequest({
        adjustable_settings: { subagent_model: false, concurrency_ceiling: 8 },
        ...BINDINGS,
      }),
    );
    expect(modelLine().textContent).toBe(
      "By default, subagents stay on the session model· this agent has no model catalog",
    );
  });

  it("zh-CN：「Sub-agentDefaultRun在」", () => {
    renderDialog(workflowRequest({ ...ADJUSTABLE, ...BINDINGS }), { locale: "zh-CN" });
    expect(modelLine().textContent).toContain("Sub-agentDefaultRun在");
  });

  it("Old agent（Plain text）：同样不列名Character，Model那One句说「Default」", () => {
    renderDialog(
      workflowRequest({ max_concurrency: 2, subagent_model: "zhipu/glm-5.3", ...BINDINGS }),
    );
    expect(screen.getByTestId("workflow-permission-subagent-model").textContent).toBe(
      "By default, subagents run on glm-5.3",
    );
    const blockText =
      document.querySelector('[data-workflow-permission-block="true"]')?.textContent ?? "";
    expect(blockText).not.toContain("judge");
  });
});

describe("键盘", () => {
  it("第One个选项上的 Shift+Tab 离开list、落到Settings块的最后One个控件；其余选项上照Old在list里循环", async () => {
    renderDialog(workflowRequest(ADJUSTABLE));
    const allow = option("Allow");
    allow.focus();
    fireEvent.keyDown(allow, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByTestId("workflow-permission-settings-bound-increase"),
    );

    const session = option("Always allow in this session");
    session.focus();
    fireEvent.keyDown(session, { key: "Tab", shiftKey: true });
    await waitFor(() => expect(document.activeElement).toBe(option("Allow")));
  });

  it("在CountCharacter框里敲的键留在CountCharacter框：选项的CountCharacter快捷键不生效", () => {
    const { onRespond } = renderDialog(workflowRequest(ADJUSTABLE));
    fireEvent.keyDown(boundValue(), { key: "1" });
    fireEvent.keyDown(boundValue(), { key: "Enter" });
    expect(onRespond).not.toHaveBeenCalled();
  });
});

describe("Old agent（入参没有 adjustable_settings）", () => {
  it("只画调用设了的Character段，Plain text，Model在上、上Boundary在下；没有控件", () => {
    renderDialog(workflowRequest({ max_concurrency: 2, subagent_model: "zhipu/glm-5.3-flash" }));
    expect(screen.queryByTestId("workflow-permission-settings")).toBeNull();
    const blockText =
      document.querySelector('[data-workflow-permission-block="true"]')?.textContent ?? "";
    expect(blockText.indexOf("Subagents run on glm-5.3-flash")).toBeLessThan(
      blockText.indexOf("At most 2 subagents at once"),
    );
  });
});

describe("V4 宿主", () => {
  it("把改过的Settings放进 resolveInteraction.answer.content", async () => {
    sendCommand.mockResolvedValue({ status: "accepted", commandId: "c", revisionAtDecision: 0 });
    const snapshot = {
      sessionId: "sess-1",
      config: { provider: "zhipu", model: "glm-5.3" },
      pendingInteractions: [
        {
          interactionId: "ask-1",
          kind: "permission",
          anchorRowId: 3,
          createdAt: 1,
          payload: {
            kind: "permission",
            toolName: "CreateWorkflow",
            toolCallId: "tool-1",
            summary: "createWorkflow.runConfirmation",
            options: [
              { optionId: "allowOnce", kind: "allowOnce", label: "Allow" },
              { optionId: "deny", kind: "deny", label: "Deny" },
            ],
            detail: { name: "Research", script: SCRIPT, ...ADJUSTABLE },
          },
        },
      ],
    } as unknown as ConversationSnapshot;
    render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(V4InteractionDialogs, {
          sessionId: "sess-1",
          workspacePath: "/w",
          snapshot,
        }),
      ),
    );
    fireEvent.click(screen.getByTestId("workflow-permission-settings-bound-decrease"));
    fireEvent.click(option("Allow"));
    await waitFor(() => expect(sendCommand).toHaveBeenCalled());
    const envelope = sendCommand.mock.calls
      .map(([sent]) => sent as { type: string; payload: { answer?: unknown } })
      .find((sent) => sent.type === "resolveInteraction");
    expect(envelope?.payload.answer).toEqual({
      optionId: "allowOnce",
      content: { max_concurrency: 12 },
    });
  });
});
