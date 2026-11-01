// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, createRef, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER } from "@origin-ai/cf-shared/test-ids";
import type { CommandAck, WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowRunCardSummary } from "@/ToolCallBlocks/shared.js";

vi.mock("@/logger.js", () => ({ logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
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

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import {
  WorkflowRunSettingsPopover,
  type WorkflowRunSettingsHost,
} from "@/components/workflow-timeline/WorkflowRunSettingsPopover.js";
// eslint-disable-next-line import/first
import { WorkflowRunDigest } from "@/components/workflow-timeline/WorkflowRunDigest.js";
// eslint-disable-next-line import/first
import { ConversationWorkflowDigests } from "@/v4/ConversationWorkflowDigests.js";
// eslint-disable-next-line import/first
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  modelRead.state = { status: "ready", view: VIEW };
});

afterEach(() => {
  cleanup();
});

function runState(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "run-a",
    toolCallId: "tool-a",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
    concurrencyCeiling: 13,
    ...overrides,
  };
}

function hostWith(apply: (change: unknown) => Promise<CommandAck>): WorkflowRunSettingsHost {
  return {
    workspacePath: "/w",
    sessionModel: { providerId: "zhipu", modelId: "glm-5.3" },
    apply: apply as WorkflowRunSettingsHost["apply"],
  };
}

function renderPopover(
  run: WorkflowRunState,
  options: {
    locale?: "en-US" | "zh-CN";
    apply?: (change: unknown) => Promise<CommandAck>;
    onAccepted?: (accepted: unknown) => void;
    onOpenChange?: (open: boolean) => void;
  } = {},
) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const anchorRef = createRef<HTMLElement | null>() as { current: HTMLElement | null };
  anchorRef.current = anchor;
  const apply = options.apply ?? vi.fn(async () => ({ status: "accepted" }) as CommandAck);
  return {
    apply,
    view: render(
      createElement(
        CfIntlProvider,
        { initialLocale: options.locale ?? "en-US" },
        createElement(WorkflowRunSettingsPopover, {
          anchorRef,
          host: hostWith(apply),
          onOpenChange: options.onOpenChange ?? vi.fn(),
          open: true,
          run,
          ...(options.onAccepted === undefined ? {} : { onAccepted: options.onAccepted }),
        }),
      ),
    ),
  };
}

describe("WorkflowRunSettingsPopover Character段", () => {
  it("From点Yes run 自己的Settings：Model名、DefaultConcurrencyNotice；什么都没改时没有后果句、Apply 禁用", () => {
    renderPopover(
      runState({
        subagentModel: "zhipu/glm-5.3",
        concurrency: { cap: 13, ceiling: 13, limit: 4 },
      }),
    );
    expect(screen.getByText("Configure workflow")).toBeTruthy();
    expect(screen.getByTestId("workflow-run-settings-model-trigger").textContent).toContain(
      "glm-5.3",
    );
    expect(screen.getByTestId<HTMLInputElement>("workflow-run-settings-bound-value").value).toBe(
      "4",
    );
    expect(screen.getByTestId("workflow-run-settings-bound").textContent).toContain("default 13");
    expect(screen.getByTestId("workflow-run-settings-consequence").textContent).toBe("");
    expect(screen.getByTestId<HTMLButtonElement>("workflow-run-settings-apply").disabled).toBe(
      true,
    );
    expect(screen.queryByTestId(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER)).toBeNull();
  });

  it("后果句跟着改动走：在Run的 run 只改Concurrency念「就地生效」，改回原Value又空下来", () => {
    renderPopover(
      runState({
        subagentModel: "zhipu/glm-5.3",
        concurrency: { cap: 13, ceiling: 13, limit: 4 },
      }),
    );
    const consequence = () => screen.getByTestId("workflow-run-settings-consequence").textContent;
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-decrease"));
    expect(consequence()).toBe("Applies to this run right away; no new run is started.");
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-increase"));
    expect(consequence()).toBe("");
    expect(screen.getByTestId<HTMLButtonElement>("workflow-run-settings-apply").disabled).toBe(
      true,
    );
  });

  it("zh-CN：Run在SessionModel上、上限在Default——触发器带「SessionModel」徽Label，Notice念「= Default」，加Number仍可按", () => {
    renderPopover(runState({ status: "stopped", stopReason: "user", resumable: true }), {
      locale: "zh-CN",
    });
    expect(screen.getByText("ConfigurationWorkflow")).toBeTruthy();
    expect(screen.getByTestId("workflow-run-settings-model-badge").textContent).toBe("SessionModel");
    expect(screen.getByTestId("workflow-run-settings-bound").textContent).toContain("= Default");
    expect(
      screen.getByTestId<HTMLButtonElement>("workflow-run-settings-bound-increase").disabled,
    ).toBe(false);
    expect(screen.getByTestId("workflow-run-settings-consequence").textContent).toBe("");
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-increase"));
    expect(screen.getByTestId("workflow-run-settings-consequence").textContent).toBe(
      "k以NewSettings另FromOne次Run接着Run，Completed的Steps会Retain。",
    );
  });

  it("有Thinking档的Model：触发器旁边出现Thinking档控件", () => {
    renderPopover(runState({ subagentModel: "zhipu/glm-5.3-flash$low" }));
    expect(screen.getByTestId(TID_CHAT_THOUGHT_LEVEL_SELECT_TRIGGER)).toBeTruthy();
  });

  it("run 的Model已不在清单里：「Unavailable」徽Label，改了别的也不能 Apply（agent 只会回 model_unavailable）", () => {
    renderPopover(runState({ subagentModel: "gone/model-x" }));
    expect(screen.getByTestId("workflow-run-settings-model-badge").textContent).toBe("unavailable");
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-decrease"));
    expect(screen.getByTestId<HTMLButtonElement>("workflow-run-settings-apply").disabled).toBe(
      true,
    );
  });

  it("agent 没有ModelTable of Contents：Model那One格换成One句话，上限仍可调", () => {
    modelRead.state = { status: "ready", view: { revision: 1, providers: [] } };
    renderPopover(runState());
    expect(screen.getByTestId("workflow-run-settings-model").textContent).toContain(
      "This agent has no model catalog; subagents stay on the session model.",
    );
    expect(screen.getByTestId("workflow-run-settings-bound-decrease")).toBeTruthy();
  });

  it("Default unknown（老 CLI）：没有DefaultNotice，CountCharacter可以直接敲", () => {
    renderPopover(runState({ concurrencyCeiling: undefined, concurrency: undefined }));
    const input = screen.getByTestId<HTMLInputElement>("workflow-run-settings-bound-value");
    expect(input.value).toBe("");
    expect(screen.getByTestId("workflow-run-settings-bound").textContent).not.toContain("default");
    fireEvent.change(input, { target: { value: "5" } });
    expect(input.value).toBe("5");
    expect(screen.getByTestId<HTMLButtonElement>("workflow-run-settings-apply").disabled).toBe(
      false,
    );
  });
});

describe("WorkflowRunSettingsPopover Apply", () => {
  it("只发改过的那One项；被接受即关、把New run 的两把钥匙交出去", async () => {
    const onAccepted = vi.fn();
    const onOpenChange = vi.fn();
    const { apply } = renderPopover(
      runState({ subagentModel: "zhipu/glm-5.3", concurrency: { cap: 13, ceiling: 13, limit: 4 } }),
      {
        apply: vi.fn(
          async () =>
            ({
              status: "accepted",
              commandId: "c",
              revisionAtDecision: 0,
              result: {
                type: "amendWorkflowRunSettings",
                runId: "run-b",
                toolCallId: "settings-1",
                supersededRunId: "run-a",
              },
            }) as CommandAck,
        ),
        onAccepted,
        onOpenChange,
      },
    );
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-decrease"));
    fireEvent.click(screen.getByTestId("workflow-run-settings-apply"));
    expect(apply).toHaveBeenCalledWith({ maxConcurrency: 3 });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onAccepted).toHaveBeenCalledWith({ runId: "run-b", toolCallId: "settings-1" });
  });

  it("从Default往上加：发出的Yes那个Count，不Yes null（DefaultYesFrom点不Yes天花板）", async () => {
    const { apply } = renderPopover(runState(), {
      apply: vi.fn(
        async () =>
          ({
            status: "accepted",
            commandId: "c",
            revisionAtDecision: 0,
            result: { type: "amendWorkflowRunSettings", runId: "run-a", toolCallId: "settings-2" },
          }) as CommandAck,
      ),
    });
    expect(screen.getByTestId<HTMLInputElement>("workflow-run-settings-bound-value").value).toBe(
      "13",
    );
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-increase"));
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-increase"));
    expect(screen.getByTestId("workflow-run-settings-bound").textContent).toContain("default 13");
    await act(async () => {
      fireEvent.click(screen.getByTestId("workflow-run-settings-apply"));
    });
    expect(apply).toHaveBeenCalledWith({ maxConcurrency: 15 });
  });

  it("被拒：弹层不关，原因One行 + Diagnostics等宽块，Apply 重New可点；再改One个Character段那One行就Collapse", async () => {
    const onOpenChange = vi.fn();
    renderPopover(runState({ concurrency: { cap: 13, ceiling: 13, limit: 4 } }), {
      apply: vi.fn(
        async () =>
          ({
            status: "rejected",
            commandId: "c",
            revisionAtDecision: 0,
            reasonCode: "fault.command.workflowRunSettingsRejected.compile_failed",
            message: "L3:C1 Property 'ask' does not exist",
          }) as CommandAck,
      ),
      onOpenChange,
    });
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-increase"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("workflow-run-settings-apply"));
    });
    const rejection = await screen.findByTestId("workflow-run-settings-rejection");
    expect(rejection.textContent).toContain("no longer compiles");
    expect(rejection.querySelector("pre")?.textContent).toBe("L3:C1 Property 'ask' does not exist");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId<HTMLButtonElement>("workflow-run-settings-apply").disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-increase"));
    expect(screen.queryByTestId("workflow-run-settings-rejection")).toBeNull();
  });

  it("zh-CN 的Deny词：Capabilities缺席", async () => {
    renderPopover(runState({ concurrency: { cap: 13, ceiling: 13, limit: 4 } }), {
      locale: "zh-CN",
      apply: vi.fn(
        async () =>
          ({
            status: "rejected",
            commandId: "c",
            revisionAtDecision: 0,
            reasonCode: "fault.command.capabilityUnsupported",
          }) as CommandAck,
      ),
    });
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-increase"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("workflow-run-settings-apply"));
    });
    expect((await screen.findByTestId("workflow-run-settings-rejection")).textContent).toBe(
      "Current agent 不支持从这里调整Workflow Settings。",
    );
  });
});

function summaryOf(run: WorkflowRunState): WorkflowRunCardSummary {
  return {
    runId: run.runId,
    toolCallId: run.toolCallId,
    status: run.status,
    ...(run.stopReason === undefined ? {} : { stopReason: run.stopReason }),
    nodesSettled: 0,
    nodesTotal: 0,
    run,
    ...(run.resumable === true ? { resumable: true as const } : {}),
  };
}

describe("run 卡上的 Configure", () => {
  function renderCard(run: WorkflowRunState, withHost: boolean) {
    return render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkflowRunDigest, {
          graph: undefined,
          name: "implement-verify",
          runId: run.runId,
          summary: summaryOf(run),
          testIdKey: "t",
          onCancel: vi.fn(),
          onResume: vi.fn(),
          onOpenRun: vi.fn(),
          ...(withHost ? { settingsHost: hostWith(vi.fn()) } : {}),
        }),
      ),
    );
  }

  it("在 Stop 之前；点它打开弹层，aria-expanded 跟着翻", () => {
    const view = renderCard(runState(), true);
    const configure = view.getByTestId("workflow-digest-configure");
    const cancel = view.getByTestId("workflow-digest-cancel");
    expect(
      configure.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(configure.getAttribute("aria-label")).toBe("Configure workflow");
    fireEvent.click(configure);
    expect(configure.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("workflow-run-settings-popover")).toBeTruthy();
  });

  it("点弹层里的空白后弹层仍保持打开", () => {
    const view = renderCard(runState(), true);
    fireEvent.click(view.getByTestId("workflow-digest-configure"));
    fireEvent.click(screen.getByTestId("workflow-run-settings-consequence"));
    expect(screen.getByTestId("workflow-run-settings-popover")).toBeTruthy();
  });

  it("宿主没To（只读、灰度关、run 不能Configuration）就没有这枚钮", () => {
    const view = renderCard(runState(), false);
    expect(view.queryByTestId("workflow-digest-configure")).toBeNull();
  });

  function renderDigests(
    run: WorkflowRunState,
    settings?: unknown,
    extra: Record<string, unknown> = {},
  ) {
    const onAmendWorkflowRunSettings = vi.fn(async () => ({ status: "accepted" }) as CommandAck);
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(ConversationWorkflowDigests, {
          turnKey: "t",
          digests: [
            {
              key: "k",
              toolCallId: run.toolCallId ?? "tool-a",
              runId: run.runId,
              name: "implement-verify",
              graph: undefined,
              summary: summaryOf(run),
              ...(settings === undefined ? {} : { settings }),
              ...extra,
            } as never,
          ],
          context: {
            sessionId: "parent-a",
            workspacePath: "/w",
            onAmendWorkflowRunSettings,
          } as unknown as ConversationRowRenderContext,
        }),
      ),
    );
    return { view, onAmendWorkflowRunSettings };
  }

  it.each([
    ["running", runState(), true],
    ["errored", runState({ status: "errored" }), true],
    ["completed", runState({ status: "completed" }), false],
    [
      "superseded",
      runState({ status: "stopped", stopReason: "superseded", supersededBy: "run-b" }),
      false,
    ],
  ] as const)("接线层按 run Status门控：%s", (_case, run, shown) => {
    const { view } = renderDigests(run);
    expect(view.queryByTestId("workflow-digest-configure") !== null).toBe(shown);
  });

  it("Apply 走宿主的 onAmendWorkflowRunSettings，带上这张卡的 runId", async () => {
    const { view, onAmendWorkflowRunSettings } = renderDigests(
      runState({ concurrency: { cap: 13, ceiling: 13, limit: 4 } }),
    );
    fireEvent.click(view.getByTestId("workflow-digest-configure"));
    fireEvent.click(screen.getByTestId("workflow-run-settings-bound-decrease"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("workflow-run-settings-apply"));
    });
    expect(onAmendWorkflowRunSettings).toHaveBeenCalledWith("run-a", { maxConcurrency: 3 });
  });

  it("Settings轮：卡上方One行「已调整Settings · …」，普通卡没有", () => {
    const { view } = renderDigests(runState({ runId: "run-b", toolCallId: "settings-1" }), {
      amend: {
        predecessorRunId: "run-a",
        subagentModel: { to: "zhipu/glm-5.3-flash" },
        maxConcurrency: { from: 13, to: 4 },
        ceiling: 13,
      },
    });
    const row = view.getByTestId("workflow-settings-change-row");
    expect(row.textContent).toContain("已调整Settings");
    expect(row.textContent).toContain("Sub-agent改用 glm-5.3-flash");
    expect(row.textContent).toContain("最多 4 个同时Run");
    cleanup();
    const plain = renderDigests(runState());
    expect(plain.view.queryByTestId("workflow-settings-change-row")).toBeNull();
  });

  it("就地生效的Settings轮：只有那One行，没有卡", () => {
    const { view } = renderDigests(
      runState({ concurrency: { cap: 13, ceiling: 13, limit: 4 } }),
      { amend: { maxConcurrency: { from: 13, to: 4 }, ceiling: 13 } },
      { rowOnly: true },
    );
    const row = view.getByTestId("workflow-settings-change-row");
    expect(row.textContent).toContain("已调整Settings");
    expect(row.textContent).toContain("最多 4 个同时Run");
    expect(view.queryByTestId("workflow-digest-configure")).toBeNull();
    expect(view.queryByTestId("workflow-digest-cancel")).toBeNull();
    expect(view.container.querySelector('[data-testid^="workflow-run-digest-"]')).toBeNull();
  });
});
