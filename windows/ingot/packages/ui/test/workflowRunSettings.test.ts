import { describe, expect, it } from "vitest";
import type { WorkflowRunState, WorkflowSettingsAmendMeta } from "@origin-ai/cf-shared/cf-protocol-v4";
import {
  clampWorkflowRunSettingsBound,
  describeWorkflowRunSettingsRejection,
  initialWorkflowRunSettingsDraft,
  isWorkflowRunConfigurable,
  workflowRunDefaultConcurrency,
  workflowRunSettingsChange,
  workflowRunSettingsConsequenceId,
  workflowRunSettingsRejectionDetail,
  workflowRunSettingsRejectionMessageId,
  workflowSessionModelOf,
  type WorkflowRunSettingsDraft,
} from "@/components/workflow-timeline/workflowRunSettings.js";
import {
  workflowSettingsChangeSegments,
  workflowSettingsProvenanceRows,
} from "@/components/workflow-timeline/workflowSettingsChange.js";
import {
  openWorkflowRunSidePane,
  replaceWorkflowRunSidePane,
  type WorkflowRunSidePaneTab,
} from "@/lib/workspaceSidePane.js";
import { resolveWorkflowRunGraph } from "@/v4/workflowRunCardJoin.js";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";

function run(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "run-a",
    toolCallId: "tool-a",
    status: "running",
    usage: { spentTokens: 0, nodesUsed: 0 },
    actors: [],
    nodes: [],
    lastEventSequence: 0,
    ...overrides,
  };
}

function formatterFor(messages: Record<string, string>) {
  return (descriptor: { id: string }, values?: Record<string, string | number>) => {
    let text = messages[descriptor.id] ?? descriptor.id;
    for (const [key, value] of Object.entries(values ?? {})) {
      text = text.replaceAll(`{${key}}`, String(value));
    }
    return text;
  };
}

describe("isWorkflowRunConfigurable", () => {
  it.each([
    ["pending", run({ status: "pending" }), true],
    ["running", run(), true],
    ["errored（换个ModelRetry）", run({ status: "errored" }), true],
    ["stopped（可恢复）", run({ status: "stopped", stopReason: "user", resumable: true }), true],
    [
      "stopped · superseded（活的Yes后继）",
      run({ status: "stopped", stopReason: "superseded", supersededBy: "run-b" }),
      false,
    ],
    ["completed（每个 ask 都会从CacheReplay）", run({ status: "completed" }), false],
    ["不在投影里", undefined, false],
  ] as const)("%s", (_case, state, expected) => {
    expect(isWorkflowRunConfigurable(state)).toBe(expected);
  });
});

describe("表单From点", () => {
  it("两项都取 run 自己的Settings：Model拆出Thinking档，上限取本 run 的Boundary", () => {
    const draft = initialWorkflowRunSettingsDraft(
      run({
        subagentModel: "zhipu/glm-5.3$high",
        concurrencyCeiling: 13,
        concurrency: { cap: 13, ceiling: 13, limit: 4 },
      }),
    );
    expect(draft).toEqual({
      model: { kind: "model", providerId: "zhipu", modelId: "glm-5.3", level: "high" },
      bound: 4,
    });
  });

  it("没Point to定过Model = SessionModel；没有自己的Boundary = 停在Default上；Default也Unknown = null", () => {
    expect(initialWorkflowRunSettingsDraft(run({ concurrencyCeiling: 13 }))).toEqual({
      model: { kind: "session" },
      bound: 13,
    });
    expect(initialWorkflowRunSettingsDraft(run()).bound).toBeNull();
  });

  it("DefaultConcurrency只读 run.concurrencyCeiling：老 CLI 芯片的水位Yes学到的 cap，不YesDefault，不拿来顶替", () => {
    expect(workflowRunDefaultConcurrency(run({ concurrencyCeiling: 12 }))).toBe(12);
    expect(
      workflowRunDefaultConcurrency(run({ concurrency: { cap: 2, ceiling: 2, limit: 1 } })),
    ).toBeUndefined();
    expect(workflowRunDefaultConcurrency(run())).toBeUndefined();
  });

  it("有自己的Boundary、且High于Default：From点就Yes那个Boundary", () => {
    expect(
      initialWorkflowRunSettingsDraft(
        run({ concurrencyCeiling: 8, concurrency: { cap: 8, ceiling: 8, limit: 20 } }),
      ).bound,
    ).toBe(20);
  });
});

describe("workflowRunSettingsChange：只发改过的", () => {
  const initial: WorkflowRunSettingsDraft = {
    model: { kind: "model", providerId: "zhipu", modelId: "glm-5.3", level: "high" },
    bound: 4,
  };

  it("两项都没变 → 没有可发的（Apply 禁用）", () => {
    expect(workflowRunSettingsChange(initial, { ...initial }, 13)).toBeUndefined();
  });

  it("只改上限：省OmittedModel", () => {
    expect(workflowRunSettingsChange(initial, { ...initial, bound: 2 }, 13)).toEqual({
      maxConcurrency: 2,
    });
  });

  it("上限到Default = 解除本 run 自己的Boundary：发 null", () => {
    expect(workflowRunSettingsChange(initial, { ...initial, bound: 13 }, 13)).toEqual({
      maxConcurrency: null,
    });
  });

  it("Default之上YesOne个真的Count：原样发出去，不Yes解除", () => {
    expect(workflowRunSettingsChange(initial, { ...initial, bound: 40 }, 13)).toEqual({
      maxConcurrency: 40,
    });
    const raised: WorkflowRunSettingsDraft = { model: { kind: "session" }, bound: 40 };
    expect(workflowRunSettingsChange(raised, { ...raised, bound: 13 }, 13)).toEqual({
      maxConcurrency: null,
    });
  });

  it("From点就在Default上，停在那里不算改", () => {
    const atCeiling: WorkflowRunSettingsDraft = { model: { kind: "session" }, bound: 13 };
    expect(workflowRunSettingsChange(atCeiling, { ...atCeiling }, 13)).toBeUndefined();
  });

  it("换Model发规范串；只换Thinking档也算换了Model", () => {
    expect(
      workflowRunSettingsChange(
        initial,
        { ...initial, model: { kind: "model", providerId: "zhipu", modelId: "glm-5.3-flash" } },
        13,
      ),
    ).toEqual({ subagentModel: "zhipu/glm-5.3-flash" });
    expect(
      workflowRunSettingsChange(
        initial,
        {
          ...initial,
          model: { kind: "model", providerId: "zhipu", modelId: "glm-5.3", level: "low" },
        },
        13,
      ),
    ).toEqual({ subagentModel: "zhipu/glm-5.3$low" });
  });

  it("回到SessionModel：发 null；两项OneFrom改就OneFrom发", () => {
    expect(
      workflowRunSettingsChange(initial, { model: { kind: "session" }, bound: 6 }, 13),
    ).toEqual({ subagentModel: null, maxConcurrency: 6 });
  });

  it("Default unknown时Count就YesCount，不会被读成解除", () => {
    expect(workflowRunSettingsChange(initial, { ...initial, bound: 40 }, undefined)).toEqual({
      maxConcurrency: 40,
    });
  });

  it("步进器只有下限 1、没有上限：DefaultYesFrom点不Yes天花板", () => {
    expect(clampWorkflowRunSettingsBound(0)).toBe(1);
    expect(clampWorkflowRunSettingsBound(20)).toBe(20);
    expect(clampWorkflowRunSettingsBound(2.7)).toBe(2);
    expect(clampWorkflowRunSettingsBound(500)).toBe(500);
  });
});

describe("后果句与Deny", () => {
  const en = formatterFor(enUS);
  const zh = formatterFor(zhCN);

  const modelChange = { subagentModel: "zhipu/glm-5.3" };

  it("后果句随 run Status换；running 的ChineseYesUser定下的原句", () => {
    expect(zh({ id: workflowRunSettingsConsequenceId("running", modelChange)! })).toBe(
      "kStopCurrentRun，以NewSettings另FromOne次Run，Completed的Steps会Retain。",
    );
    expect(en({ id: workflowRunSettingsConsequenceId("pending", modelChange)! })).toBe(
      "Starts a new run with these settings; this one has not begun any step yet.",
    );
    expect(zh({ id: workflowRunSettingsConsequenceId("stopped", modelChange)! })).toBe(
      "k以NewSettings另FromOne次Run接着Run，Completed的Steps会Retain。",
    );
    expect(en({ id: workflowRunSettingsConsequenceId("errored", modelChange)! })).toBe(
      "Retries as a new run with these settings; finished steps are kept.",
    );
  });

  it.each(["running", "pending", "stopped", "errored"] as const)(
    "%s 的 run 什么都还没改：没有后果句",
    (status) => {
      expect(workflowRunSettingsConsequenceId(status, undefined)).toBeUndefined();
    },
  );

  it("在Run的 run 只改Concurrency上限：后果句换成「就地生效」", () => {
    expect(zh({ id: workflowRunSettingsConsequenceId("running", { maxConcurrency: 3 })! })).toBe(
      "立即应用到CurrentRun，不会NewFromOne次Run。",
    );
    expect(en({ id: workflowRunSettingsConsequenceId("running", { maxConcurrency: null })! })).toBe(
      "Applies to this run right away; no new run is started.",
    );
  });

  it.each([
    ["还改了Model", "running" as const, { maxConcurrency: 3, subagentModel: "zhipu/glm-5.3" }],
    ["只改了Model", "running" as const, { subagentModel: null }],
  ])("%s：仍Yes「另FromOne次Run」的原句", (_case, status, change) => {
    expect(workflowRunSettingsConsequenceId(status, change)).toBe(
      "chat.toolCall.workflow.run.settings.consequence.running",
    );
  });

  it.each([
    ["pending", "pending" as const],
    ["stopped", "stopped" as const],
    ["errored", "errored" as const],
  ])("%s 的 run 不在飞：就地生效无从谈From，仍念各自的原句", (_case, status) => {
    expect(workflowRunSettingsConsequenceId(status, { maxConcurrency: 3 })).toBe(
      `chat.toolCall.workflow.run.settings.consequence.${status}`,
    );
  });

  it("词表inner的 reason 反查成One句话；compile_failed 的Diagnostics进细节块", () => {
    const rejection = describeWorkflowRunSettingsRejection({
      status: "rejected",
      reasonCode: "fault.command.workflowRunSettingsRejected.compile_failed",
      message: "L3:C1 boom",
    });
    expect(rejection).toEqual({
      reason: "compile_failed",
      code: "fault.command.workflowRunSettingsRejected.compile_failed",
      message: "L3:C1 boom",
    });
    expect(workflowRunSettingsRejectionDetail(rejection!)).toBe("L3:C1 boom");
    expect(en({ id: workflowRunSettingsRejectionMessageId(rejection!) })).toContain(
      "no longer compiles",
    );
  });

  it("start_failed 的原因嵌进那句话，不再重复One个细节块", () => {
    const rejection = describeWorkflowRunSettingsRejection({
      status: "rejected",
      reasonCode: "fault.command.workflowRunSettingsRejected.start_failed",
      message: "port gone",
    })!;
    expect(workflowRunSettingsRejectionDetail(rejection)).toBeUndefined();
    expect(
      en({ id: workflowRunSettingsRejectionMessageId(rejection) }, { message: "port gone" }),
    ).toBe("The new run could not be started (port gone).");
  });

  it("Capabilities缺席 → unsupported；词表outer → generic 带 code；accepted / noop 不YesDeny", () => {
    expect(
      describeWorkflowRunSettingsRejection({
        status: "rejected",
        reasonCode: "fault.command.capabilityUnsupported",
      })?.reason,
    ).toBe("unsupported");
    const generic = describeWorkflowRunSettingsRejection({
      status: "failed",
      reasonCode: "fault.command.workflowRunSettingsRejected.bogus",
    })!;
    expect(generic.reason).toBe("generic");
    expect(zh({ id: workflowRunSettingsRejectionMessageId(generic) }, { code: generic.code })).toBe(
      "Settings没能调整（fault.command.workflowRunSettingsRejected.bogus）。",
    );
    expect(describeWorkflowRunSettingsRejection({ status: "accepted" })).toBeUndefined();
    expect(describeWorkflowRunSettingsRejection({ status: "noop" })).toBeUndefined();
  });

  it("每个 reason 在两种语言里都有词条", () => {
    for (const reason of [
      "not_found",
      "not_configurable",
      "unchanged",
      "script_missing",
      "model_unavailable",
      "compile_failed",
      "missing_boundaries",
      "start_failed",
      "unsupported",
      "generic",
    ]) {
      const id = `chat.toolCall.workflow.run.settings.rejection.${reason}`;
      expect(enUS[id], id).toBeTruthy();
      expect(zhCN[id], id).toBeTruthy();
    }
  });
});

describe("SessionModel", () => {
  it("优先持久的稀疏选择，Returned provider / model 投影，都读不出即缺席", () => {
    expect(
      workflowSessionModelOf({
        modelSelection: { providerId: "zhipu", modelId: "glm-5.3" },
        provider: "x",
        model: "y",
      }),
    ).toEqual({ providerId: "zhipu", modelId: "glm-5.3" });
    expect(workflowSessionModelOf({ provider: "zhipu", model: "glm-5.3" })).toEqual({
      providerId: "zhipu",
      modelId: "glm-5.3",
    });
    expect(workflowSessionModelOf({ provider: "", model: "" })).toBeUndefined();
    expect(workflowSessionModelOf(undefined)).toBeUndefined();
  });
});

describe("Settings轮的措辞", () => {
  const both: WorkflowSettingsAmendMeta = {
    predecessorRunId: "run-a",
    subagentModel: { from: "zhipu/glm-5.3", to: "zhipu/glm-5.3-flash$high" },
    maxConcurrency: { to: 4 },
    ceiling: 13,
  };

  it("转写行：Model在前、上限在后，只写改过的；English与Chinese", () => {
    expect(workflowSettingsChangeSegments(both, { formatMessage: formatterFor(enUS) })).toEqual([
      "subagents on glm-5.3-flash",
      "at most 4 at once",
    ]);
    expect(workflowSettingsChangeSegments(both, { formatMessage: formatterFor(zhCN) })).toEqual([
      "Sub-agent改用 glm-5.3-flash",
      "最多 4 个同时Run",
    ]);
  });

  it("回到SessionModel / 解除上限（to 缺席or等于Default）各有自己的话", () => {
    const reset: WorkflowSettingsAmendMeta = {
      predecessorRunId: "run-a",
      subagentModel: { from: "zhipu/glm-5.3" },
      maxConcurrency: { from: 4, to: 13 },
      ceiling: 13,
    };
    expect(workflowSettingsChangeSegments(reset, { formatMessage: formatterFor(zhCN) })).toEqual([
      "Sub-agent改回SessionModel",
      "上限恢复为Default",
    ]);
    expect(
      workflowSettingsChangeSegments(
        { predecessorRunId: "run-a", maxConcurrency: { from: 4 } },
        { formatMessage: formatterFor(enUS) },
      ),
    ).toEqual(["limit back to the default"]);
  });

  it("High于Default的上限念它自己的Count", () => {
    expect(
      workflowSettingsChangeSegments(
        { maxConcurrency: { to: 40 }, ceiling: 13 },
        { formatMessage: formatterFor(zhCN) },
      ),
    ).toEqual(["最多 40 个同时Run"]);
  });

  it("来龙去脉：每项One行「from → to」，缺席的One端写Default，Default已知时带CountCharacter", () => {
    expect(workflowSettingsProvenanceRows(both, { formatMessage: formatterFor(enUS) })).toEqual([
      { key: "model", label: "Subagent model", value: "glm-5.3 → glm-5.3-flash" },
      { key: "limit", label: "Max concurrency", value: "default 13 → 4" },
    ]);
    expect(
      workflowSettingsProvenanceRows(
        {
          predecessorRunId: "run-a",
          subagentModel: { to: "zhipu/glm-5.3" },
          maxConcurrency: { from: 2 },
        },
        { formatMessage: formatterFor(zhCN) },
      ),
    ).toEqual([
      { key: "model", label: "Sub-agentModel", value: "SessionModel → glm-5.3" },
      { key: "limit", label: "最大ConcurrencyCount", value: "2 → Default" },
    ]);
    expect(
      workflowSettingsProvenanceRows(
        { maxConcurrency: { from: 40 }, ceiling: 13 },
        { formatMessage: formatterFor(zhCN) },
      ),
    ).toEqual([{ key: "limit", label: "最大ConcurrencyCount", value: "40 → Default 13" }]);
  });

  it("两处的词条键集在两种语言下One致", () => {
    for (const prefix of [
      "chat.toolCall.workflow.settingsChange.",
      "chat.workflowLaunch.settings",
    ]) {
      const en = Object.keys(enUS).filter((key) => key.startsWith(prefix));
      const zh = Object.keys(zhCN).filter((key) => key.startsWith(prefix));
      expect(en.length).toBeGreaterThan(0);
      expect(en).toEqual(zh);
    }
  });
});

describe("resolveWorkflowRunGraph：只有「Configuration」出来的 run 借Predecessor的图", () => {
  const GRAPH = { steps: [{ id: "ask#1" }] } as never;
  const graphs = new Map([["tool-a", GRAPH]]);
  const runs = [
    run({ runId: "run-a", toolCallId: "tool-a", status: "stopped", supersededBy: "run-b" }),
    run({ runId: "run-b", toolCallId: "settings-1", resumedFrom: "run-a" }),
    run({ runId: "run-c", toolCallId: "settings-2", resumedFrom: "run-b" }),
    run({ runId: "run-d", toolCallId: "tool-amend", resumedFrom: "run-a" }),
  ];

  it("自己的图在行Window里就用自己的", () => {
    expect(resolveWorkflowRunGraph(graphs, "tool-a", runs)).toBe(GRAPH);
  });

  it("Settings轮还没落地：经 resumedFrom 借Predecessor的图，链上多次「Configuration」也One路借到", () => {
    expect(resolveWorkflowRunGraph(graphs, "settings-1", runs)).toBe(GRAPH);
    expect(resolveWorkflowRunGraph(graphs, "settings-2", runs)).toBe(GRAPH);
  });

  it("改过脚本的修订（AmendWorkflow 行）不借：它画的Yes另One张图", () => {
    expect(resolveWorkflowRunGraph(graphs, "tool-amend", runs)).toBeUndefined();
  });

  it("Predecessor不在投影里 / 链成环时不借也不死循环", () => {
    expect(resolveWorkflowRunGraph(new Map(), "settings-1", runs)).toBeUndefined();
    const loop = [
      run({ runId: "x", toolCallId: "settings-x", resumedFrom: "y" }),
      run({ runId: "y", toolCallId: "settings-y", resumedFrom: "x" }),
    ];
    expect(resolveWorkflowRunGraph(new Map(), "settings-x", loop)).toBeUndefined();
  });
});

describe("replaceWorkflowRunSidePane：面板跟着Workflow走", () => {
  const base = {
    workspaceKey: "/w",
    workspacePath: "/w",
    parentSessionId: "parent-a",
  };

  function withTabs() {
    const first = openWorkflowRunSidePane(null, {
      ...base,
      toolCallId: "tool-a",
      runId: "run-a",
      workflowName: "Fan-out review",
    });
    const stamped = {
      ...first,
      tabs: first.tabs.map((tab) => ({ ...tab, ownerTaskId: "task-1" })),
    };
    return openWorkflowRunSidePane(
      openWorkflowRunSidePane(stamped, { ...base, toolCallId: "tool-z", runId: "run-z" }),
      { ...base, toolCallId: "tool-a", runId: "run-a" },
    );
  }

  it("原地换成New run 的 tab：同One个Location、沿用名Character与归属，原来YesEvents tab 就还YesEvents tab", () => {
    const state = withTabs();
    const next = replaceWorkflowRunSidePane(state, {
      ...base,
      toolCallId: "settings-1",
      runId: "run-b",
      replaceRunId: "run-a",
    })!;
    const replaced = next.tabs[0] as WorkflowRunSidePaneTab;
    expect(next.tabs).toHaveLength(2);
    expect(replaced).toMatchObject({
      type: "workflow-run",
      runId: "run-b",
      toolCallId: "settings-1",
      workflowName: "Fan-out review",
      ownerTaskId: "task-1",
    });
    expect(next.activeTabId).toBe(replaced.id);
    expect((next.tabs[1] as WorkflowRunSidePaneTab).runId).toBe("run-z");
  });

  it("Old tab 不YesEvents tab：Events tab 不动", () => {
    const state = withTabs();
    const focusedOther = { ...state, activeTabId: state.tabs[1]!.id };
    const next = replaceWorkflowRunSidePane(focusedOther, {
      ...base,
      toolCallId: "settings-1",
      runId: "run-b",
      replaceRunId: "run-a",
    })!;
    expect(next.activeTabId).toBe(state.tabs[1]!.id);
  });

  it("Old tab 已被关掉（orSidebar为空）：原样Back，替换不Yes打开", () => {
    const state = withTabs();
    const request = { ...base, toolCallId: "settings-1", runId: "run-b", replaceRunId: "run-gone" };
    expect(replaceWorkflowRunSidePane(state, request)).toBe(state);
    expect(replaceWorkflowRunSidePane(null, request)).toBeNull();
  });

  it("Result里的 run 就Yes被替换的那个（就地生效）：原样Back，什么都不动", () => {
    const state = withTabs();
    const next = replaceWorkflowRunSidePane(state, {
      ...base,
      toolCallId: "settings-1",
      runId: "run-a",
      replaceRunId: "run-a",
    });
    expect(next).toBe(state);
    expect(next?.tabs.map((tab) => (tab as WorkflowRunSidePaneTab).runId)).toEqual([
      "run-a",
      "run-z",
    ]);
  });

  it("New run 的 tab 已经开着：关掉Old的、聚焦那One个，不出两个", () => {
    const state = openWorkflowRunSidePane(withTabs(), {
      ...base,
      toolCallId: "settings-1",
      runId: "run-b",
    });
    const onOld = { ...state, activeTabId: state.tabs[0]!.id };
    const next = replaceWorkflowRunSidePane(onOld, {
      ...base,
      toolCallId: "settings-1",
      runId: "run-b",
      replaceRunId: "run-a",
    })!;
    const runIds = next.tabs.map((tab) => (tab as WorkflowRunSidePaneTab).runId);
    expect(runIds).toEqual(["run-z", "run-b"]);
    expect(next.activeTabId).toBe(next.tabs[1]!.id);
  });
});
