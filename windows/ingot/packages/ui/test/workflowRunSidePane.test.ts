// @vitest-environment jsdom

//
//
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TID_WORKFLOW_ARTIFACTS_SECTION, TID_WORKFLOW_ARTIFACT_CARD } from "@origin-ai/cf-shared";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowRunSidePaneTab } from "@/lib/workspaceSidePane.js";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

const tooltips = vi.hoisted(() => ({
  calls: [] as Array<{ title: unknown; description?: string }>,
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({
    children,
    title,
    description,
  }: {
    children?: ReactNode;
    title?: unknown;
    description?: string;
  }) => {
    tooltips.calls.push({ title, ...(description === undefined ? {} : { description }) });
    return children;
  },
}));

const sendCommand = vi.fn(async () => ({ status: "accepted" }) as never);
const release = vi.fn();
const layer = { acquire: vi.fn(() => ({ release })) };
const workflowRunsQuery = vi.fn<() => Promise<{ runs: unknown[] }>>(async () => ({ runs: [] }));
const workflowRunArtifactsQuery = vi.fn<() => Promise<{ artifacts: unknown[] }>>(async () => ({
  artifacts: [],
}));
const workflowRunArtifactDataQuery = vi.fn<() => Promise<{ items: unknown[]; hasMore: boolean }>>(
  async () => ({ items: [], hasMore: false }),
);
const conversation = {
  layer,
  sendCommand,
  workflowRuns: workflowRunsQuery,
  workflowRunArtifacts: workflowRunArtifactsQuery,
  workflowRunArtifactData: workflowRunArtifactDataQuery,
};

vi.mock("@/v4/V4ConversationContext.js", () => ({
  V4PaneConversationProvider: ({ children }: { children: ReactNode }) => children,
  useV4Conversation: () => conversation,
}));

let snapshot: unknown = null;
vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => ({ snapshot }),
}));

vi.mock("@/hooks/useModelSelectionView.js", () => ({
  useModelSelectionView: () => ({
    state: { status: "ready", view: { revision: 1, providers: [] } },
    reload: vi.fn(),
  }),
}));

import { CfIntlProvider } from "@/i18n/IntlProvider.js";
// eslint-disable-next-line import/first
import { WorkflowRunSidePane } from "@/app-shell/WorkflowRunSidePane.js";
// eslint-disable-next-line import/first
import { useDynamicWorkflowAvailabilityStore } from "@/store/dynamicWorkflowAvailabilityStore.js";

function setDynamicWorkflowEnabled(enabled: boolean): void {
  useDynamicWorkflowAvailabilityStore.setState({
    status: "ready",
    enabled,
    config: { mode: enabled ? "alwaysOn" : "disabled", enabled, source: "remote" },
  });
}

const tab: WorkflowRunSidePaneTab = {
  id: "workflow-run:%2Fworkspace:parent-a:dwfrun-1",
  type: "workflow-run",
  workspaceKey: "/workspace",
  workspacePath: "/workspace",
  parentSessionId: "parent-a",
  toolCallId: "tool-wf-1",
  runId: "dwfrun-1",
  workflowName: "Fan-out review",
};

interface GraphStep {
  id: string;
  kind: "ask" | "world-read";
  label: string;
  lane: string;
  line?: number;
  phase?: string;
}

const STEPS: GraphStep[] = [
  {
    id: "ask#1",
    kind: "ask",
    label: "plan",
    lane: "actor#1",
    line: 4,
  },
  {
    id: "world-read#1",
    kind: "world-read",
    label: "read files",
    lane: "workspace",
  },
  {
    id: "ask#2",
    kind: "ask",
    label: "review",
    lane: "actor#2",
  },
  {
    id: "ask#3",
    kind: "ask",
    label: "audit",
    lane: "actor#3",
  },
];

const LANES = [
  { id: "actor#1", name: "planner" },
  { id: "actor#2" },
  { id: "actor#3" },
  { id: "workspace" },
];

function participantsOf(steps: readonly GraphStep[]) {
  const byId = new Map<string, { id: string; phase: string; lane: string; steps: string[] }>();
  for (const step of steps) {
    const phase = step.phase ?? "unphased";
    const id = `${phase}:${step.lane}`;
    const existing = byId.get(id);
    if (existing) existing.steps.push(step.id);
    else byId.set(id, { id, lane: step.lane, phase, steps: [step.id] });
  }
  return [...byId.values()];
}

const graphRow = {
  kind: "toolCall" as const,
  rowId: "row-1",
  toolCallId: "tool-wf-1",
  toolName: "CreateWorkflow",
  status: "success" as const,
  inputText: "",
  display: {
    kind: "create_workflow" as const,
    ok: true,
    errorCount: 0,
    diagnostics: [],
    causalityGraph: {
      steps: STEPS,
      lanes: LANES,
      participants: participantsOf(STEPS),
      handoffs: [],
    },
  },
};

const PHASES = [
  { id: "phase#a", name: "plan", line: 3 },
  { id: "phase#b", name: "review", line: 9 },
];
const PHASE_OF: Record<string, string> = {
  "ask#1": "phase#a",
  "ask#2": "phase#b",
  "ask#3": "phase#b",
  "world-read#1": "phase#a",
};

function run(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "dwfrun-1",
    toolCallId: "tool-wf-1",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
    ...overrides,
  };
}

function setSnapshot(
  options: {
    run?: WorkflowRunState;
    withGraphRow?: boolean;
    
    phased?: boolean;
  } = {},
) {
  const phasedSteps = STEPS.map((step) => ({ ...step, phase: PHASE_OF[step.id]! }));
  const causalityGraph =
    options.phased === true
      ? {
          ...graphRow.display.causalityGraph,
          participants: participantsOf(phasedSteps),
          phases: PHASES,
          phaseEdges: [{ from: "phase#a", to: "phase#b" }],
          steps: phasedSteps,
        }
      : graphRow.display.causalityGraph;
  const row = { ...graphRow, display: { ...graphRow.display, causalityGraph } };
  snapshot = {
    rows: { window: options.withGraphRow === false ? [] : [row] },
    ...(options.run ? { workflowRuns: { revision: 1, runs: [options.run] } } : {}),
  };
}

const onOpenWorkflowActorSession = vi.fn();
const onOpenWorkflowArtifact = vi.fn();
const onOpenWorkflowWorkspace = vi.fn();
const onOpenWorkflowRun = vi.fn();

function renderPane(
  locale: "en-US" | "zh-CN" = "en-US",
  options: {
    withActorCallback?: boolean;
    withArtifactCallback?: boolean;
    withWorkspaceCallback?: boolean;
    
    withOpenRunCallback?: boolean;
  } = {},
) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowRunSidePane, {
        tab,
        ...(options.withActorCallback === false ? {} : { onOpenWorkflowActorSession }),
        ...(options.withArtifactCallback === false ? {} : { onOpenWorkflowArtifact }),
        ...(options.withWorkspaceCallback === false ? {} : { onOpenWorkflowWorkspace }),
        ...(options.withOpenRunCallback === true ? { onOpenWorkflowRun } : {}),
      }),
    ),
  );
}

type Pane = ReturnType<typeof renderPane>;

function rerenderPane(view: Pane, locale: "en-US" | "zh-CN" = "en-US"): Pane {
  view.rerender(
    createElement(
      CfIntlProvider,
      { initialLocale: locale },
      createElement(WorkflowRunSidePane, { tab: { ...tab }, onOpenWorkflowActorSession }),
    ),
  );
  return view;
}

beforeEach(() => {
  cleanup();
  sendCommand.mockClear();
  workflowRunsQuery.mockClear();
  workflowRunsQuery.mockImplementation(async () => ({ runs: [] }));
  workflowRunArtifactsQuery.mockClear();
  workflowRunArtifactsQuery.mockImplementation(async () => ({ artifacts: [] }));
  workflowRunArtifactDataQuery.mockClear();
  workflowRunArtifactDataQuery.mockImplementation(async () => ({ items: [], hasMore: false }));
  onOpenWorkflowActorSession.mockClear();
  onOpenWorkflowArtifact.mockClear();
  onOpenWorkflowWorkspace.mockClear();
  setDynamicWorkflowEnabled(true);
  setSnapshot({ run: run() });
});

describe("WorkflowRunSidePane Status头与Phase清单", () => {
  it("Phase清单按声明序One节OnePhase，Running的Phase自己展开", () => {
    setSnapshot({
      run: run({ nodes: [{ siteId: "ask#2", ordinal: 1, phase: "executing" }] }),
      phased: true,
    });
    const view = renderPane();

    const phases = view.getAllByTestId("workflow-run-phase");
    expect(phases.map((phase) => phase.getAttribute("data-phase-id"))).toEqual([
      "phase#a",
      "phase#b",
    ]);
    expect(phases.map((phase) => phase.textContent)).toEqual([
      expect.stringContaining("plan"),
      expect.stringContaining("review"),
    ]);
    expect(phases[1]!.getAttribute("data-phase-status")).toBe("running");
    expect(phases[1]!.getAttribute("data-phase-open")).toBe("true");
    expect(phases[0]!.getAttribute("data-phase-status")).toBe("pending");
    expect(phases[0]!.getAttribute("data-phase-open")).toBe("false");
  });

  it("RunPhase变化时把New的那One节打开，已展开的不动", () => {
    setSnapshot({
      run: run({ nodes: [{ siteId: "ask#1", ordinal: 1, phase: "executing" }] }),
      phased: true,
    });
    const view = renderPane();
    expect(view.getAllByTestId("workflow-run-phase")[0]!.getAttribute("data-phase-open")).toBe(
      "true",
    );

    setSnapshot({
      run: run({
        nodes: [
          { siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" },
          { siteId: "world-read#1", ordinal: 1, phase: "settled", outcome: "ok" },
          { siteId: "ask#2", ordinal: 1, phase: "executing" },
        ],
      }),
      phased: true,
    });
    rerenderPane(view);
    const phases = view.getAllByTestId("workflow-run-phase");
    expect(phases.map((phase) => phase.getAttribute("data-phase-open"))).toEqual(["true", "true"]);
    expect(phases[0]!.getAttribute("data-phase-status")).toBe("done");
  });

  it("脊线：轨道段按Model的墨迹分两截画在E邻两站上，灯带Status，行进段在进入Run站的那One段", () => {
    setSnapshot({
      run: run({
        nodes: [
          { siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" },
          { siteId: "world-read#1", ordinal: 1, phase: "settled", outcome: "ok" },
          { siteId: "ask#2", ordinal: 1, phase: "executing" },
        ],
      }),
      phased: true,
    });
    const view = renderPane();
    const rails = view.getAllByTestId("workflow-run-spine-rail");
    expect(rails.map((rail) => rail.getAttribute("data-rail-position"))).toEqual([
      "below",
      "above",
    ]);
    expect(rails.map((rail) => rail.getAttribute("data-rail-ink"))).toEqual(["march", "march"]);
    expect(rails[0]!.className).toContain("wf-spine-march");
    const lamps = view.getAllByTestId("workflow-run-phase-lamp");
    expect(lamps.map((lamp) => lamp.getAttribute("data-lamp"))).toEqual(["done", "running"]);
    expect(lamps[1]!.className).toContain("wf-lamp-running");
    expect(lamps[0]!.closest('[data-testid="workflow-run-phase-toggle"]')).toBeTruthy();
  });

  it("脊线：折From的Phase在节头带头像串，展开后头像串让位To药丸", () => {
    setSnapshot({
      run: run({ nodes: [{ siteId: "ask#2", ordinal: 1, phase: "executing" }] }),
      phased: true,
    });
    const view = renderPane();
    const [plan, review] = view.getAllByTestId("workflow-run-phase");
    const cluster = within(plan!).getByTestId("workflow-run-phase-cluster");
    expect(cluster.querySelectorAll("[title]")).toHaveLength(2);
    expect(cluster.textContent).not.toContain("+");
    expect(within(review!).queryByTestId("workflow-run-phase-cluster")).toBeNull();
    fireEvent.click(within(plan!).getByTestId("workflow-run-phase-toggle"));
    expect(within(plan!).queryByTestId("workflow-run-phase-cluster")).toBeNull();
    expect(within(plan!).getAllByTestId("workflow-agent-pill").length).toBeGreaterThan(0);
  });

  it("脊线：无边的图没有轨道段；轮次写成 ⟳ n 而不Yes灯串", () => {
    setSnapshot({
      run: run({ nodes: [{ siteId: "ask#2", ordinal: 1, phase: "executing" }] }),
      phased: true,
    });
    snapshot = {
      ...(snapshot as { rows: { window: { display: { causalityGraph: object } }[] } }),
      rows: {
        window: (
          snapshot as { rows: { window: { display: { causalityGraph: object } }[] } }
        ).rows.window.map((row) => ({
          ...row,
          display: {
            ...row.display,
            causalityGraph: { ...row.display.causalityGraph, phaseEdges: [] },
          },
        })),
      },
    };
    const view = renderPane();
    expect(view.queryAllByTestId("workflow-run-spine-rail")).toHaveLength(0);
    expect(view.queryByTestId("workflow-run-phase-rounds")).toBeNull();
  });

  it("渲染 run Status词（灯旁永远有词）", () => {
    setSnapshot({ run: run({ status: "completed" }) });
    const view = renderPane();
    expect(view.getByTestId("workflow-run-status").textContent).toBe("Completed");
  });

  it("直接Start（无Tools行）时从Start轮Metadata取图（docs/dynamic-workflow/launch.md）", () => {
    const launchRow = {
      kind: "userInput" as const,
      rowId: "row-launch",
      text: "Started the saved workflow",
      origin: "workflowLaunch" as const,
      workflowLaunch: {
        runId: "dwfrun-1",
        toolCallId: "tool-wf-1",
        name: "Fan-out review",
        scope: "project" as const,
        path: "/workspace/.cf/workflows/fan-out-review.dwf.ts",
        display: graphRow.display,
        script: "export default async function main() {}",
      },
    };
    snapshot = {
      rows: { window: [launchRow] },
      workflowRuns: { revision: 1, runs: [run()] },
    };
    const view = renderPane();
    expect(view.getByTestId("workflow-run-phases")).toBeTruthy();
    expect(view.queryByTestId("workflow-run-graph-unavailable")).toBeNull();
  });

  it("直接Start的 run：Status头下有来龙去脉节——脚注、Scope徽Label、Description、实参表", () => {
    const workflowLaunch = {
      runId: "dwfrun-1",
      toolCallId: "tool-wf-1",
      name: "Fan-out review",
      scope: "global" as const,
      path: "/home/u/.cf/workflows/fan-out-review.dwf.ts",
      description: "Review a change from several angles.",
      args: { topic: "adaptive concurrency", depth: 3 },
      display: graphRow.display,
    };
    snapshot = {
      rows: {
        window: [
          {
            kind: "turnHeader" as const,
            rowId: "row-header",
            origin: "workflowLaunch" as const,
            executionKind: "controlOnly" as const,
            state: "completedSuccess" as const,
            startedAt: Date.UTC(2026, 8, 14, 13, 34),
            workflowLaunch,
          },
          {
            kind: "userInput" as const,
            rowId: "row-launch",
            text: "Started the saved workflow",
            origin: "workflowLaunch" as const,
            workflowLaunch,
          },
        ],
      },
      workflowRuns: { revision: 1, runs: [run()] },
    };
    const view = renderPane();
    const provenance = view.getByTestId("workflow-run-provenance");
    expect(provenance.getAttribute("data-workflow-launch-scope")).toBe("global");
    expect(provenance.textContent).toContain("Started by you from the workflows hub");
    expect(provenance.textContent).toContain(" · ");
    expect(view.getByTestId("workflow-run-provenance-scope").textContent).toBe("Global");
    expect(provenance.textContent).toContain("Review a change from several angles.");
    const args = view.getByTestId("workflow-run-provenance-args").textContent ?? "";
    expect(args).toContain("topic");
    expect(args).toContain("adaptive concurrency");
    expect(args).toContain("depth");
    expect(args).toContain("3");
    const header = view.getByTestId("workflow-run-status").closest("div.border-b")!;
    expect(
      header.compareDocumentPosition(provenance) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(view.getByTestId("workflow-run-phases")).toBeTruthy();
  });

  it("Tools路径发From的 run 没有来龙去脉节", () => {
    setSnapshot({ run: run() });
    const view = renderPane();
    expect(view.queryByTestId("workflow-run-provenance")).toBeNull();
  });

  it("行Window里翻不到那条Tool call时To出「没有图」而不Yes空清单", () => {
    setSnapshot({ run: run(), withGraphRow: false });
    const view = renderPane();
    expect(view.queryByTestId("workflow-run-phases")).toBeNull();
    expect(view.getByTestId("workflow-run-graph-unavailable").textContent).toContain(
      "not in this conversation's visible history",
    );
  });
});

describe("WorkflowRunSidePane Sub-agentModel", () => {
  const TEAM_PLAN_MODEL = "4fc7f541-2382-4c32-be11-f021b8d7ed1d/GLM-5.3-Flash$high";

  it("Model名YesSummary行的第One段，不再YesStatus头上的芯片", () => {
    setSnapshot({ run: run({ subagentModel: "zhipu/glm-5.3-flash" }) });
    const view = renderPane();

    const segment = view.getByTestId("workflow-run-subagent-model");
    expect(segment.textContent).toBe("Subagents glm-5.3-flash");
    expect(segment.closest('[data-testid="workflow-run-usage"]')).not.toBeNull();
    const summary = view.getByTestId("workflow-run-usage").textContent ?? "";
    expect(summary.indexOf("Subagents glm-5.3-flash")).toBe(0);
  });

  it("屏幕上绝不出现 provider id，哪怕它YesTeam Plan的 UUID；规范串退进 tooltip", () => {
    setSnapshot({ run: run({ subagentModel: TEAM_PLAN_MODEL }) });
    const view = renderPane();

    const segment = view.getByTestId("workflow-run-subagent-model");
    expect(segment.textContent).toBe("Subagents GLM-5.3-Flash");
    expect(document.body.textContent).not.toContain("4fc7f541");
    expect(segment.getAttribute("title")).toContain(TEAM_PLAN_MODEL);
    expect(segment.getAttribute("title")).toContain("thinking High");
  });

  it("zh-CN 下同One段说Chinese，Model名原样不译", () => {
    setSnapshot({ run: run({ subagentModel: TEAM_PLAN_MODEL }) });
    const view = renderPane("zh-CN");

    expect(view.getByTestId("workflow-run-subagent-model").textContent).toBe(
      "子代理 GLM-5.3-Flash",
    );
  });

  it("图不可得（建不出Timeline）Returned用量行时，Model仍在行首：它与有没有图Irrelevant", () => {
    setSnapshot({
      run: run({ subagentModel: TEAM_PLAN_MODEL, usage: { spentTokens: 12_345, nodesUsed: 3 } }),
      withGraphRow: false,
    });
    const view = renderPane();

    const segment = view.getByTestId("workflow-run-subagent-model");
    expect(segment.textContent).toBe("Subagents GLM-5.3-Flash");
    expect(document.body.textContent).not.toContain("4fc7f541");
    expect(segment.getAttribute("title")).toContain(TEAM_PLAN_MODEL);
    const usage = view.getByTestId("workflow-run-usage").textContent ?? "";
    expect(usage.indexOf("Subagents GLM-5.3-Flash")).toBe(0);
    expect(usage).toContain("Usage");
    expect(usage).toContain("12,345 tokens · 3 steps");
  });

  it("没Point to定过Model的 run 里整段Absent (subagent follows session model)", () => {
    setSnapshot({ run: run() });
    const view = renderPane();

    expect(view.queryByTestId("workflow-run-subagent-model")).toBeNull();
    expect(document.body.textContent).not.toContain("Subagents ");
  });

  it("run 不在投影里（被淘汰 / 冷Start）时也没有这One段", () => {
    setSnapshot({});
    const view = renderPane();

    expect(view.queryByTestId("workflow-run-subagent-model")).toBeNull();
  });
});

describe("WorkflowRunSidePane Summary行", () => {
  it("与聊天卡页脚同Copy：In progress的Sub-agentCount、步Count、token，没有上限、没有进度轨", () => {
    setSnapshot({
      run: run({
        usage: { spentTokens: 12_345, nodesUsed: 3 },
        actors: [{ siteId: "actor#1", ordinal: 1, status: "running" }],
        nodes: [{ siteId: "ask#1", ordinal: 1, phase: "executing" }],
      }),
    });
    const view = renderPane();
    const usage = view.getByTestId("workflow-run-usage").textContent ?? "";
    expect(usage).toContain("1 agent working");
    expect(usage).toContain("0/1 steps");
    expect(usage).toContain("12,345 tokens");
    expect(usage).not.toContain("%");
    expect(view.container.querySelector("progress")).toBeNull();
  });

  it("图不可得（建不出Timeline）时Returned用量行", () => {
    setSnapshot({
      run: run({ usage: { spentTokens: 12_345, nodesUsed: 3 } }),
      withGraphRow: false,
    });
    const view = renderPane();
    const usage = view.getByTestId("workflow-run-usage").textContent ?? "";
    expect(usage).toContain("Usage");
    expect(usage).toContain("12,345 tokens · 3 steps");
  });

  it("撞Boundary的 run 在Summary行下多One句「仅展示 n/m 步的Details」，计Count仍Yes真实步Count", () => {
    setSnapshot({
      run: run({
        usage: {
          spentTokens: 1,
          nodesUsed: 1_100,
          nodesUnlisted: 2_000,
          nodesUnlistedSettled: 1_500,
        },
        nodes: [{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" }],
        truncated: true,
      }),
    });
    const view = renderPane();
    expect(view.getByTestId("workflow-run-truncated").textContent).toBe(
      "Details shown for 1 of 2001 steps",
    );
    expect(view.getByTestId("workflow-run-usage").textContent ?? "").toContain("1501/2001 steps");
  });

  it("没撞Boundary、以及只有小表撞Boundary（步CountOne个不少）的 run 都没有这One句", () => {
    setSnapshot({ run: run({ nodes: [{ siteId: "ask#1", ordinal: 1, phase: "settled" }] }) });
    expect(renderPane().queryByTestId("workflow-run-truncated")).toBeNull();
    cleanup();
    setSnapshot({
      run: run({ nodes: [{ siteId: "ask#1", ordinal: 1, phase: "settled" }], truncated: true }),
    });
    expect(renderPane().queryByTestId("workflow-run-truncated")).toBeNull();
  });

  it("zh-CN 念「仅展示 1/2,001 步的Details」", () => {
    setSnapshot({
      run: run({
        usage: { spentTokens: 1, nodesUsed: 1, nodesUnlisted: 2_000 },
        nodes: [{ siteId: "ask#1", ordinal: 1, phase: "queued" }],
        truncated: true,
      }),
    });
    expect(renderPane("zh-CN").getByTestId("workflow-run-truncated").textContent).toBe(
      "仅展示 1/2001 步的Details",
    );
  });
});

describe("WorkflowRunSidePane Stop", () => {
  it("running 时可点，并且走既有的 cancelBackgroundWork {workId ≡ runId}", () => {
    setSnapshot({ run: run({ status: "running" }) });
    const view = renderPane();
    const button = view.getByTestId<HTMLButtonElement>("workflow-run-cancel");
    expect(button.disabled).toBe(false);

    fireEvent.click(button);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const envelope = sendCommand.mock.calls[0]![0] as unknown as {
      type: string;
      sessionId: string;
      payload: { workId: string };
    };
    expect(envelope.type).toBe("cancelBackgroundWork");
    expect(envelope.payload).toEqual({ workId: "dwfrun-1" });
    expect(envelope.sessionId).toBe("parent-a");
  });

  it.each(["pending", "completed", "errored", "stopped"] as const)("%s 时按钮禁用", (status) => {
    setSnapshot({ run: run({ status }) });
    const view = renderPane();
    expect(view.getByTestId<HTMLButtonElement>("workflow-run-cancel").disabled).toBe(true);
  });

  it("run 不在投影里时按钮禁用（对它的在飞StatusOne无所知）", () => {
    setSnapshot({});
    const view = renderPane();
    expect(view.getByTestId<HTMLButtonElement>("workflow-run-cancel").disabled).toBe(true);
  });

  it("Stop按钮提供 Stop run 无障碍名与可见Copy", () => {
    setSnapshot({ run: run({ status: "running" }) });
    const view = renderPane();
    const button = view.getByTestId("workflow-run-cancel");
    expect(button.getAttribute("aria-label")).toBe("Stop run");
    expect(button.textContent).toContain("Stop run");
  });

  it("可点时Notice带第Two行「停下的Run可以恢复」；禁用时只剩为什么Unavailable", () => {
    setSnapshot({ run: run({ status: "running" }) });
    renderPane();
    expect(tooltips.calls.find((call) => call.title === "Stop run")?.description).toBe(
      "You can resume later; finished steps are kept.",
    );

    cleanup();
    tooltips.calls.length = 0;
    setSnapshot({ run: run({ status: "completed" }) });
    renderPane();
    const disabled = tooltips.calls.find(
      (call) => call.title === "Only a running workflow can be stopped.",
    );
    expect(disabled).toBeTruthy();
    expect(disabled?.description).toBeUndefined();
  });
});

describe("WorkflowRunSidePane 被拒Notice", () => {
  it("cancel 被拒（not_found）→ Status头下出现One句话；run StatusOne变即Collapse", async () => {
    setSnapshot({ run: run({ status: "running" }) });
    sendCommand.mockResolvedValueOnce({
      status: "failed",
      reasonCode: "fault.command.backgroundWorkCancelRejected.not_found",
    } as never);
    const view = renderPane();

    fireEvent.click(view.getByTestId("workflow-run-cancel"));

    const hint = await view.findByTestId("workflow-run-rejection");
    expect(hint.textContent).toContain("not running in this agent");
    expect(view.getByTestId<HTMLButtonElement>("workflow-run-cancel").disabled).toBe(false);

    setSnapshot({ run: run({ status: "stopped", stopReason: "user" }) });
    rerenderPane(view);
    expect(view.queryByTestId("workflow-run-rejection")).toBeNull();
  });

  it("resume 被拒（compile_failed）→ One句话Point to向调整Workflow + ACK 的Diagnostics在等宽块里", async () => {
    setSnapshot({ run: run({ status: "stopped", resumable: true }) });
    sendCommand.mockResolvedValueOnce({
      status: "failed",
      reasonCode: "fault.command.workflowRunResumeRejected.compile_failed",
      message: "L3:C1 Property 'askWithOldFacade' does not exist",
    } as never);
    const view = renderPane();

    fireEvent.click(await view.findByTestId("workflow-run-resume"));

    const hint = await view.findByTestId("workflow-run-rejection");
    expect(hint.textContent).toContain("no longer compiles");
    expect(hint.textContent).toContain("amend the workflow");
    expect(hint.querySelector("pre")?.textContent).toContain("askWithOldFacade");
  });

  it("词表outer的 reasonCode → 通用Copy带 code；accepted 不出Notice", async () => {
    setSnapshot({ run: run({ status: "running" }) });
    sendCommand.mockResolvedValueOnce({
      status: "failed",
      reasonCode: "fault.command.executionFailed",
    } as never);
    const view = renderPane();

    fireEvent.click(view.getByTestId("workflow-run-cancel"));
    const hint = await view.findByTestId("workflow-run-rejection");
    expect(hint.textContent).toContain("fault.command.executionFailed");

    setSnapshot({ run: run({ status: "stopped" }) });
    rerenderPane(view);
    setSnapshot({ run: run({ status: "running" }) });
    rerenderPane(view);
    fireEvent.click(view.getByTestId("workflow-run-cancel"));
    await Promise.resolve();
    await Promise.resolve();
    expect(view.queryByTestId("workflow-run-rejection")).toBeNull();
  });

  it("zh-CN Copy", async () => {
    setSnapshot({ run: run({ status: "running" }) });
    sendCommand.mockResolvedValueOnce({
      status: "failed",
      reasonCode: "fault.command.backgroundWorkCancelRejected.not_running",
    } as never);
    const view = renderPane("zh-CN");
    fireEvent.click(view.getByTestId("workflow-run-cancel"));
    expect((await view.findByTestId("workflow-run-rejection")).textContent).toContain("已经结束");
  });
});

describe("WorkflowRunSidePane Result与Failed面板", () => {
  it("completed 且无 resultPreview 时Point to向Session里的Background resultsMessages，不编造Result", () => {
    setSnapshot({ run: run({ status: "completed" }) });
    const view = renderPane();
    expect(view.getByTestId("workflow-run-result").textContent).toContain(
      "delivered to the conversation as a background result message",
    );
  });

  it("errored 时原样呈现投影To出的ErrorOriginal text", () => {
    setSnapshot({ run: run({ status: "errored", error: "节点Count超过上限 100" }) });
    const view = renderPane();
    const panel = view.getByTestId("workflow-run-error");
    expect(panel.textContent).toContain("Run errored");
    expect(panel.textContent).toContain("节点Count超过上限 100");
  });

  it("stopped 且没有Error details时Description没有，而不Yes留One片空白", () => {
    setSnapshot({ run: run({ status: "stopped" }) });
    const view = renderPane();
    const panel = view.getByTestId("workflow-run-error");
    expect(panel.textContent).toContain("Run stopped");
    expect(panel.textContent).toContain("No error detail was recorded.");
  });

  it("stopped 带原因：Title与Status头都跟原因词（决策 15）", () => {
    setSnapshot({
      run: run({ status: "stopped", stopReason: "provider", error: "Sign-in expired." } as never),
    });
    const view = renderPane();
    expect(view.getByTestId("workflow-run-stop-reason").textContent).toContain("model error");
    expect(view.getByTestId("workflow-run-status-reason").textContent).toContain("model error");
    expect(view.getByTestId("workflow-run-error").textContent).toContain("Sign-in expired.");
  });

  it("Status行第Three个词：run 带 resumable 时说「resumable」，不带就没有那个词", () => {
    setSnapshot({ run: run({ status: "stopped", stopReason: "user", resumable: true }) });
    const withBit = renderPane();
    expect(withBit.getByTestId("workflow-run-status-resumable").textContent).toContain("resumable");
    expect(withBit.getByTestId("workflow-run-status-reason").textContent).toContain("by you");

    cleanup();
    setSnapshot({ run: run({ status: "stopped", stopReason: "user" }) });
    const without = renderPane();
    expect(without.queryByTestId("workflow-run-status-resumable")).toBeNull();

    cleanup();
    setSnapshot({ run: run({ status: "stopped", stopReason: "user", resumable: true }) });
    const zh = renderPane("zh-CN");
    expect(zh.getByTestId("workflow-run-status-resumable").textContent).toContain("可恢复");
  });

  it("running 时既没有Result面板也没有Failed面板", () => {
    setSnapshot({ run: run({ status: "running" }) });
    const view = renderPane();
    expect(view.queryByTestId("workflow-run-result")).toBeNull();
    expect(view.queryByTestId("workflow-run-error")).toBeNull();
  });
});

describe("WorkflowRunSidePane UpgradeIssue", () => {
  const NOW = 1_756_000_000_000;
  const MINUTE = 60_000;
  const questions = [
    {
      qid: "dwfq-dwfrun1-1",
      actorSiteId: "actor#1",
      actorOrdinal: 1,
      actorName: "poet",
      question: "评分上限是 95，但通过门槛是 96，这个门是不是坏了？",
      context: "已经试过 4 轮，最高分 95。",
      askedAt: NOW - 42 * MINUTE,
    },
    {
      qid: "dwfq-dwfrun1-2",
      actorSiteId: "actor#2",
      actorOrdinal: 3,
      question: "用哪版风格指南？",
      askedAt: NOW - 90 * MINUTE,
    },
  ];
  const askers = () =>
    run({
      actors: [
        { siteId: "actor#1", ordinal: 1, name: "poet", sessionId: "s-1", status: "waiting" },
        { siteId: "actor#2", ordinal: 3, sessionId: "s-2", status: "waiting" },
      ],
      nodes: [
        {
          siteId: "ask#1",
          ordinal: 1,
          phase: "executing",
          actorSiteId: "actor#1",
          actorOrdinal: 1,
        },
        { siteId: "ask#2", ordinal: 3, phase: "waiting", actorSiteId: "actor#2", actorOrdinal: 3 },
      ],
      pendingQuestions: questions,
    });

  it("挂在Ask者那One行下面：Issue紧跟匹配 site@ordinal 的Sub-agent药丸", () => {
    setSnapshot({ run: askers() });
    const view = renderPane();

    const rows = view.getAllByTestId("workflow-run-question");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-qid")).toBe("dwfq-dwfrun1-1");
    const pill = rows[0]!.previousElementSibling as HTMLElement;
    expect(pill.getAttribute("data-testid")).toBe("workflow-agent-pill");
    expect(pill.textContent).toContain("poet");
    expect(rows[0]!.textContent).toContain("这个门是不是坏了？");
    expect(rows[0]!.textContent).toContain("已经试过 4 轮，最高分 95。");
    expect(rows[0]!.textContent).toContain("dwfq-dwfrun1-1");
    expect(rows[0]!.textContent).not.toContain("poet");
    expect(view.queryByTestId("workflow-run-orphan-questions")).toBeNull();
  });

  it("每条带WaitingDuration（读者的First question恒Yes「这个已经等了多久」）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      setSnapshot({ run: askers() });
      const view = renderPane();
      const waited = view.getAllByTestId("workflow-run-question-waited");
      expect(waited[0]!.textContent).toBe("42m ago");
      expect(waited[1]!.textContent).toBe("1h ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("WaitingDuration自己走时钟：run 在等Answer时不发Events，靠投影更New会One直Show「Just now」", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      setSnapshot({ run: askers() });
      const view = renderPane();
      const before = view.getAllByTestId("workflow-run-question-waited")[0]!.textContent;
      act(() => {
        vi.advanceTimersByTime(20 * MINUTE);
      });
      const after = view.getAllByTestId("workflow-run-question-waited")[0]!.textContent;
      expect(after).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("askedAt 缺席（老 journal Replay）时不渲染Duration，绝不编One个「Just now」", () => {
    const { askedAt: _dropped, ...withoutAskedAt } = questions[0]!;
    setSnapshot({ run: { ...askers(), pendingQuestions: [withoutAskedAt] } });
    const view = renderPane();
    expect(view.getAllByTestId("workflow-run-question")).toHaveLength(1);
    expect(view.queryByTestId("workflow-run-question-waited")).toBeNull();
  });

  it("匹配不上Ask者的Issue挂在清单末尾，并自报名Character（站点InstanceTags / 匿名兜底）", () => {
    setSnapshot({
      run: run({
        pendingQuestions: [
          { qid: "q-a", actorSiteId: "actor#9", actorOrdinal: 2, question: "谁来审？" },
          { qid: "q-b", question: "没有主语的Issue" },
        ],
      }),
    });
    const view = renderPane();
    const block = view.getByTestId("workflow-run-orphan-questions");
    expect(block.textContent).toContain("Waiting on an answer");
    const rows = view.getAllByTestId("workflow-run-question");
    expect(rows[0]!.textContent).toContain("actor#9@2");
    expect(rows[1]!.textContent).toContain("Anonymous Subagent");
  });

  it("v1 只读：清单里没有任何Input控件or应Answer按钮", () => {
    setSnapshot({ run: askers() });
    const view = renderPane();
    const list = view.getByTestId("workflow-run-phases");
    expect(list.querySelectorAll("input, textarea").length).toBe(0);
    expect(list.textContent).not.toContain("Answer");
  });

  it("零条时没有Issue行，也没有末尾的孤儿块（键缺席与空Array两种形态都One样）", () => {
    setSnapshot({ run: run({ pendingQuestions: [] }) });
    let view = renderPane();
    expect(view.queryAllByTestId("workflow-run-question")).toHaveLength(0);
    expect(view.queryByTestId("workflow-run-orphan-questions")).toBeNull();
    cleanup();
    setSnapshot({ run: run() });
    view = renderPane();
    expect(view.queryAllByTestId("workflow-run-question")).toHaveLength(0);
  });

  it("zh-CN 下WaitingDuration与孤儿块Title都Local化，且没有English兜底漏出来", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      setSnapshot({
        run: run({
          pendingQuestions: [
            { qid: "q-b", question: "没有主语的Issue", askedAt: NOW - 42 * MINUTE },
          ],
        }),
      });
      const view = renderPane("zh-CN");
      const text = view.getByTestId("workflow-run-orphan-questions").textContent ?? "";
      expect(text).toContain("待AnswerIssue");
      expect(text).toContain("42 minutes前");
      expect(text).toContain("Unnamed sub-agent");
      expect(text).not.toContain("Waiting on an answer");
      expect(text).not.toContain("ago");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkflowRunSidePane 淘汰 / 冷Start空态", () => {
  it("run 不在 workflowRuns 里时 tab 仍然打开，措辞只说实时Status没了", () => {
    setSnapshot({});
    const view = renderPane();
    const panel = view.getByTestId("workflow-run-untracked");
    expect(panel.textContent).toContain("No longer tracked live");
    expect(panel.textContent).toContain("record is still complete");
  });
});

describe("WorkflowRunSidePane 国际化", () => {
  it("Status头、用量、Stop 与Result在 zh-CN 下AllLocal化", () => {
    setSnapshot({
      run: run({
        status: "completed",
        usage: { spentTokens: 1_000, nodesUsed: 3 },
      }),
    });
    const view = renderPane("zh-CN");
    const text = view.container.textContent ?? "";

    expect(view.getByTestId("workflow-run-status").textContent).toBe("已完成");
    expect(text).toContain("StopRun");
    expect(view.getByTestId("workflow-run-usage").textContent).toContain("3 个Sub-agent");
    expect(view.getByTestId("workflow-run-usage").textContent).toContain("1,000 tokens");
    expect(text).toContain("结果");
    expect(text).not.toContain("Stop run");
    expect(text).not.toContain("CancelRun");
  });
});

describe("WorkflowRunSidePane Sub-agent行", () => {
  function actor(overrides: Record<string, unknown> = {}) {
    return {
      siteId: "actor#1",
      ordinal: 1,
      sessionId: "dwf-dwfrun-1-actor_1@1",
      status: "waiting" as const,
      ...overrides,
    };
  }
  const executing = (actorOrdinal = 1) => ({
    siteId: "ask#1",
    ordinal: actorOrdinal,
    phase: "executing" as const,
    actorSiteId: "actor#1",
    actorOrdinal,
  });

  it("行带Run时名、计Count与可读的StatusLabel记；不写Current步的 label（站点名对读者没有Letter息量）", () => {
    setSnapshot({ run: run({ actors: [actor({ name: "planner" })], nodes: [executing()] }) });
    const view = renderPane();

    const pill = view
      .getAllByTestId("workflow-agent-pill")
      .find((candidate) => candidate.textContent?.includes("planner"))!;
    expect(pill.getAttribute("data-agent-status")).toBe("running");
    expect(pill.querySelector('[data-testid="workflow-run-agent-activity"]')).toBeNull();
    expect(pill.textContent).toContain("1 tasks");
    const mark = pill.querySelector('[data-testid="workflow-pill-status"]');
    expect(mark?.getAttribute("aria-label")).toBe("running");
  });

  
  const openOf = (view: ReturnType<typeof renderPane>, name: string) =>
    view
      .getAllByTestId("workflow-agent-pill")
      .find((candidate) => candidate.textContent?.includes(name))!
      .querySelector('[data-testid="workflow-run-agent-open"]')!;

  it("点行尾箭头开 transcript tab，并带上 tab 自己的 workspace scope", () => {
    setSnapshot({ run: run({ actors: [actor({ name: "planner" })], nodes: [executing()] }) });
    const view = renderPane();

    fireEvent.click(openOf(view, "planner"));
    expect(onOpenWorkflowActorSession).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      actorSessionId: "dwf-dwfrun-1-actor_1@1",
      siteId: "actor#1",
      ordinal: 1,
      actorName: "planner",
    });
  });

  it("整行就Yes按钮：点药丸本身即打开，↗ 只Yes可打开的可见Evidence", () => {
    setSnapshot({ run: run({ actors: [actor({ name: "planner" })], nodes: [executing()] }) });
    const view = renderPane();
    const pill = view
      .getAllByTestId("workflow-agent-pill")
      .find((candidate) => candidate.textContent?.includes("planner"))!;
    expect(pill.tagName).toBe("BUTTON");
    expect(pill.getAttribute("aria-label")).toBe("Open the transcript of planner");
    expect(pill.querySelector('[data-testid="workflow-run-agent-open"]')).toBeTruthy();
    fireEvent.click(pill);
    expect(onOpenWorkflowActorSession).toHaveBeenCalledTimes(1);
    expect(onOpenWorkflowActorSession).toHaveBeenCalledWith(
      expect.objectContaining({ actorSessionId: "dwf-dwfrun-1-actor_1@1", actorName: "planner" }),
    );
  });

  it("Session未落库的Instance仍然成行，也可开：Request带槽位、不带Session id（tab 里Yes占位，自愈）", () => {
    // docs/dynamic-workflow/presentation.md「The pill」。
    const { sessionId: _absent, ...pending } = actor({ name: "planner" });
    setSnapshot({ run: run({ actors: [pending], nodes: [executing()] }) });
    const view = renderPane();

    const pill = view
      .getAllByTestId("workflow-agent-pill")
      .find((candidate) => candidate.textContent?.includes("planner"))!;
    expect(pill.tagName).toBe("BUTTON");
    fireEvent.click(pill);
    expect(onOpenWorkflowActorSession).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "dwfrun-1",
        siteId: "actor#1",
        ordinal: 1,
        actorName: "planner",
      }),
    );
    expect(onOpenWorkflowActorSession.mock.calls[0]![0]).not.toHaveProperty("actorSessionId");
  });

  it("还没出现的Sub-agent（静态R道）在活的 run 里同样可开：期望序Number 1", () => {
    setSnapshot({ run: run({ actors: [actor({ name: "planner" })], nodes: [executing()] }) });
    const view = renderPane();
    const opens = view.getAllByTestId("workflow-run-agent-open");
    const absent = opens.find((open) => open.getAttribute("data-agent-session-id") === "")!;
    fireEvent.click(absent);
    const request = onOpenWorkflowActorSession.mock.calls[0]![0] as Record<string, unknown>;
    expect(request).toMatchObject({ runId: "dwfrun-1", ordinal: 1 });
    expect(request.siteId).not.toBe("actor#1");
    expect(request).not.toHaveProperty("actorSessionId");
  });

  it("宿主没有下钻回调时没有任何箭头（回调的存在本身就Yes门控）", () => {
    setSnapshot({ run: run({ actors: [actor({ name: "planner" })], nodes: [executing()] }) });
    const view = renderPane("en-US", { withActorCallback: false });
    expect(view.queryByTestId("workflow-run-agent-open")).toBeNull();
  });

  it("同OneR道两个Instance时拆成两行，各开各的 transcript", () => {
    setSnapshot({
      run: run({
        actors: [
          actor({ ordinal: 1, name: "worker-1", sessionId: "s-1" }),
          actor({ ordinal: 2, name: "worker-2", sessionId: "s-2" }),
        ],
        nodes: [executing(1), executing(2)],
      }),
    });
    const view = renderPane();

    const opens = view.getAllByTestId("workflow-run-agent-open");
    const withSession = opens.filter((open) => open.getAttribute("data-agent-session-id") !== "");
    expect(withSession.map((button) => button.getAttribute("data-agent-session-id"))).toEqual([
      "s-1",
      "s-2",
    ]);
    fireEvent.click(withSession[1]!);
    expect(onOpenWorkflowActorSession).toHaveBeenCalledWith(
      expect.objectContaining({ actorSessionId: "s-2", ordinal: 2, actorName: "worker-2" }),
    );
  });

  it("脚本行走自己的那条路（docs/dynamic-workflow/transcript-and-notifications.md）：不开 actor transcript，开整个 run 的脚本 transcript，落到这One站", () => {
    setSnapshot({
      run: run({ nodes: [{ siteId: "world-read#1", ordinal: 1, phase: "executing" }] }),
    });
    const view = renderPane();
    const pill = view
      .getAllByTestId("workflow-agent-pill")
      .find((candidate) => candidate.textContent?.includes("Script"))!;
    expect(pill.querySelector('[data-testid="workflow-run-agent-open"]')).toBeNull();
    expect(pill.textContent).toContain("1 reads");
    expect(pill.tagName).toBe("BUTTON");
    const open = pill.querySelector('[data-testid="workflow-run-workspace-open"]')!;
    expect(open.getAttribute("data-phase-id")).toBe("workflow");
    fireEvent.click(pill);
    expect(onOpenWorkflowActorSession).not.toHaveBeenCalled();
    expect(onOpenWorkflowWorkspace).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "tool-wf-1",
      runId: "dwfrun-1",
      workflowName: "Fan-out review",
      phaseId: "workflow",
    });
  });

  it("带Phase的图：脚本行交出所在站的Phase id；宿主没To回调时它Yes span", () => {
    setSnapshot({
      phased: true,
      run: run({ nodes: [{ siteId: "world-read#1", ordinal: 1, phase: "executing" }] }),
    });
    const view = renderPane();
    const pill = view
      .getAllByTestId("workflow-agent-pill")
      .find((candidate) => candidate.textContent?.includes("Script"))!;
    expect(pill.getAttribute("aria-label")).toBe("Open the script's steps at plan");
    fireEvent.click(pill);
    expect(onOpenWorkflowWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ phaseId: "phase#a" }),
    );
    cleanup();

    const bare = renderPane("en-US", { withWorkspaceCallback: false });
    const span = bare
      .getAllByTestId("workflow-agent-pill")
      .find((candidate) => candidate.textContent?.includes("Script"))!;
    expect(span.tagName).toBe("SPAN");
    expect(bare.queryByTestId("workflow-run-workspace-open")).toBeNull();
  });

  it("NewInstance出现即入列：行Yes活的，不Yes打开那One刻的快照", () => {
    const withSession = (view: ReturnType<typeof renderPane>) =>
      view
        .getAllByTestId("workflow-run-agent-open")
        .filter((open) => open.getAttribute("data-agent-session-id") !== "");
    setSnapshot({ run: run({ actors: [actor({ name: "worker-1" })], nodes: [executing()] }) });
    const view = renderPane();
    expect(withSession(view)).toHaveLength(1);

    setSnapshot({
      run: run({
        actors: [
          actor({ name: "worker-1" }),
          actor({ ordinal: 2, name: "worker-2", sessionId: "s-2" }),
        ],
        nodes: [executing(1), executing(2)],
      }),
    });
    rerenderPane(view);
    expect(withSession(view)).toHaveLength(2);
  });

  it("点节头折叠再展开", () => {
    setSnapshot({ run: run({ actors: [actor({ name: "planner" })], nodes: [executing()] }) });
    const view = renderPane();
    const phase = view.getByTestId("workflow-run-phase");
    expect(phase.getAttribute("data-phase-open")).toBe("true");

    fireEvent.click(view.getByTestId("workflow-run-phase-toggle"));
    expect(phase.getAttribute("data-phase-open")).toBe("false");
    expect(view.queryByTestId("workflow-run-agent-open")).toBeNull();

    fireEvent.click(view.getByTestId("workflow-run-phase-toggle"));
    expect(phase.getAttribute("data-phase-open")).toBe("true");
  });

  it("zh-CN 下隐式Phase名、计Count与StatusLabel记都Local化", () => {
    setSnapshot({ run: run({ actors: [actor({ name: "planner" })], nodes: [executing()] }) });
    const view = renderPane("zh-CN");
    const list = view.getByTestId("workflow-run-phases");
    expect(list.textContent).toContain("工作流");
    expect(list.textContent).toContain("1 个Task");
    expect(
      list.querySelector('[data-testid="workflow-pill-status"]')?.getAttribute("aria-label"),
    ).toBe("运行中");
    expect(list.textContent).not.toContain("asks");
  });
});

describe("WorkflowRunSidePane Resume", () => {
  it("stopped 且带 resumable Status位 → 渲染 Resume，点击发 resumeWorkflowRun {workId ≡ runId, name}", async () => {
    setSnapshot({ run: run({ status: "stopped", resumable: true }) });
    const view = renderPane();
    const button = await view.findByTestId<HTMLButtonElement>("workflow-run-resume");

    fireEvent.click(button);

    const resumeCall = sendCommand.mock.calls.find(
      (call) => (call[0] as { type: string }).type === "resumeWorkflowRun",
    );
    expect(resumeCall).toBeDefined();
    const envelope = resumeCall![0] as unknown as {
      type: string;
      sessionId: string;
      payload: { workId: string; name?: string };
    };
    expect(envelope.payload).toEqual({ workId: "dwfrun-1", name: "Fan-out review" });
    expect(envelope.sessionId).toBe("parent-a");
  });

  it.each(["pending", "running", "completed"] as const)("%s 不渲染 Resume", async (status) => {
    setSnapshot({ run: run({ status }) });
    const view = renderPane();
    await Promise.resolve();
    expect(view.queryByTestId("workflow-run-resume")).toBeNull();
  });

  it("stopped(interrupted) 且投影带 resumable Status位（冷回放折叠了行的谓词）→ 渲染 Resume", async () => {
    setSnapshot({
      run: run({
        status: "stopped",
        stopReason: "interrupted",
        error: "owning process exited",
        resumable: true,
      } as never),
    });
    const view = renderPane();
    expect(await view.findByTestId("workflow-run-resume")).toBeDefined();
  });

  it("errored（脚本真Failed）→ 不渲染", async () => {
    setSnapshot({ run: run({ status: "errored" }) });
    const view = renderPane();
    await Promise.resolve();
    expect(view.queryByTestId("workflow-run-resume")).toBeNull();
  });

  it("stopped 但无Status位（Old CLI）→ 不渲染死按钮；不再另查 journal Summary", async () => {
    setSnapshot({ run: run({ status: "stopped" }) });
    const view = renderPane();
    await Promise.resolve();
    await Promise.resolve();
    expect(view.queryByTestId("workflow-run-resume")).toBeNull();
    expect(workflowRunsQuery).not.toHaveBeenCalled();
  });

  it("灰度关 → resumable 的 run 也不渲染 Resume，但Status头与Phase清单照Old", async () => {
    setDynamicWorkflowEnabled(false);
    setSnapshot({ run: run({ status: "stopped", resumable: true }) });
    const view = renderPane();
    await Promise.resolve();

    expect(view.queryByTestId("workflow-run-resume")).toBeNull();
    expect(view.queryByTestId("workflow-run-cancel")).not.toBeNull();
    expect(view.queryByTestId("workflow-run-phases")).not.toBeNull();
  });

  it("灰度快照未就绪（loading）→ 先不To Resume；就绪且Hit后再Long出来", async () => {
    useDynamicWorkflowAvailabilityStore.setState({
      status: "loading",
      enabled: false,
      config: null,
    });
    setSnapshot({ run: run({ status: "stopped", resumable: true }) });
    const view = renderPane();
    await Promise.resolve();
    expect(view.queryByTestId("workflow-run-resume")).toBeNull();

    act(() => {
      setDynamicWorkflowEnabled(true);
    });
    expect(await view.findByTestId("workflow-run-resume")).toBeDefined();
  });
});

//
describe("WorkflowRunSidePane 产物区", () => {
  const summary = (overrides: Record<string, unknown> = {}) => ({
    id: "book",
    kind: "file",
    title: "审计报告",
    version: 1,
    contentType: "application/pdf",
    bytes: 4096,
    ...overrides,
  });

  it("排在Phase清单之后，Yes面板的最后One节（Results / EventsLogs / Script Three节已撤走）", async () => {
    setSnapshot({
      run: run({
        artifacts: [summary()],
        pendingQuestions: [
          { qid: "q-1", siteId: "ask#1", ordinal: 1, question: "哪个 registry？" },
        ],
      } as never),
    });
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId(TID_WORKFLOW_ARTIFACTS_SECTION)).toBeTruthy());

    const artifacts = view.getByTestId(TID_WORKFLOW_ARTIFACTS_SECTION);
    const phases = view.getByTestId("workflow-run-phases");
    expect(phases.compareDocumentPosition(artifacts) & 4).toBeTruthy();
    expect(artifacts.nextElementSibling).toBeNull();
  });

  it("零件时整区缺席（不To不Publish产物的 run 留One节空壳）", async () => {
    setSnapshot({ run: run() });
    const view = renderPane();
    await act(async () => {});
    expect(view.queryByTestId(TID_WORKFLOW_ARTIFACTS_SECTION)).toBeNull();
  });

  it.each(["errored", "stopped"] as const)("%s 的 run One样渲染产物区", async (status) => {
    setSnapshot({ run: run({ status, artifacts: [summary()] } as never) });
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId(TID_WORKFLOW_ARTIFACTS_SECTION)).toBeTruthy());
    expect(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD)).toBeTruthy();
  });

  it("点卡片 → 打开产物 tab 的Request带上这块面板的 workspace scope 与产物 id，且不带VersionNumber", async () => {
    setSnapshot({ run: run({ artifacts: [summary()] } as never) });
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD)).toBeTruthy());

    fireEvent.click(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD));
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
      title: "审计报告",
      contentType: "application/pdf",
    });
  });

  it("合并View里有 sourcePath 时One并交出去——宿主不必再为「在WorkspaceShow」查One次 journal", async () => {
    workflowRunArtifactsQuery.mockImplementation(async () => ({
      artifacts: [
        {
          id: "book",
          kind: "file",
          title: "审计报告",
          version: 1,
          contentType: "text/html",
          sourcePath: "reports/audit.html",
          versions: [{ version: 1, publishedAt: 1, bytes: 4096 }],
          itemCount: 0,
        },
      ],
    }));
    setSnapshot({ run: run({ artifacts: [summary({ contentType: "text/html" })] } as never) });
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD)).toBeTruthy());

    fireEvent.click(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD));
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      artifactId: "book",
      title: "审计报告",
      contentType: "text/html",
      sourcePath: "reports/audit.html",
    });
  });

  it("宿主没注入打开Capabilities时卡片不可点（回调的存在本身就Yes门控）", async () => {
    setSnapshot({ run: run({ artifacts: [summary()] } as never) });
    const view = renderPane("en-US", { withArtifactCallback: false });
    await waitFor(() => expect(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD)).toBeTruthy());
    fireEvent.click(view.getByTestId(TID_WORKFLOW_ARTIFACT_CARD));
    expect(onOpenWorkflowArtifact).not.toHaveBeenCalled();
  });

  it("run 已被活投影淘汰时，产物仍从 journal 列得出来", async () => {
    workflowRunArtifactsQuery.mockImplementation(async () => ({
      artifacts: [
        {
          id: "notes",
          kind: "markdown",
          title: "综述",
          version: 1,
          versions: [{ version: 1, publishedAt: 1, bytes: 12 }],
          itemCount: 0,
        },
      ],
    }));
    setSnapshot({});
    const view = renderPane();
    await waitFor(() => expect(view.getByTestId(TID_WORKFLOW_ARTIFACTS_SECTION)).toBeTruthy());
    expect(view.getByText("综述")).toBeTruthy();
  });

  it("zh-CN 下区名念「产物」——与顶部「Result」措辞不重叠", async () => {
    setSnapshot({ run: run({ artifacts: [summary()] } as never) });
    const view = renderPane("zh-CN");
    await waitFor(() => expect(view.getByTestId(TID_WORKFLOW_ARTIFACTS_SECTION)).toBeTruthy());
    expect(view.getByTestId(TID_WORKFLOW_ARTIFACTS_SECTION).textContent).toContain("产物");
  });
});

describe("WorkflowRunSidePane Phase名册", () => {
  type FanStatus = "done" | "running" | "failed" | "pending";
  function fanoutSnapshot(
    n: number,
    statusOf: (index: number) => FanStatus,
    pendingQuestions: WorkflowRunState["pendingQuestions"] = [],
    unlistedByPhase?: WorkflowRunState["unlistedByPhase"],
  ) {
    const steps: GraphStep[] = [
      { id: "ask#1", kind: "ask", label: "review", lane: "actor#1", phase: "phase#a" },
    ];
    const lanes = [{ id: "actor#1" }];
    const actors: WorkflowRunState["actors"] = [];
    const nodes: WorkflowRunState["nodes"] = [];
    for (let i = 1; i <= n; i += 1) {
      const status = statusOf(i);
      actors.push({
        siteId: "actor#1",
        ordinal: i,
        name: `reviewer-${i}`,
        sessionId: `dwf-dwfrun-1-actor_1@${i}`,
        status: status === "running" ? "running" : status === "pending" ? "waiting" : "completed",
      });
      if (status === "pending") continue;
      nodes.push({
        siteId: "ask#1",
        ordinal: i,
        actorSiteId: "actor#1",
        actorOrdinal: i,
        ...(status === "running"
          ? { phase: "executing" }
          : { phase: "settled", outcome: status === "failed" ? "failed" : "ok" }),
      } as WorkflowRunState["nodes"][number]);
    }
    snapshot = {
      rows: {
        window: [
          {
            ...graphRow,
            display: {
              ...graphRow.display,
              causalityGraph: {
                steps,
                lanes,
                participants: participantsOf(steps).map((participant) => ({
                  ...participant,
                  many: true,
                })),
                handoffs: [],
                phases: [{ id: "phase#a", name: "review", line: 1 }],
                phaseEdges: [],
              },
            },
          },
        ],
      },
      workflowRuns: {
        revision: 1,
        runs: [
          run({
            actors,
            nodes,
            pendingQuestions,
            ...(unlistedByPhase === undefined ? {} : { truncated: true, unlistedByPhase }),
          }),
        ],
      },
    };
  }
  const mid = (i: number): FanStatus =>
    i === 4 ? "failed" : i === 2 || i === 6 || i === 8 ? "running" : "done";
  const question = {
    qid: "q-6",
    actorSiteId: "actor#1",
    actorOrdinal: 6,
    question: "Treat the failing assertion as a bug or as drift?",
  };

  it("钉 5 枚：asking → running → failed → 补位；Issue挂在钉住的Ask者下面；第六枚Yes门，门关着", () => {
    fanoutSnapshot(9, mid, [question]);
    const view = renderPane();
    const section = view.getByTestId("workflow-run-phase");
    expect(section.getAttribute("data-phase-open")).toBe("true");
    const pins = within(section).getByTestId("workflow-roster-pins");
    const pills = within(pins).getAllByTestId("workflow-agent-pill");
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "reviewer-61 tasks",
      "reviewer-21 tasks",
      "reviewer-81 tasks",
      "reviewer-41 tasks",
      "reviewer-11 tasks",
    ]);
    const row = within(pins).getByTestId("workflow-run-question");
    expect(row.getAttribute("data-qid")).toBe("q-6");
    expect(row.parentElement).toBe(pills[0]!.parentElement);
    const door = within(section).getByTestId("workflow-roster-more-row");
    expect(door.tagName).toBe("BUTTON");
    expect(door.getAttribute("data-door")).toBe("closed");
    expect(door.getAttribute("data-more-count")).toBe("4");
    expect(door.getAttribute("title")).toBe("4 more subagents · list them here");
    const tally = within(door).getByTestId("workflow-roster-tally");
    expect(
      [...tally.querySelectorAll("[data-roster-count]")].map(
        (item) => `${item.getAttribute("data-roster-count")}:${item.textContent}`,
      ),
    ).toEqual(["done:4"]);
    expect(within(door).getByTestId("workflow-more-chevron")).toBeTruthy();
    expect(within(door).queryByTestId("workflow-more-open")).toBeNull();
    expect(within(section).queryByTestId("workflow-roster-roll")).toBeNull();
    expect(within(section).queryByTestId("workflow-agent-cell")).toBeNull();
    expect(within(section).queryByTestId("workflow-roster-meter")).toBeNull();
    expect(within(section).queryByTestId("workflow-roster-meter-mini")).toBeNull();
    expect(within(section).queryByTestId("workflow-run-phase-cluster")).toBeNull();
  });

  it("门后Yes名单：只有其余的人、按Statusgrouping、组头Yes计Count；再点门Collapse；名单里的行开 transcript 带 workspace scope", () => {
    fanoutSnapshot(60, (i) => (i === 1 || i === 7 ? "running" : i === 6 ? "failed" : "done"));
    const view = renderPane();
    const section = view.getByTestId("workflow-run-phase");
    const door = within(section).getByTestId("workflow-roster-more-row");
    expect(door.getAttribute("data-more-count")).toBe("55");
    expect(door.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(door);
    expect(door.getAttribute("aria-expanded")).toBe("true");
    expect(door.getAttribute("data-door")).toBe("open");
    expect(within(door).queryByTestId("workflow-roster-tally")).toBeNull();
    const roll = within(section).getByTestId("workflow-roster-roll");
    const headings = within(roll).getAllByTestId("workflow-roll-heading");
    expect(headings.map((heading) => heading.textContent)).toEqual(["55done"]);
    const rows = within(roll).getAllByTestId("workflow-agent-pill");
    expect(rows).toHaveLength(55);
    expect(rows.every((entry) => entry.getAttribute("data-pill-size") === "row")).toBe(true);
    const names = rows.map((entry) => entry.getAttribute("title"));
    for (const pinned of ["reviewer-6", "reviewer-1", "reviewer-7", "reviewer-2", "reviewer-3"]) {
      expect(names).not.toContain(pinned);
    }
    expect(names.slice(0, 3)).toEqual(["reviewer-4", "reviewer-5", "reviewer-8"]);
    const target = rows.find((entry) => entry.getAttribute("title") === "reviewer-5")!;
    expect(target.tagName).toBe("BUTTON");
    fireEvent.click(target);
    expect(onOpenWorkflowActorSession).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      runId: "dwfrun-1",
      actorSessionId: "dwf-dwfrun-1-actor_1@5",
      siteId: "actor#1",
      ordinal: 5,
      actorName: "reviewer-5",
    });
    fireEvent.click(door);
    expect(within(section).queryByTestId("workflow-roster-roll")).toBeNull();
    expect(within(door).getByTestId("workflow-roster-tally")).toBeTruthy();
  });

  it("名单按注意力序grouping：running、pending 在 done 前面；第六个Ask者落在名单里带 ?", () => {
    const asks = [1, 2, 3, 4, 5, 6].map((i) => ({
      qid: `q-${i}`,
      actorSiteId: "actor#1",
      actorOrdinal: i,
      question: `q ${i}`,
    }));
    fanoutSnapshot(9, (i) => (i === 7 ? "running" : i === 8 ? "pending" : "done"), asks);
    const view = renderPane();
    const section = view.getByTestId("workflow-run-phase");
    fireEvent.click(within(section).getByTestId("workflow-roster-more-row"));
    const roll = within(section).getByTestId("workflow-roster-roll");
    expect(
      within(roll)
        .getAllByTestId("workflow-roll-heading")
        .map((heading) => heading.getAttribute("data-roll-group")),
    ).toEqual(["running", "pending", "done"]);
    const rows = within(roll).getAllByTestId("workflow-agent-pill");
    expect(rows.map((entry) => entry.getAttribute("title"))).toEqual([
      "reviewer-7",
      "reviewer-8",
      "reviewer-6",
      "reviewer-9",
    ]);
    expect(within(rows[2]!).getByTestId("workflow-roll-asking")).toBeTruthy();
    expect(within(roll).queryByTestId("workflow-run-question")).toBeNull();
  });

  it("折From的名册站在节头带迷你量条而不Yes头像串", () => {
    fanoutSnapshot(9, mid);
    const view = renderPane();
    const section = view.getByTestId("workflow-run-phase");
    fireEvent.click(within(section).getByTestId("workflow-run-phase-toggle"));
    expect(section.getAttribute("data-phase-open")).toBe("false");
    expect(within(section).getByTestId("workflow-roster-meter-mini")).toBeTruthy();
    expect(within(section).queryByTestId("workflow-run-phase-cluster")).toBeNull();
    fanoutSnapshot(6, mid);
    const few = rerenderPane(view);
    const small = few.getByTestId("workflow-run-phase");
    fireEvent.click(within(small).getByTestId("workflow-run-phase-toggle"));
    expect(within(small).queryByTestId("workflow-roster-meter-mini")).toBeNull();
  });

  it("被淘汰的Sub-agent进门的人Count、计Count行、迷你量条与 settled/observed，名单末尾One行淡Character交代差额", () => {
    fanoutSnapshot(
      8,
      (i) => (i === 1 ? "running" : "done"),
      [],
      [{ phaseName: "review", actors: 300, actorsSettled: 300, actorsFailed: 2, settled: 300 }],
    );
    const view = renderPane();
    const section = view.getByTestId("workflow-run-phase");
    const door = within(section).getByTestId("workflow-roster-more-row");
    expect(door.getAttribute("data-more-count")).toBe("303");
    expect(door.getAttribute("title")).toBe("303 more subagents · list them here");
    expect(
      [
        ...within(door)
          .getByTestId("workflow-roster-tally")
          .querySelectorAll("[data-roster-count]"),
      ].map((item) => `${item.getAttribute("data-roster-count")}:${item.textContent}`),
    ).toEqual(["done:301", "failed:2"]);
    expect(within(section).getByTestId("workflow-run-phase-fraction").textContent).toBe("307/308");
    fireEvent.click(door);
    const roll = within(section).getByTestId("workflow-roster-roll");
    expect(within(roll).getAllByTestId("workflow-agent-pill")).toHaveLength(3);
    expect(
      within(roll)
        .getAllByTestId("workflow-roll-heading")
        .map((h) => h.textContent),
    ).toEqual(["3done"]);
    expect(within(roll).getByTestId("workflow-roll-unlisted").textContent).toBe(
      "300 more agents not listed",
    );
    fireEvent.click(within(section).getByTestId("workflow-run-phase-toggle"));
    expect(within(section).getByTestId("workflow-roster-meter-mini")).toBeTruthy();
  });

  it("四枚药丸加Three百个还没Run的被拒Sub-agent也Yes名册：门在，量条在，头像串不在，计Count行全Yes pending", () => {
    fanoutSnapshot(4, () => "running", [], [{ phaseName: "review", actors: 300, settled: 0 }]);
    const view = renderPane();
    const section = view.getByTestId("workflow-run-phase");
    expect(within(section).getAllByTestId("workflow-agent-pill")).toHaveLength(4);
    const door = within(section).getByTestId("workflow-roster-more-row");
    expect(door.getAttribute("data-more-count")).toBe("300");
    expect(
      [
        ...within(door)
          .getByTestId("workflow-roster-tally")
          .querySelectorAll("[data-roster-count]"),
      ].map((item) => `${item.getAttribute("data-roster-count")}:${item.textContent}`),
    ).toEqual(["pending:300"]);
    fireEvent.click(within(section).getByTestId("workflow-run-phase-toggle"));
    expect(within(section).getByTestId("workflow-roster-meter-mini")).toBeTruthy();
    expect(within(section).queryByTestId("workflow-run-phase-cluster")).toBeNull();
  });

  it("zh-CN：门的两种Copy与组头", () => {
    fanoutSnapshot(9, mid);
    const view = renderPane("zh-CN");
    const door = view.getByTestId("workflow-roster-more-row");
    expect(door.textContent).toContain("还有 4 个");
    expect(door.getAttribute("title")).toBe("还有 4 个Sub-agent · 在这里列出");
    fireEvent.click(door);
    expect(door.getAttribute("title")).toBe("还有 4 个Sub-agent · Collapse");
    expect(view.getByTestId("workflow-roll-heading").textContent).toBe("4个Completed");
  });

  const landedTree = (overrides: Partial<WorkflowRunSidePaneTab>) =>
    createElement(
      CfIntlProvider,
      { initialLocale: "en-US" },
      createElement(WorkflowRunSidePane, {
        tab: { ...tab, ...overrides },
        onOpenWorkflowActorSession,
      }),
    );

  it("tab 带 focusPhaseId：那One站展开、门开着、节头滚到顶并亮One下；换 openedAt 再落；不带就不落", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    fanoutSnapshot(9, () => "done");
    const view = render(landedTree({ focusPhaseId: "phase#a", openedAt: 1 }));
    const section = view.getByTestId("workflow-run-phase");
    expect(section.getAttribute("data-phase-open")).toBe("true");
    expect(section.getAttribute("data-phase-landed")).toBe("true");
    const head = within(section).getByTestId("workflow-run-phase-toggle");
    expect(head.className).toContain("wf-landed");
    expect(
      within(section).getByTestId("workflow-roster-more-row").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(within(section).getByTestId("workflow-roster-roll")).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(scrollIntoView.mock.instances[0]).toBe(head);
    view.rerender(landedTree({ focusPhaseId: "phase#a", openedAt: 2 }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    view.rerender(landedTree({ openedAt: 3 }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(view.getByTestId("workflow-run-phase").getAttribute("data-phase-open")).toBe("true");
  });

  it("亮One下YesOne次性的：1.2 s 后落点Label记退场，展开与名单留着", () => {
    vi.useFakeTimers();
    try {
      fanoutSnapshot(9, () => "done");
      const view = render(landedTree({ focusPhaseId: "phase#a", openedAt: 1 }));
      expect(view.getByTestId("workflow-run-phase").getAttribute("data-phase-landed")).toBe("true");
      act(() => {
        vi.advanceTimersByTime(1200);
      });
      const section = view.getByTestId("workflow-run-phase");
      expect(section.getAttribute("data-phase-landed")).toBeNull();
      expect(section.getAttribute("data-phase-open")).toBe("true");
      expect(within(section).getByTestId("workflow-roster-roll")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkflowRunSidePane lineage", () => {
  it.each([
    ["en-US", "Amends run"],
    ["zh-CN", "调整自 run"],
  ] as const)("修订出来的 run：Status头下One行「调整自 run X」：%s", (locale, label) => {
    setSnapshot({ run: run({ resumedFrom: "dwfrun-prev" }) });
    const view = renderPane(locale);
    const line = view.getByTestId("workflow-run-amends");
    expect(line.textContent).toContain(label);
    expect(line.textContent).toContain("dwfrun-prev");
    expect(view.queryByTestId("workflow-run-superseded-by")).toBeNull();
  });

  it("被替代的 run：Status词带原因，链接开后继的Details、带后继自己的发From行 id", () => {
    const successor = run({
      runId: "dwfrun-next",
      toolCallId: "tool-wf-2",
      resumedFrom: "dwfrun-1",
    });
    const predecessor = run({
      status: "stopped",
      stopReason: "superseded",
      supersededBy: "dwfrun-next",
    } as never);
    snapshot = {
      rows: { window: [graphRow] },
      workflowRuns: { revision: 1, runs: [predecessor, successor] },
    };
    const view = renderPane("en-US", { withOpenRunCallback: true });
    expect(view.getByTestId("workflow-run-status").textContent).toBe("Stopped");
    expect(view.getByTestId("workflow-run-status-reason").textContent).toContain("superseded");
    expect(view.queryByTestId("workflow-run-resume")).toBeNull();
    const link = view.getByTestId("workflow-run-superseded-by");
    expect(link.tagName).toBe("BUTTON");
    expect(link.textContent).toContain("Superseded by run");
    expect(link.textContent).toContain("dwfrun-next");
    fireEvent.click(link);
    expect(onOpenWorkflowRun).toHaveBeenCalledTimes(1);
    expect(onOpenWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        parentSessionId: "parent-a",
        runId: "dwfrun-next",
        toolCallId: "tool-wf-2",
        workspacePath: "/workspace",
      }),
    );
  });

  it("后继不在投影里时那One行Yes静态TextCharacter", () => {
    setSnapshot({
      run: run({
        status: "stopped",
        stopReason: "superseded",
        supersededBy: "dwfrun-gone",
      } as never),
    });
    const view = renderPane("zh-CN", { withOpenRunCallback: true });
    const line = view.getByTestId("workflow-run-superseded-by");
    expect(line.tagName).toBe("DIV");
    expect(line.textContent).toContain("已被替代，后继 run");
    expect(line.textContent).toContain("dwfrun-gone");
  });

  it("普通 run 没有 lineage 行", () => {
    setSnapshot({ run: run() });
    const view = renderPane();
    expect(view.queryByTestId("workflow-run-amends")).toBeNull();
    expect(view.queryByTestId("workflow-run-superseded-by")).toBeNull();
  });
});

describe("WorkflowRunSidePane Configuration", () => {
  beforeEach(() => {
    setDynamicWorkflowEnabled(true);
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    onOpenWorkflowRun.mockClear();
  });

  it("Status头两行：第One行名Character与 Configure → Resume → Stop，第Two行灯与Status词andConcurrency芯片", () => {
    setSnapshot({
      run: run({
        status: "stopped",
        stopReason: "user",
        resumable: true,
        concurrencyCeiling: 13,
        concurrency: { cap: 13, ceiling: 13, limit: 4 },
      }),
    });
    const view = renderPane();
    const configure = view.getByTestId("workflow-run-configure");
    const resume = view.getByTestId("workflow-run-resume");
    const cancel = view.getByTestId("workflow-run-cancel");
    expect(configure.textContent).toBe("Configure");
    expect(
      configure.compareDocumentPosition(resume) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(resume.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const statusRow = view.getByTestId("workflow-run-status-row");
    expect(statusRow.contains(view.getByTestId("workflow-run-status"))).toBe(true);
    expect(statusRow.contains(view.getByTestId("workflow-run-concurrency"))).toBe(true);
    expect(view.getByTestId("workflow-run-concurrency").textContent).toBe("Max concurrency 4");
    expect(statusRow.contains(configure)).toBe(false);
  });

  it.each([
    ["completed", run({ status: "completed" })],
    ["superseded", run({ status: "stopped", stopReason: "superseded", supersededBy: "run-next" })],
  ])("%s 的 run 不画Concurrency芯片，即便Boundary仍在天花板之下", (_case, state) => {
    setSnapshot({
      run: { ...state, concurrencyCeiling: 13, concurrency: { cap: 13, ceiling: 13, limit: 4 } },
    });
    const view = renderPane();
    expect(view.queryByTestId("workflow-run-concurrency")).toBeNull();
    expect(view.queryByTestId("workflow-run-configure")).toBeNull();
  });

  it.each([
    ["completed", run({ status: "completed" })],
    ["superseded", run({ status: "stopped", stopReason: "superseded", supersededBy: "run-next" })],
  ])("%s 的 run 没有 Configure，Model段只YesCharacter", (_case, state) => {
    setSnapshot({ run: { ...state, subagentModel: "zhipu/glm-5.3" } });
    const view = renderPane();
    expect(view.queryByTestId("workflow-run-configure")).toBeNull();
    expect(view.getByTestId("workflow-run-subagent-model").tagName).toBe("SPAN");
  });

  it("灰度关：没有 Configure", () => {
    setDynamicWorkflowEnabled(false);
    setSnapshot({ run: run() });
    expect(renderPane().queryByTestId("workflow-run-configure")).toBeNull();
  });

  it("zh-CN 念「Configuration」；能Configuration时Model段Yes按钮，点它与点 Configure 开的Yes同One个弹层", () => {
    setSnapshot({ run: run({ subagentModel: "zhipu/glm-5.3" }) });
    const view = renderPane("zh-CN");
    expect(view.getByTestId("workflow-run-configure").textContent).toBe("配置");
    const segment = view.getByTestId("workflow-run-subagent-model");
    expect(segment.tagName).toBe("BUTTON");
    fireEvent.click(segment);
    expect(segment.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-testid="workflow-run-settings-popover"]')).not.toBeNull();
  });

  it("Apply 发 amendWorkflowRunSettings {workId ≡ runId, 改过的Settings}；New run 进投影后 tab 原地换成它", async () => {
    sendCommand.mockImplementationOnce(
      async () =>
        ({
          status: "accepted",
          result: {
            type: "amendWorkflowRunSettings",
            runId: "dwfrun-2",
            toolCallId: "settings-1",
            supersededRunId: "dwfrun-1",
          },
        }) as never,
    );
    const current = run({
      concurrencyCeiling: 13,
      concurrency: { cap: 13, ceiling: 13, limit: 4 },
    });
    setSnapshot({ run: current });
    const view = renderPane("en-US", { withOpenRunCallback: true });
    fireEvent.click(view.getByTestId("workflow-run-configure"));
    fireEvent.click(
      document.querySelector('[data-testid="workflow-run-settings-bound-decrease"]')!,
    );
    await act(async () => {
      fireEvent.click(document.querySelector('[data-testid="workflow-run-settings-apply"]')!);
    });
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "amendWorkflowRunSettings",
        payload: { workId: "dwfrun-1", maxConcurrency: 3 },
        sessionId: "parent-a",
      }),
    );
    expect(onOpenWorkflowRun).not.toHaveBeenCalled();
    snapshot = {
      ...(snapshot as object),
      workflowRuns: {
        revision: 2,
        runs: [
          { ...current, status: "stopped", stopReason: "superseded", supersededBy: "dwfrun-2" },
          run({ runId: "dwfrun-2", toolCallId: "settings-1", resumedFrom: "dwfrun-1" }),
        ],
      },
    };
    view.rerender(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(WorkflowRunSidePane, { tab: { ...tab }, onOpenWorkflowRun }),
      ),
    );
    await waitFor(() => expect(onOpenWorkflowRun).toHaveBeenCalledTimes(1));
    expect(onOpenWorkflowRun).toHaveBeenCalledWith({
      workspacePath: "/workspace",
      parentSessionId: "parent-a",
      toolCallId: "settings-1",
      runId: "dwfrun-2",
      workflowName: "Fan-out review",
      replaceRunId: "dwfrun-1",
    });
  });

  it("就地生效的Result（runId Yes自己、无 supersededRunId）：不Request换 tab", async () => {
    sendCommand.mockImplementationOnce(
      async () =>
        ({
          status: "accepted",
          result: {
            type: "amendWorkflowRunSettings",
            runId: "dwfrun-1",
            toolCallId: "settings-1",
          },
        }) as never,
    );
    const current = run({
      concurrencyCeiling: 13,
      concurrency: { cap: 13, ceiling: 13, limit: 4 },
    });
    setSnapshot({ run: current });
    const view = renderPane("en-US", { withOpenRunCallback: true });
    fireEvent.click(view.getByTestId("workflow-run-configure"));
    fireEvent.click(
      document.querySelector('[data-testid="workflow-run-settings-bound-decrease"]')!,
    );
    expect(
      document.querySelector('[data-testid="workflow-run-settings-consequence"]')?.textContent,
    ).toBe("Applies to this run right away; no new run is started.");
    await act(async () => {
      fireEvent.click(document.querySelector('[data-testid="workflow-run-settings-apply"]')!);
    });
    expect(sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { workId: "dwfrun-1", maxConcurrency: 3 } }),
    );
    await act(async () => {});
    expect(onOpenWorkflowRun).not.toHaveBeenCalled();
  });

  it("「Configuration」出来的 run 在Settings轮落地之前借Predecessor的图；Settings轮落地后来龙去脉说「由你调整Settings」", () => {
    const settingsTab = { ...tab, toolCallId: "settings-1", runId: "dwfrun-2" };
    const predecessor = run({
      status: "stopped",
      stopReason: "superseded",
      supersededBy: "dwfrun-2",
    });
    const successor = run({ runId: "dwfrun-2", toolCallId: "settings-1", resumedFrom: "dwfrun-1" });
    snapshot = {
      rows: { window: [graphRow] },
      workflowRuns: { revision: 1, runs: [predecessor, successor] },
    };
    const borrowed = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(WorkflowRunSidePane, { tab: settingsTab }),
      ),
    );
    expect(borrowed.getByTestId("workflow-run-phases")).toBeTruthy();
    expect(borrowed.queryByTestId("workflow-run-provenance")).toBeNull();
    cleanup();

    const workflowLaunch = {
      runId: "dwfrun-2",
      toolCallId: "settings-1",
      name: "Fan-out review",
      display: graphRow.display,
      amend: {
        predecessorRunId: "dwfrun-1",
        subagentModel: { to: "zhipu/glm-5.3-flash" },
        maxConcurrency: { from: 13, to: 4 },
        ceiling: 13,
      },
    };
    snapshot = {
      rows: {
        window: [
          graphRow,
          {
            kind: "turnHeader" as const,
            rowId: "row-header",
            origin: "workflowLaunch" as const,
            executionKind: "controlOnly" as const,
            state: "completedSuccess" as const,
            startedAt: Date.UTC(2026, 8, 18, 4, 51),
            workflowLaunch,
          },
        ],
      },
      workflowRuns: { revision: 2, runs: [predecessor, successor] },
    };
    const landed = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(WorkflowRunSidePane, { tab: settingsTab }),
      ),
    );
    const provenance = landed.getByTestId("workflow-run-provenance");
    expect(provenance.getAttribute("data-workflow-launch-kind")).toBe("settings");
    expect(provenance.textContent).toContain("由你调整Settings");
    expect(landed.queryByTestId("workflow-run-provenance-scope")).toBeNull();
    const rows = landed.getByTestId("workflow-run-provenance-settings").textContent ?? "";
    expect(rows).toContain("Sub-agentModel");
    expect(rows).toContain("SessionModel → glm-5.3-flash");
    expect(rows).toContain("最大ConcurrencyCount");
    expect(rows).toContain("默认 13 → 4");
  });

  it("就地生效的Settings轮落在来龙去脉块上：没有Predecessor也照常念「由你调整Settings」与上限那One行", () => {
    const retuned = run({ runId: "dwfrun-1", toolCallId: "tool-1" });
    const retuneTab = { ...tab, toolCallId: "settings-9", runId: "dwfrun-1" };
    snapshot = {
      rows: {
        window: [
          graphRow,
          {
            kind: "turnHeader" as const,
            rowId: "row-retune",
            origin: "workflowLaunch" as const,
            executionKind: "controlOnly" as const,
            state: "completedSuccess" as const,
            startedAt: Date.UTC(2026, 8, 18, 4, 51),
            workflowLaunch: {
              runId: "dwfrun-1",
              toolCallId: "settings-9",
              name: "Fan-out review",
              amend: { maxConcurrency: { from: 13, to: 4 }, ceiling: 13 },
            },
          },
        ],
      },
      workflowRuns: { revision: 1, runs: [retuned] },
    };
    const view = render(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(WorkflowRunSidePane, { tab: retuneTab }),
      ),
    );
    const provenance = view.getByTestId("workflow-run-provenance");
    expect(provenance.getAttribute("data-workflow-launch-kind")).toBe("settings");
    expect(provenance.textContent).toContain("由你调整Settings");
    const rows = view.getByTestId("workflow-run-provenance-settings").textContent ?? "";
    expect(rows).toContain("最大ConcurrencyCount");
    expect(rows).toContain("默认 13 → 4");
    expect(rows).not.toContain("Sub-agentModel");
  });
});
