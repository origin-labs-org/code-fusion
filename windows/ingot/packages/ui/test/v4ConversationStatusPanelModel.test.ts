import { describe, expect, it } from "vitest";
import type { GitRepositorySummary } from "@origin-ai/cf-shared";
import type {
  BackgroundWorkSummary,
  GoalState,
  PlanState,
  ToolCallRow,
  WorkflowRunNode,
  WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  buildConversationStatusPanelModel,
  resolveSoleRunningWorkflowRunTarget,
  workflowRunOpenTarget,
} from "@/v4/conversationStatusPanelModel.js";
import {
  CONVERSATION_STATUS_PANEL_WIDE_OFFSET_CLASS_NAME,
  getConversationStatusPanelOffsetClassName,
  resolveConversationStatusPanelVariant,
  shouldUseConversationStatusPanelInlineLayout,
} from "@/v4/conversationLayout.js";

function gitSummary(overrides: Partial<GitRepositorySummary> = {}): GitRepositorySummary {
  return {
    workspacePath: "/repo",
    repoRoot: "/repo",
    workspaceInRepoPath: "",
    autoRefreshWatchPaths: [],
    branchName: "main",
    trackingBranchName: "origin/main",
    headRefType: "branch",
    ahead: 0,
    behind: 0,
    isDirty: true,
    isGitAvailable: true,
    isRepository: true,
    ...overrides,
  };
}

function goalState(overrides: Partial<GoalState> = {}): GoalState {
  return {
    objective: "修OK聊天渲染",
    status: "active",
    iteration: 2,
    verifications: [],
    ...overrides,
  };
}

function planState(overrides: Partial<PlanState> = {}): PlanState {
  return {
    updatedAt: 1_700_000_000_000,
    items: [
      { id: "1", content: "看OldImplementation", status: "completed" },
      { id: "2", content: "补Status卡", status: "inProgress" },
      { id: "3", content: "Run校验", status: "pending" },
    ],
    ...overrides,
  };
}

function backgroundWork(overrides: Partial<BackgroundWorkSummary> = {}): BackgroundWorkSummary {
  return {
    workId: "work-1",
    kind: "subagent",
    title: "explore代码",
    status: "running",
    startedAt: 1_700_000_000_000,
    anchorRowId: null,
    ...overrides,
  };
}

function workflowNode(
  overrides: Partial<WorkflowRunNode> & Pick<WorkflowRunNode, "phase">,
): WorkflowRunNode {
  return { siteId: "ask#1", ordinal: 1, ...overrides };
}

function workflowRun(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
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

function sessionPlan(rowId: number, overrides: Partial<ToolCallRow> = {}): ToolCallRow {
  return {
    rowId,
    turnId: `turn-${rowId}`,
    createdAt: 1_700_000_000_000 + rowId,
    createdAtSeq: rowId,
    kind: "toolCall",
    toolCallId: `plan-${rowId}`,
    toolName: "ExitPlanMode",
    status: "success",
    input: { plan: `# Plan ${rowId}` },
    inputText: JSON.stringify({ plan: `# Plan ${rowId}` }),
    ...overrides,
  };
}

describe("buildConversationStatusPanelModel", () => {
  it("aggregates git, goal, todo, and running background work", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary(),
      gitDirtyFileCount: 3,
      gitWorktreeChangeSummary: { added: 42, removed: 0 },
      goal: goalState(),
      plan: planState(),
      backgroundWorks: [
        backgroundWork(),
        backgroundWork({ workId: "work-bash", kind: "bash" }),
        backgroundWork({ workId: "work-2", status: "resultPending" }),
      ],
      runningSubagents: [
        {
          childSessionId: "child-1",
          subagentType: "Explore",
          title: "explore代码",
          status: "running",
          startedAt: 1_700_000_000_000,
        },
      ],
    });

    expect(model.hasContent).toBe(true);
    expect(model.git).toMatchObject({
      added: 42,
      removed: 0,
      dirtyFileCount: 3,
      isClean: false,
    });
    expect(model.goal?.objective).toBe("修OK聊天渲染");
    expect(model.plan).toMatchObject({
      completedCount: 1,
      waitingCount: 2,
      totalCount: 3,
    });
    expect(model.runningBashWorks.map((work) => work.workId)).toEqual(["work-bash"]);
    expect(model.runningSubagentWorks.map((work) => work.childSessionId)).toEqual(["child-1"]);
  });

  it("routes a running dwf workflow work into the workflow section instead of Terminals", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [backgroundWork({ workId: "dwfrun-1", kind: "workflow" })],
      workflowRuns: [workflowRun({ runId: "dwfrun-1" })],
    });

    expect(model.hasContent).toBe(true);
    expect(model.runningWorkflowRuns.map((row) => row.runId)).toEqual(["dwfrun-1"]);
    expect(model.runningBashWorks).toEqual([]);
  });

  it("joins each active run with its background work by workId ≡ runId", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({
          workId: "dwfrun-1",
          kind: "workflow",
          title: "重构Status胶囊",
          startedAt: 1_700_000_000_500,
          cancellable: true,
        }),
      ],
      workflowRuns: [
        workflowRun({
          runId: "dwfrun-1",
          toolCallId: "tool-wf-9",
          nodes: [
            workflowNode({ phase: "settled" }),
            workflowNode({ ordinal: 2, phase: "queued" }),
          ],
        }),
      ],
    });

    expect(model.runningWorkflowRuns).toEqual([
      {
        runId: "dwfrun-1",
        toolCallId: "tool-wf-9",
        status: "running",
        nodesSettled: 1,
        nodesTotal: 2,
        phases: [],
        title: "重构Status胶囊",
        startedAt: 1_700_000_000_500,
        workId: "dwfrun-1",
        cancellable: true,
      },
    ]);
  });

  it("keeps a run without background work as a status-only row", () => {
    const model = buildConversationStatusPanelModel({
      workflowRuns: [
        workflowRun({ runId: "dwfrun-lonely", nodes: [workflowNode({ phase: "settled" })] }),
      ],
    });

    expect(model.hasContent).toBe(true);
    expect(model.runningWorkflowRuns).toEqual([
      {
        runId: "dwfrun-lonely",
        toolCallId: "tool-wf-1",
        status: "running",
        nodesSettled: 1,
        nodesTotal: 1,
        phases: [],
      },
    ]);
  });

  it("degrades a workflow work with no matching run into a title-and-stop row", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({
          workId: "dwfrun-skew",
          kind: "workflow",
          title: "Old CLI 的 run",
          startedAt: 1_700_000_001_000,
        }),
      ],
      workflowRuns: [],
    });

    expect(model.runningWorkflowRuns).toEqual([
      {
        runId: "dwfrun-skew",
        workId: "dwfrun-skew",
        title: "Old CLI 的 run",
        startedAt: 1_700_000_001_000,
        cancellable: true,
      },
    ]);
    expect(model.runningWorkflowRuns[0]).not.toHaveProperty("status");
    expect(model.runningWorkflowRuns[0]).not.toHaveProperty("nodesSettled");
    expect(model.runningWorkflowRuns[0]).not.toHaveProperty("phases");
    expect(model.runningWorkflowRuns[0]).not.toHaveProperty("toolCallId");
    expect(model.hasContent).toBe(true);
  });

  it("carries the sidebar's phase list and the current phase on a live row", () => {
    const model = buildConversationStatusPanelModel({
      workflowRuns: [
        workflowRun({
          runId: "dwfrun-1",
          phaseNames: ["盘点", "计划", "构建"],
          phases: [{ name: "盘点", rounds: 1 }],
          currentPhase: "计划",
        }),
      ],
    });

    expect(model.runningWorkflowRuns[0]?.phases).toEqual([
      { name: "盘点", status: "done" },
      { name: "计划", status: "running" },
      { name: "构建", status: "pending" },
    ]);
    expect(model.runningWorkflowRuns[0]?.currentPhase).toBe("计划");
  });

  it("appends degraded skew rows after the run-backed rows", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({ workId: "dwfrun-skew", kind: "workflow" }),
        backgroundWork({ workId: "dwfrun-2", kind: "workflow" }),
      ],
      workflowRuns: [workflowRun({ runId: "dwfrun-1" }), workflowRun({ runId: "dwfrun-2" })],
    });

    expect(model.runningWorkflowRuns.map((row) => row.runId)).toEqual([
      "dwfrun-1",
      "dwfrun-2",
      "dwfrun-skew",
    ]);
  });

  it("counts pending as active and drops terminal runs from the section", () => {
    const model = buildConversationStatusPanelModel({
      workflowRuns: [
        workflowRun({ runId: "dwfrun-pending", status: "pending" }),
        workflowRun({ runId: "dwfrun-running", status: "running" }),
        workflowRun({ runId: "dwfrun-completed", status: "completed" }),
        workflowRun({ runId: "dwfrun-failed", status: "failed" }),
        workflowRun({ runId: "dwfrun-cancelled", status: "cancelled" }),
      ],
    });

    expect(model.runningWorkflowRuns.map((row) => row.runId)).toEqual([
      "dwfrun-pending",
      "dwfrun-running",
    ]);
    expect(model.runningWorkflowRuns[0]?.status).toBe("pending");
  });

  it("preserves projection order for active runs", () => {
    const model = buildConversationStatusPanelModel({
      workflowRuns: [
        workflowRun({ runId: "dwfrun-c" }),
        workflowRun({ runId: "dwfrun-a", status: "completed" }),
        workflowRun({ runId: "dwfrun-b", status: "pending" }),
      ],
    });

    expect(model.runningWorkflowRuns.map((row) => row.runId)).toEqual(["dwfrun-c", "dwfrun-b"]);
  });

  it("counts settled over observed nodes through the shared card helper", () => {
    const model = buildConversationStatusPanelModel({
      workflowRuns: [
        workflowRun({
          nodes: [
            workflowNode({ phase: "settled", outcome: "ok" }),
            workflowNode({ ordinal: 2, phase: "settled", outcome: "failed" }),
            workflowNode({ ordinal: 3, phase: "settled", outcome: "cancelled" }),
            workflowNode({ ordinal: 4, phase: "dispatched" }),
            workflowNode({ ordinal: 5, phase: "repairing" }),
            workflowNode({ ordinal: 6, phase: "nudged" }),
            workflowNode({ ordinal: 7, phase: "queued" }),
          ],
        }),
      ],
    });

    expect(model.runningWorkflowRuns[0]).toMatchObject({ nodesSettled: 3, nodesTotal: 7 });
  });

  it("keeps title and elapsed from a settled work while dropping only its Stop control", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({
          workId: "dwfrun-1",
          kind: "workflow",
          status: "resultPending",
          title: "Result待投递的Workflow",
          startedAt: 1_700_000_002_000,
          cancellable: true,
        }),
        backgroundWork({ workId: "work-bash", kind: "bash" }),
      ],
      workflowRuns: [workflowRun({ runId: "dwfrun-1" })],
    });

    expect(model.runningWorkflowRuns).toEqual([
      {
        runId: "dwfrun-1",
        toolCallId: "tool-wf-1",
        status: "running",
        nodesSettled: 0,
        nodesTotal: 0,
        phases: [],
        title: "Result待投递的Workflow",
        startedAt: 1_700_000_002_000,
      },
    ]);
    expect(model.runningWorkflowRuns[0]).not.toHaveProperty("workId");
    expect(model.runningWorkflowRuns[0]).not.toHaveProperty("cancellable");
    expect(model.runningBashWorks.map((work) => work.workId)).toEqual(["work-bash"]);
  });

  it("gates the Stop control on the work still running", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({ workId: "dwfrun-1", kind: "workflow", cancellable: false }),
      ],
      workflowRuns: [workflowRun({ runId: "dwfrun-1" })],
    });

    expect(model.runningWorkflowRuns[0]).toMatchObject({
      workId: "dwfrun-1",
      cancellable: false,
    });
  });

  it("does not degrade a settled workflow work with no run into a row", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({ workId: "dwfrun-gone", kind: "workflow", status: "resultPending" }),
        backgroundWork({ workId: "dwfrun-failed", kind: "workflow", status: "failed" }),
        backgroundWork({ workId: "dwfrun-cancelled", kind: "workflow", status: "cancelled" }),
      ],
      workflowRuns: [],
    });

    expect(model.runningWorkflowRuns).toEqual([]);
    expect(model.hasContent).toBe(false);
  });

  it("stays empty without repository or session status", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary({ isRepository: false }),
      gitDirtyFileCount: 0,
      gitWorktreeChangeSummary: { added: 0, removed: 0 },
      goal: null,
      plan: null,
      backgroundWorks: [],
    });

    expect(model.hasContent).toBe(false);
    expect(model.git).toBeNull();
  });

  it("keeps the complete Todo projection in snapshot order when statuses are mixed", () => {
    const model = buildConversationStatusPanelModel({
      plan: planState({
        items: [
          { id: "done-1", content: "CompletedOne", status: "completed" },
          { id: "active", content: "进行中", status: "inProgress" },
          { id: "pending", content: "待Processing", status: "pending" },
          { id: "done-2", content: "CompletedTwo", status: "completed" },
          { id: "pending-2", content: "待ProcessingTwo", status: "pending" },
        ],
      }),
    });

    expect(model.plan?.displayItems.map((item) => item.id)).toEqual([
      "done-1",
      "active",
      "pending",
      "done-2",
      "pending-2",
    ]);
  });

  it("joins running Agent controls only by exact child session identity", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({
          workId: "agent-control-work",
          childSessionId: "child-match",
          cancellable: true,
        }),
        backgroundWork({
          workId: "agent-disabled-work",
          childSessionId: "child-disabled",
          cancellable: false,
        }),
        backgroundWork({
          workId: "agent-terminal-work",
          childSessionId: "child-terminal",
          status: "cancelled",
        }),
        backgroundWork({
          workId: "agent-ambiguous-a",
          childSessionId: "child-ambiguous",
        }),
        backgroundWork({
          workId: "agent-ambiguous-b",
          childSessionId: "child-ambiguous",
        }),
      ],
      runningSubagents: [
        {
          childSessionId: "child-match",
          subagentType: "Explore",
          title: "E同Title",
          status: "running",
        },
        {
          childSessionId: "child-disabled",
          subagentType: "Explore",
          title: "不可Stop",
          status: "running",
        },
        {
          childSessionId: "child-foreground",
          subagentType: "Explore",
          title: "E同Title",
          status: "running",
        },
        {
          childSessionId: "child-ambiguous",
          subagentType: "Explore",
          title: "身份重复",
          status: "running",
        },
      ],
    });

    expect(model.runningSubagentWorks).toMatchObject([
      {
        childSessionId: "child-match",
        controlWorkId: "agent-control-work",
        cancellable: true,
      },
      {
        childSessionId: "child-disabled",
        controlWorkId: "agent-disabled-work",
        cancellable: false,
      },
      {
        childSessionId: "child-foreground",
      },
      {
        childSessionId: "child-ambiguous",
      },
    ]);
    expect(model.runningSubagentWorks[2]).not.toHaveProperty("controlWorkId");
    expect(model.runningSubagentWorks[3]).not.toHaveProperty("controlWorkId");
  });

  it("keeps a uniquely identified running Agent controllable while directory projection catches up", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({
          workId: "agent-runtime-work",
          childSessionId: "child-runtime",
          title: "Running的 Agent",
          blocked: true,
          cancellable: true,
        }),
        backgroundWork({
          workId: "ambiguous-a",
          childSessionId: "child-ambiguous",
        }),
        backgroundWork({
          workId: "ambiguous-b",
          childSessionId: "child-ambiguous",
        }),
      ],
      runningSubagents: [],
    });

    expect(model.runningSubagentWorks).toEqual([
      expect.objectContaining({
        agentId: "agent-runtime-work",
        childSessionId: "child-runtime",
        controlWorkId: "agent-runtime-work",
        status: "blocked",
        title: "Running的 Agent",
      }),
    ]);
  });

  it("does not show git tools for a clean repository without worktree line changes", () => {
    const model = buildConversationStatusPanelModel({
      gitSummary: gitSummary({ isDirty: false, ahead: 0 }),
      gitDirtyFileCount: 0,
      gitWorktreeChangeSummary: { added: 0, removed: 0 },
      goal: null,
      plan: null,
      backgroundWorks: [],
    });

    expect(model.hasContent).toBe(false);
    expect(model.git).toBeNull();
  });

  it("lists only terminal ExitPlanMode rows with markdown, newest first", () => {
    const model = buildConversationStatusPanelModel({
      workspacePath: "/repo",
      sessionPlans: [
        sessionPlan(4, { status: "cancelled" }),
        sessionPlan(8, { status: "error", input: { plan: "# 最NewPlan" } }),
        sessionPlan(9, { status: "running" }),
        sessionPlan(10, { toolName: "Write" }),
        sessionPlan(11, { input: {}, inputText: "{}" }),
      ],
    });

    expect(model.hasContent).toBe(true);
    expect(model.sessionPlans?.items.map((item) => item.toolCallId)).toEqual(["plan-8", "plan-4"]);
    expect(model.sessionPlans?.items[0]?.title).toBe("最NewPlan");
  });
});

describe("conversation status panel layout", () => {
  it("maps the status panel layout to its offset class", () => {
    expect(getConversationStatusPanelOffsetClassName("auto")).toBe(
      CONVERSATION_STATUS_PANEL_WIDE_OFFSET_CLASS_NAME,
    );
    expect(getConversationStatusPanelOffsetClassName("inline")).toBe(
      CONVERSATION_STATUS_PANEL_WIDE_OFFSET_CLASS_NAME,
    );
    expect(getConversationStatusPanelOffsetClassName("none")).toBeUndefined();
  });

  it("preserves manual variants while leaving auto mode to CSS", () => {
    expect(
      resolveConversationStatusPanelVariant({
        variantOverride: "mini",
      }),
    ).toBe("mini");
    expect(
      resolveConversationStatusPanelVariant({
        variantOverride: null,
      }),
    ).toBe("auto");
  });

  it("only applies inline offset when content can render in expanded inline mode", () => {
    expect(
      shouldUseConversationStatusPanelInlineLayout({
        hasContent: true,
        variant: "auto",
      }),
    ).toBe(true);
    expect(
      shouldUseConversationStatusPanelInlineLayout({
        hasContent: false,
        variant: "panel",
      }),
    ).toBe(false);
    expect(
      shouldUseConversationStatusPanelInlineLayout({
        hasContent: true,
        variant: "mini",
      }),
    ).toBe(false);
  });
});

describe("resolveSoleRunningWorkflowRunTarget", () => {
  const workflowWork = backgroundWork({
    workId: "dwfrun-1",
    kind: "workflow",
    title: "发布前检查",
    startedAt: 1_700_000_000_000,
  });

  it("returns the open target when the only running activity is one workflow run", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [workflowWork],
      workflowRuns: [workflowRun()],
    });

    expect(resolveSoleRunningWorkflowRunTarget(model)).toEqual({
      runId: "dwfrun-1",
      toolCallId: "tool-wf-1",
      workflowName: "发布前检查",
    });
  });

  it("treats a pending run as running and omits the name when the title is the id", () => {
    const model = buildConversationStatusPanelModel({
      backgroundWorks: [
        backgroundWork({ workId: "dwfrun-1", kind: "workflow", title: "dwfrun-1" }),
      ],
      workflowRuns: [workflowRun({ status: "pending" })],
    });

    expect(resolveSoleRunningWorkflowRunTarget(model)).toEqual({
      runId: "dwfrun-1",
      toolCallId: "tool-wf-1",
    });
  });

  it("returns null once a terminal or a subagent runs alongside the workflow", () => {
    const withBash = buildConversationStatusPanelModel({
      backgroundWorks: [workflowWork, backgroundWork({ workId: "bash-1", kind: "bash" })],
      workflowRuns: [workflowRun()],
    });
    expect(resolveSoleRunningWorkflowRunTarget(withBash)).toBeNull();

    const withSubagent = buildConversationStatusPanelModel({
      backgroundWorks: [workflowWork],
      workflowRuns: [workflowRun()],
      runningSubagents: [
        {
          childSessionId: "child-1",
          agentId: "agent-1",
          subagentType: "Explore",
          title: "Analysis",
          status: "running",
        },
      ],
    });
    expect(resolveSoleRunningWorkflowRunTarget(withSubagent)).toBeNull();
  });

  it("returns null for two workflow runs and for a sole run without a tool call id", () => {
    const two = buildConversationStatusPanelModel({
      backgroundWorks: [workflowWork, backgroundWork({ workId: "dwfrun-2", kind: "workflow" })],
      workflowRuns: [workflowRun(), workflowRun({ runId: "dwfrun-2", toolCallId: "tool-wf-2" })],
    });
    expect(resolveSoleRunningWorkflowRunTarget(two)).toBeNull();

    const withoutToolCallId = buildConversationStatusPanelModel({
      backgroundWorks: [workflowWork],
      workflowRuns: [workflowRun({ toolCallId: undefined })],
    });
    expect(resolveSoleRunningWorkflowRunTarget(withoutToolCallId)).toBeNull();

    const degraded = buildConversationStatusPanelModel({
      backgroundWorks: [workflowWork],
      workflowRuns: [],
    });
    expect(degraded.runningWorkflowRuns).toHaveLength(1);
    expect(resolveSoleRunningWorkflowRunTarget(degraded)).toBeNull();

    expect(resolveSoleRunningWorkflowRunTarget(buildConversationStatusPanelModel({}))).toBeNull();
  });

  it("shares the row-to-target conversion with the panel row", () => {
    expect(workflowRunOpenTarget({ runId: "r", toolCallId: "t", title: "名Character" })).toEqual({
      runId: "r",
      toolCallId: "t",
      workflowName: "名Character",
    });
    expect(workflowRunOpenTarget({ runId: "r", toolCallId: "t", title: "r" })).toEqual({
      runId: "r",
      toolCallId: "t",
    });
    expect(workflowRunOpenTarget({ runId: "r", title: "名Character" })).toBeNull();
  });
});

describe("General Mode Git 投影", () => {
  it("Hide Git 但RetainTargetandPlan，切回后恢复Raw Git Data", () => {
    const input = {
      gitSummary: gitSummary(),
      gitWorktreeChangeSummary: { added: 7, removed: 2 },
      goal: goalState(),
      plan: planState(),
    };
    const original = JSON.stringify(input);
    const coding = buildConversationStatusPanelModel(input);
    const general = buildConversationStatusPanelModel({ ...input, isOfficeMode: true });
    expect(general.git).toBeNull();
    expect(general.goal).toEqual(coding.goal);
    expect(general.plan).toEqual(coding.plan);
    expect(general.hasContent).toBe(true);
    expect(buildConversationStatusPanelModel(input).git).toMatchObject({ added: 7, removed: 2 });
    expect(JSON.stringify(input)).toBe(original);
  });
});
