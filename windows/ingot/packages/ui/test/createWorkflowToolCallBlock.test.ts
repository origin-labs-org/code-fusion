// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowDraftPosition, WorkflowRunCardSummary } from "@/ToolCallBlocks/shared.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlockHeader: () => null,
  CodeBlock: ({
    code,
    contentClassName,
    showLineNumbers,
    markedLines,
  }: {
    code: string;
    children?: ReactNode;
    contentClassName?: string;
    showLineNumbers?: boolean;
    markedLines?: readonly number[];
  }) =>
    createElement(
      "pre",
      {
        "data-testid": "code-block",
        className: contentClassName,
        "data-show-line-numbers": showLineNumbers === true ? "true" : undefined,
        "data-marked-lines": markedLines === undefined ? undefined : markedLines.join(","),
      },
      code,
    ),
}));

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServices: () => ({}),
}));

import {
  CreateWorkflowToolCallBlock,
  readWorkflowKindMessageId,
} from "../src/ToolCallBlocks/renderers/create-workflow.js";
import { formatWorkflowFeedbackTooltip } from "../src/ToolCallBlocks/renderers/createWorkflowDisplay.js";
import {
  readWorkflowAmendScriptInherited,
  readWorkflowRetuneCall,
} from "../src/ToolCallBlocks/renderers/createWorkflowInput.js";
import { ConversationRowView } from "@/v4/ConversationRowView.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";

type ToolCallOverrides = {
  
  kind?: string;
  input?: unknown;
  output?: unknown;
  raw?: unknown;
  status?: string;
  snapshotRefs?: readonly { field: string; previewBytes: number; fullBytes: number }[];
};

type ContextOverrides = {
  isRunning?: boolean;
  statusLabel?: string;
  errorText?: string;
  onOpenWorkflowRun?: (request: { workflowName?: string }) => void;
  onResumeWorkflowRun?: (request: { workflowName?: string }) => void;
  onOpenWorkflowActor?: (request: {
    runId: string;
    actorSessionId: string;
    siteId: string;
    ordinal: number;
    actorName?: string;
  }) => void;
  onLoadFullToolCallFields?: (toolId: string) => void;
  onOpenWorkflowArtifact?: (artifactId: string) => void;
  onOpenWorkflowWorkspace?: (request: { phaseId: string; workflowName?: string }) => void;
  workflowRun?: WorkflowRunCardSummary;
  workflowDraft?: WorkflowDraftPosition;
  forceOpen?: boolean;
  canToggle?: boolean;
};

function createBlock(
  toolCall: ToolCallOverrides,
  contextOverrides: ContextOverrides = {},
  locale: "en-US" | "zh-CN" = "en-US",
) {
  return createElement(
    CfIntlProvider,
    { initialLocale: locale },
    createElement(CreateWorkflowToolCallBlock, {
      toolCallNode: {
        toolCall: {
          toolId: "tool-create-workflow",
          kind: toolCall.kind ?? "CreateWorkflow",
          title: toolCall.kind ?? "CreateWorkflow",
          input: toolCall.input,
          output: toolCall.output,
          status: toolCall.status ?? "completed",
          raw: toolCall.raw,
          snapshotRefs: toolCall.snapshotRefs,
        },
        childToolCalls: [],
      } as any,
      workspacePath: "/workspace",
      displayModel: {
        inlinePreview: { type: "none" },
        planResult: null,
        viewerSource: null,
        viewerLabelId: "codeViewer.viewCode",
        showSummaryFileLink: false,
        showInput: false,
        showOutput: true,
        showKind: false,
      } as any,
      viewerSource: null,
      rawFileSummaries: [],
      isRunning: contextOverrides.isRunning ?? false,
      statusLabel: contextOverrides.statusLabel ?? "Completed",
      errorText: contextOverrides.errorText,
      childToolList: null,
      forceOpen: contextOverrides.forceOpen ?? true,
      canToggle: contextOverrides.canToggle ?? true,
      showIcon: true,
      onOpenWorkflowRun: contextOverrides.onOpenWorkflowRun,
      onResumeWorkflowRun: contextOverrides.onResumeWorkflowRun,
      onOpenWorkflowActor: contextOverrides.onOpenWorkflowActor,
      onOpenWorkflowArtifact: contextOverrides.onOpenWorkflowArtifact,
      onOpenWorkflowWorkspace: contextOverrides.onOpenWorkflowWorkspace,
      onLoadFullToolCallFields: contextOverrides.onLoadFullToolCallFields,
      workflowRun: contextOverrides.workflowRun,
      workflowDraft: contextOverrides.workflowDraft,
    }),
  );
}

function renderBlock(
  toolCall: ToolCallOverrides,
  contextOverrides: ContextOverrides = {},
  locale: "en-US" | "zh-CN" = "en-US",
): string {
  return renderToStaticMarkup(createBlock(toolCall, contextOverrides, locale));
}

function renderBlockDom(
  toolCall: ToolCallOverrides,
  contextOverrides: ContextOverrides = {},
  locale: "en-US" | "zh-CN" = "en-US",
) {
  return render(createBlock(toolCall, contextOverrides, locale));
}

afterEach(() => {
  cleanup();
});

const OK_DISPLAY = {
  kind: "create_workflow",
  ok: true,
  errorCount: 0,
  diagnostics: [],
};

const LOOP_GRAPH = {
  steps: [
    {
      id: "ask#1",
      kind: "ask",
      label: "plan",
      line: 2,
      column: 21,
      lane: "actor#1",
      phase: "phase#a",
    },
    {
      id: "ask#2",
      kind: "ask",
      label: "verify",
      line: 5,
      column: 21,
      lane: "actor#2",
      phase: "phase#b",
    },
  ],
  lanes: [
    { id: "actor#1", name: "planner", line: 1, column: 11 },
    { id: "actor#2", name: "checker", line: 4, column: 11 },
  ],
  participants: [
    { id: "phase#a:actor#1", phase: "phase#a", lane: "actor#1", steps: ["ask#1"] },
    { id: "phase#b:actor#2", phase: "phase#b", lane: "actor#2", steps: ["ask#2"] },
  ],
  handoffs: [],
  phases: [
    { id: "phase#a", name: "plan", line: 1 },
    { id: "phase#b", name: "verify", line: 4 },
  ],
  phaseEdges: [
    { from: "phase#a", to: "phase#b" },
    { from: "phase#b", to: "phase#a", back: true },
  ],
  exits: ["phase#b"],
};

const FLAT_GRAPH = {
  steps: [{ id: "ask#1", kind: "ask", label: "a", line: 1, column: 21, lane: "actor#1" }],
  lanes: [{ id: "actor#1", name: "a", line: 1, column: 11 }],
  participants: [{ id: "unphased:actor#1", phase: "unphased", lane: "actor#1", steps: ["ask#1"] }],
  handoffs: [],
  sink: ["ask#1"],
};

const LOOP_TOOL_CALL: ToolCallOverrides = {
  input: { name: "Research pipeline", script: 'phase("plan");\nconst p = agent("planner");' },
  raw: { display: { ...OK_DISPLAY, causalityGraph: LOOP_GRAPH } },
};

function runState(overrides: Partial<WorkflowRunState> = {}): WorkflowRunState {
  return {
    runId: "dwfrun-42",
    toolCallId: "tool-create-workflow",
    status: "running",
    usage: { spentTokens: 1_234, nodesUsed: 2 },
    actors: [
      { siteId: "actor#1", ordinal: 1, name: "Ada", sessionId: "s-1", status: "completed" },
      { siteId: "actor#2", ordinal: 1, name: "Bob", sessionId: "s-2", status: "running" },
    ],
    nodes: [
      {
        siteId: "ask#1",
        ordinal: 1,
        phase: "settled",
        outcome: "ok",
        actorSiteId: "actor#1",
        actorOrdinal: 1,
      },
      { siteId: "ask#2", ordinal: 1, phase: "executing", actorSiteId: "actor#2", actorOrdinal: 1 },
    ] as WorkflowRunState["nodes"],
    lastEventSequence: 7,
    ...overrides,
  };
}

function joined(
  overrides: Partial<WorkflowRunState> = {},
  extra: Partial<WorkflowRunCardSummary> = {},
) {
  const run = runState(overrides);
  const settled = run.nodes.filter((node) => node.phase === "settled").length;
  return {
    runId: run.runId,
    status: run.status,
    ...(run.stopReason === undefined ? {} : { stopReason: run.stopReason }),
    nodesSettled: settled,
    nodesTotal: run.nodes.length,
    run,
    ...extra,
  } satisfies WorkflowRunCardSummary;
}

describe("CreateWorkflowToolCallBlock static form (compiled, not linked to run)", () => {
  it("Header: category keyword + name, empty ring light \"compiled\" + monospaced count on the right; card body is timeline with folded script", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL);
    const card = view.getByTestId("workflow-card");

    expect(card.getAttribute("data-workflow-card-state")).toBe("static");
    expect(view.getByTestId("workflow-card-kind").textContent).toBe("Workflow");
    expect(view.getByTestId("workflow-card-name").textContent).toBe("Research pipeline");
    expect(view.getByTestId("workflow-card-static-status").textContent).toBe("compiled");
    expect(view.getByTestId("workflow-card-detail").textContent).toBe("2 phases · 2 agents");

    const stations = view.getAllByTestId("workflow-timeline-station");
    expect(stations.map((station) => station.textContent)).toEqual([
      expect.stringContaining("plan"),
      expect.stringContaining("verify"),
    ]);
    expect(view.getAllByTestId("workflow-agent-pill").map((pill) => pill.textContent)).toEqual([
      expect.stringContaining("planner"),
      expect.stringContaining("checker"),
    ]);
    expect(view.getByTestId("workflow-timeline-rail").getAttribute("data-rail-ink")).toBe("faint");
    const arc = view.getByTestId("workflow-timeline-arc");
    expect(arc.getAttribute("data-arc-from")).toBe("1");
    expect(arc.getAttribute("data-arc-to")).toBe("0");
    const d = arc.querySelector("path")!.getAttribute("d")!;
    const verticals = [...d.matchAll(/V(-?[\d.]+)/gu)].map((match) => Number(match[1]));
    const corner = Number(
      /Q[^ ]+ [^,]+,([\d.]+)$/u.exec(d.slice(0, d.lastIndexOf("V")).trimEnd())?.[1],
    );
    expect(verticals).toHaveLength(2);
    expect(verticals[1]! - corner).toBeGreaterThanOrEqual(8);
    expect(card.textContent).not.toContain("terminate");

    expect(view.queryByTestId("code-block")).toBeNull();
    fireEvent.click(view.getByTestId("workflow-card-script-toggle"));
    expect(view.getByTestId("code-block").textContent).toContain('phase("plan")');
  });

  it("Unmarked script: an implicit station \"Workflow\", pill is the original author name of that lane", () => {
    const view = renderBlockDom({
      input: { script: "x" },
      raw: { display: { ...OK_DISPLAY, causalityGraph: FLAT_GRAPH } },
    });
    expect(view.getByTestId("workflow-timeline-station").textContent).toContain("Workflow");
    expect(view.getByTestId("workflow-agent-pill").textContent).toContain("a");
    expect(view.getByTestId("workflow-card-detail").textContent).toBe("1 phase · 1 agent");
  });

  it("Do not draw timeline when there is no graph (or graph with zero steps); script folding remains", () => {
    const html = renderBlock({ input: { script: "const x = 1;" }, raw: { display: OK_DISPLAY } });
    expect(html).not.toContain("workflow-timeline");
    expect(html).toContain("workflow-card-script-toggle");
    expect(html).not.toContain("workflow-card-detail");

    const empty = renderBlock({
      input: { script: "x" },
      raw: {
        display: {
          ...OK_DISPLAY,
          causalityGraph: { steps: [], lanes: [], participants: [], handoffs: [] },
        },
      },
    });
    expect(empty).not.toContain("workflow-timeline");
  });

  it("No footer and no run attributes when unable to link to run; remains a static card when callbacks exist but run summary is absent", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, { onOpenWorkflowRun: () => {} });
    const card = view.getByTestId("workflow-card");
    expect(card.getAttribute("data-workflow-run-id")).toBeNull();
    expect(view.queryByTestId("workflow-card-footer")).toBeNull();
    expect(view.queryByTestId("workflow-card-status")).toBeNull();
    expect(html(view)).not.toContain("Workflow started");
  });

  it("All six phases fully enter the timeline", () => {
    const phases = ["a", "b", "c", "d", "e", "f"].map((name, i) => ({
      id: `phase#${name}`,
      name,
      line: i + 1,
    }));
    const steps = phases.map((phase, i) => ({
      id: `ask#${i + 1}`,
      kind: "ask",
      label: phase.name,
      lane: "actor#1",
      phase: phase.id,
    }));
    const view = renderBlockDom({
      input: { script: "x" },
      raw: {
        display: {
          ...OK_DISPLAY,
          causalityGraph: {
            steps,
            lanes: [{ id: "actor#1", name: "worker" }],
            participants: steps.map((step) => ({
              id: `${step.phase}:actor#1`,
              phase: step.phase,
              lane: "actor#1",
              steps: [step.id],
            })),
            handoffs: [],
            phases,
            phaseEdges: phases.slice(1).map((phase, i) => ({ from: phases[i]!.id, to: phase.id })),
            exits: ["phase#f"],
          },
        },
      },
    });
    expect(view.getAllByTestId("workflow-timeline-station")).toHaveLength(6);
  });

  it("shows the graph truncation note when steps were omitted", () => {
    const view = renderBlockDom({
      input: { script: "x" },
      raw: { display: { ...OK_DISPLAY, causalityGraph: { ...FLAT_GRAPH, truncated: true } } },
    });
    expect(view.container.textContent).toContain("some participants were omitted");
  });

  it("falls back to the plain output text when no display payload exists", () => {
    const markup = renderBlock({
      input: { script: "export const meta = {};" },
      output: { diagnostics: [], ok: true, response: "The workflow script compiled cleanly." },
      raw: {},
    });

    expect(markup).toContain("The workflow script compiled cleanly.");
    expect(markup).toContain("workflow-card-script-toggle");
    expect(markup).not.toContain("Compiler feedback");
    expect(markup).not.toContain("workflow-draft-lamp");
    expect(markup).not.toContain("workflow-card-static-status");
    expect(markup).not.toContain("&quot;ok&quot;");
  });

  it("does not crash and shows a hint when input.script is missing", () => {
    const markup = renderBlock({ input: { name: "No script here" }, raw: {} });
    expect(markup).toContain("No workflow script provided.");
    expect(markup).not.toContain("code-block");
  });

  it("saved 来源显示保存的工作流名称", () => {
    const view = renderBlockDom({
      input: {
        name: "Fan-out review",
        script: "x",
        saved: {
          name: "fan-out-review",
          scope: "project",
          path: "/workspace/.cf/workflows/fan-out-review.dwf.ts",
        },
      },
      raw: { display: { ...OK_DISPLAY, causalityGraph: FLAT_GRAPH } },
    });
    const savedLine = view.container.querySelector('[data-workflow-card-saved-source="true"]')!;
    expect(savedLine.textContent).toContain("fan-out-review");
  });
});

function html(view: ReturnType<typeof render>): string {
  return view.container.innerHTML;
}

describe("CreateWorkflowToolCallBlock 编译反馈", () => {
  const FEEDBACK_DISPLAY = {
    kind: "create_workflow",
    ok: false,
    errorCount: 2,
    diagnostics: [
      { line: 3, column: 5, code: 2304, message: "Cannot find name 'agent'." },
      {
        line: 8,
        column: 1,
        code: 9003,
        message: "world.run's first argument must be a compile-time string literal.",
      },
    ],
  };
  const FEEDBACK_CALL: ToolCallOverrides = {
    input: { name: "Release notes digest", script: "const x: number = 'nope';" },
    output: { diagnostics: [], ok: false, response: "The workflow script has errors:" },
    raw: { display: FEEDBACK_DISPLAY },
  };
  const LATEST: WorkflowDraftPosition = { ordinal: 2, superseded: false };

  it("Row: \"Workflow draft\" + name + draft number + warning-colored ring light + \"2 to fix · not run\"; not a workflow card", () => {
    const view = renderBlockDom(FEEDBACK_CALL, { workflowDraft: LATEST, forceOpen: false });
    const row = view.getByRole("button");
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(row.querySelector(".tool-summary-kind-label")?.textContent).toBe("Workflow draft");
    expect(row.textContent).toContain("Release notes digest");
    expect(view.getByTestId("workflow-draft-ordinal").textContent).toBe("draft 2");
    expect(view.getByTestId("workflow-draft-status").textContent).toBe("2 to fix · not run");
    const lamp = view.getByTestId("workflow-draft-lamp");
    expect(lamp.getAttribute("data-draft-lamp")).toBe("open");
    expect(lamp.className).toContain("border-warning");
    expect(view.queryByTestId("workflow-card")).toBeNull();
    expect(view.queryByTestId("workflow-timeline")).toBeNull();
  });

  it("Updated draft: light fades to neutral, draft number and text unchanged", () => {
    const view = renderBlockDom(FEEDBACK_CALL, {
      workflowDraft: { ordinal: 1, superseded: true },
      forceOpen: false,
    });
    const lamp = view.getByTestId("workflow-draft-lamp");
    expect(lamp.getAttribute("data-draft-lamp")).toBe("settled");
    expect(lamp.className).toContain("border-foreground-subtlest");
    expect(lamp.className).not.toContain("border-warning");
    expect(view.getByTestId("workflow-draft-ordinal").textContent).toBe("draft 1");
    expect(view.getByTestId("workflow-draft-status").textContent).toBe("2 to fix · not run");
  });

  it("Host has no draft number link: unnumbered, light remains warning color", () => {
    const view = renderBlockDom(FEEDBACK_CALL, { forceOpen: false });
    expect(view.queryByTestId("workflow-draft-ordinal")).toBeNull();
    expect(view.getByTestId("workflow-draft-lamp").getAttribute("data-draft-lamp")).toBe("open");
  });

  it("Expanded script shows line numbers and issue lines; feedback displays title, count, description, and itemized locations", () => {
    const view = renderBlockDom(FEEDBACK_CALL, { workflowDraft: LATEST, forceOpen: true });
    expect(view.getByTestId("workflow-draft-ordinal").textContent).toBe("draft 2");
    const code = view.getByTestId("code-block");
    expect(code.getAttribute("data-show-line-numbers")).toBe("true");
    expect(code.getAttribute("data-marked-lines")).toBe("3,8");

    const card = view.getByTestId("workflow-compiler-feedback");
    expect(within(card).getByTestId("workflow-compiler-feedback-title").textContent).toBe(
      "Compiler feedback",
    );
    expect(within(card).getByTestId("workflow-compiler-feedback-count").textContent).toBe(
      "2 notes",
    );
    expect(within(card).getByTestId("workflow-compiler-feedback-lede").textContent).toBe(
      "Typecheck did not pass, so nothing ran. The feedback went back to the model to revise and resubmit.",
    );
    const lines = within(card).getAllByTestId("workflow-compiler-feedback-line");
    expect(lines).toHaveLength(2);
    expect(lines[0]!.textContent).toContain("L3:C5");
    expect(lines[0]!.textContent).toContain("Cannot find name");
    expect(lines[0]!.textContent).toContain("TS2304");
    expect(lines[1]!.textContent).toContain("rule 9003");
    expect(lines[1]!.textContent).not.toContain("TS9003");
  });

  it("Use singular for single feedback; count reads errorCount rather than truncated line count", () => {
    const one = renderBlockDom(
      {
        ...FEEDBACK_CALL,
        raw: {
          display: {
            ...FEEDBACK_DISPLAY,
            errorCount: 1,
            diagnostics: [FEEDBACK_DISPLAY.diagnostics[0]],
          },
        },
      },
      { forceOpen: true },
    );
    expect(one.getByTestId("workflow-compiler-feedback-count").textContent).toBe("1 note");
    expect(one.getByTestId("workflow-draft-status").textContent).toBe("1 to fix · not run");
    cleanup();

    const many = renderBlockDom(
      {
        ...FEEDBACK_CALL,
        raw: { display: { ...FEEDBACK_DISPLAY, errorCount: 150, truncated: true } },
      },
      { forceOpen: true },
    );
    expect(many.getByTestId("workflow-compiler-feedback-count").textContent).toBe("150 notes");
    expect(many.container.textContent).toContain("Some diagnostics were omitted.");
  });

  it("Saved source fails compilation: that sentence names the file rather than this call", () => {
    const view = renderBlockDom(
      {
        ...FEEDBACK_CALL,
        input: {
          name: "Release notes digest",
          script: "const x: number = 'nope';",
          saved: {
            name: "release-notes",
            scope: "project",
            path: ".cf/workflows/release-notes.ts",
          },
        },
      },
      { forceOpen: true },
    );
    expect(view.getByTestId("workflow-compiler-feedback-lede").textContent).toBe(
      "The saved workflow file did not pass typecheck, so nothing ran. The feedback went back to the model to fix the file or save a corrected version.",
    );
  });

  it("zh-CN: \"Workflow draft · Draft 1 · 2 to fix · Not run\" and \"Compilation feedback · 2 items · Rule 9003\"", () => {
    const view = renderBlockDom(
      FEEDBACK_CALL,
      { workflowDraft: { ordinal: 1, superseded: false }, forceOpen: true },
      "zh-CN",
    );
    expect(view.container.querySelector(".tool-summary-kind-label")?.textContent).toBe(
      "工作流草稿",
    );
    expect(view.getByTestId("workflow-draft-ordinal").textContent).toBe("第 1 稿");
    expect(view.getByTestId("workflow-draft-status").textContent).toBe("2 to fix · Not run");
    expect(view.getByTestId("workflow-compiler-feedback-title").textContent).toBe("编译反馈");
    expect(view.getByTestId("workflow-compiler-feedback-count").textContent).toBe("2 条");
    expect(view.getByTestId("workflow-compiler-feedback-lede").textContent).toBe(
      "Type check failed, script not run; feedback returned to model to modify and resubmit.",
    );
    expect(view.container.textContent).toContain("规则 9003");
  });

  it("Tip: state that sentence first, then list locations and messages one by one", () => {
    expect(formatWorkflowFeedbackTooltip("Nothing ran.", FEEDBACK_DISPLAY.diagnostics)).toBe(
      "Nothing ran.\nL3:C5 Cannot find name 'agent'.\nL8:C1 world.run's first argument must be a compile-time string literal.",
    );
    expect(formatWorkflowFeedbackTooltip("Nothing ran.", [])).toBe("Nothing ran.");
  });

  it("Failed but without display (rejected, tool error): remains \"Workflow\" + tool status word, no light or draft number", () => {
    const view = renderBlockDom(
      {
        input: { name: "Release notes digest", script: "x" },
        output: "run_not_found: no such run",
        status: "failed",
      },
      { statusLabel: "Failed", workflowDraft: LATEST, forceOpen: false },
    );
    expect(view.container.querySelector(".tool-summary-kind-label")?.textContent).toBe("Workflow");
    expect(view.container.textContent).toContain("Failed");
    expect(view.queryByTestId("workflow-draft-lamp")).toBeNull();
    expect(view.queryByTestId("workflow-draft-ordinal")).toBeNull();
  });

  it("Stay on feedback row when compilation fails, even if host is linked to run", () => {
    const markup = renderBlock(
      {
        input: { script: "x" },
        raw: {
          display: {
            kind: "create_workflow",
            ok: false,
            errorCount: 1,
            diagnostics: [{ line: 1, column: 1, code: 2304, message: "boom" }],
          },
        },
      },
      { workflowRun: joined() },
    );
    expect(markup).toContain("Compiler feedback");
    expect(markup).not.toContain('data-testid="workflow-card"');
    expect(markup).not.toContain("Workflow running");
  });
});

describe("CreateWorkflowToolCallBlock 启动前 ToolLayout", () => {
  const DRAFT =
    'phase("plan");\nconst planner = agent("planner");\nawait world.run("pnpm test");\nphase("ver';

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const settle = () => {
    for (let i = 0; i < 120; i += 1) {
      act(() => {
        vi.advanceTimersByTime(24);
      });
    }
  };

  it("Writing: row not expandable (forceOpen does not expand either), draft phase line stays below row, stations drawn as written, without pills", () => {
    const view = renderBlockDom(
      {
        input: { name: "Research pipeline", script: DRAFT },
        raw: { v4Status: "inputStreaming" },
        status: "running",
      },
      { isRunning: true, forceOpen: true },
    );
    expect(view.container.textContent).toContain("Writing workflow");
    expect(view.container.textContent).toContain("Research pipeline");
    expect(view.container.querySelector(".tool-summary-kind-label")).toBeTruthy();
    expect(view.container.querySelector("[aria-expanded]")).toBeNull();
    expect(view.queryByTestId("workflow-card")).toBeNull();
    expect(view.queryByTestId("code-block")).toBeNull();
    expect(view.getByTestId("workflow-draft-timeline")).toBeTruthy();
    expect(view.getAllByTestId("workflow-timeline-station")).toHaveLength(1);
    expect(view.getByTestId("workflow-timeline-caret").getAttribute("data-pen")).toBe("writing");

    settle();
    const stations = view.getAllByTestId("workflow-timeline-station");
    expect(stations.map((station) => station.textContent)).toEqual(["plan", "ver"]);
    const caret = view.getByTestId("workflow-timeline-caret");
    expect(stations[1]!.contains(caret)).toBe(true);
    expect(caret.getAttribute("data-pen")).toBe("idle");
    expect(view.queryByTestId("workflow-agent-pill")).toBeNull();
    expect(view.queryByTestId("workflow-timeline-arc")).toBeNull();
    expect(view.container.querySelector("[aria-expanded]")).toBeNull();
  });

  it("Once display arrives, draft stations and cursor exit: card replaced with analyzer stations and pills (invariant 10)", () => {
    const view = renderBlockDom(
      {
        input: { name: "Research pipeline", script: DRAFT },
        raw: { v4Status: "inputStreaming" },
        status: "running",
      },
      { isRunning: true },
    );
    settle();
    expect(view.getAllByTestId("workflow-timeline-station")).toHaveLength(2);
    view.rerender(createBlock(LOOP_TOOL_CALL));
    expect(view.queryByTestId("workflow-draft-timeline")).toBeNull();
    expect(view.queryByTestId("workflow-timeline-caret")).toBeNull();
    const stations = view.getAllByTestId("workflow-timeline-station");
    expect(stations.map((station) => station.textContent)).toEqual([
      expect.stringContaining("plan"),
      expect.stringContaining("verify"),
    ]);
    expect(view.getAllByTestId("workflow-agent-pill")).toHaveLength(2);
    expect(view.getByTestId("workflow-timeline-arc")).toBeTruthy();
  });

  it("Writing script with not a single character yet: row only, no phase line block", () => {
    const view = renderBlockDom(
      {
        input: { name: "Research pipeline" },
        raw: { v4Status: "inputStreaming" },
        status: "running",
      },
      { isRunning: true },
    );
    expect(view.container.textContent).toContain("Writing workflow");
    expect(view.queryByTestId("workflow-draft-timeline")).toBeNull();
    expect(view.queryByTestId("workflow-timeline-station")).toBeNull();
  });

  it.each(["en-US", "zh-CN"] as const)("Script can be expanded while awaiting confirmation, collapsed again: %s", (locale) => {
    const view = renderBlockDom(
      {
        ...LOOP_TOOL_CALL,
        raw: { ...(LOOP_TOOL_CALL.raw as object), v4Status: "pendingApproval" },
        status: "running",
      },
      { isRunning: true, forceOpen: false },
      locale,
    );
    expect(view.container.querySelector(".tool-summary-kind-label")).toBeTruthy();
    expect(view.queryByTestId("workflow-card")).toBeNull();
    const trigger = view.getByRole("button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByTestId("code-block")).toBeNull();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByTestId("code-block").textContent).toContain("agent");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("CreateWorkflowToolCallBlock 运行态", () => {
  it("Header: category keyword \"Workflow running\", light + status word, step details; no compact card", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() });
    const card = view.getByTestId("workflow-card");

    expect(card.getAttribute("data-workflow-card-state")).toBe("running");
    expect(card.getAttribute("data-workflow-run-id")).toBe("dwfrun-42");
    expect(view.getByTestId("workflow-card-kind").textContent).toBe("Workflow running");
    expect(view.getByTestId("workflow-card-status").textContent).toBe("Running");
    expect(view.getByTestId("workflow-card-detail").textContent).toBe("2 phases · 1 agent working");
    expect(view.queryByTestId("workflow-run-card")).toBeNull();
    expect(view.queryByTestId("workflow-card-static-status")).toBeNull();
  });

  it("Stations and pills read projection: station light, runtime name, status tag; active edge is segment entering running station", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() });

    const stations = view.getAllByTestId("workflow-timeline-station");
    expect(stations.map((station) => station.getAttribute("data-station-status"))).toEqual([
      "done",
      "running",
    ]);
    expect(stations[0]!.textContent).toContain("1/1");
    const pills = view.getAllByTestId("workflow-agent-pill");
    expect(pills.map((pill) => pill.textContent)).toEqual([
      expect.stringContaining("Ada"),
      expect.stringContaining("Bob"),
    ]);
    expect(pills.map((pill) => pill.getAttribute("data-agent-status"))).toEqual([
      "done",
      "running",
    ]);
    expect(
      pills[1]!.querySelector('[data-testid="workflow-pill-status"]')?.getAttribute("aria-label"),
    ).toBe("running");
    expect(view.getByTestId("workflow-timeline-rail").getAttribute("data-rail-ink")).toBe("march");
    expect(view.getByTestId("workflow-timeline-arc").getAttribute("data-arc-ink")).toBe("faint");
  });

  it("Running state has no footer: card only shows phases and sub-agents in header; steps, tokens, and turns excluded (2026-09-09)", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() });
    expect(view.queryByTestId("workflow-card-footer")).toBeNull();
    const card = view.getByTestId("workflow-card").textContent ?? "";
    expect(view.getByTestId("workflow-card-detail").textContent).toBe("2 phases · 1 agent working");
    expect(card).not.toContain("steps");
    expect(card).not.toContain("tokens");
    expect(view.container.querySelector("progress")).toBeNull();
  });

  it("Round 2: back-edge darkens and becomes active edge, station header shows ⟳ 2; header does not count rounds, still only showing phases and sub-agents", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      workflowRun: joined({
        actors: [
          { siteId: "actor#1", ordinal: 2, name: "Ada", sessionId: "s-1b", status: "running" },
          { siteId: "actor#2", ordinal: 1, name: "Bob", sessionId: "s-2", status: "completed" },
        ],
        nodes: [
          {
            siteId: "ask#1",
            ordinal: 1,
            phase: "settled",
            outcome: "ok",
            actorSiteId: "actor#1",
            actorOrdinal: 1,
          },
          {
            siteId: "ask#2",
            ordinal: 1,
            phase: "settled",
            outcome: "ok",
            actorSiteId: "actor#2",
            actorOrdinal: 1,
          },
          {
            siteId: "ask#1",
            ordinal: 2,
            phase: "executing",
            actorSiteId: "actor#1",
            actorOrdinal: 2,
          },
        ] as WorkflowRunState["nodes"],
      }),
    });
    expect(view.getByTestId("workflow-timeline-arc").getAttribute("data-arc-ink")).toBe("march");
    expect(view.getByTestId("workflow-timeline-rail").getAttribute("data-rail-ink")).toBe("strong");
    const rounds = view.getAllByTestId("workflow-timeline-rounds");
    expect(rounds[0]!.textContent).toContain("2");
    expect(view.getByTestId("workflow-card-detail").textContent).toBe("2 phases · 1 agent working");
    expect(view.queryByTestId("workflow-card-footer")).toBeNull();
  });

  it("Completed: ink = trajectory; header replaced with terminal counts (stages · subagents); no footer", () => {
    const onOpenWorkflowArtifact = vi.fn();
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      onOpenWorkflowArtifact,
      workflowRun: joined({
        status: "completed",
        actors: [
          { siteId: "actor#1", ordinal: 1, name: "Ada", sessionId: "s-1", status: "completed" },
          { siteId: "actor#2", ordinal: 1, name: "Bob", sessionId: "s-2", status: "completed" },
        ],
        nodes: [
          { siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" },
          { siteId: "ask#2", ordinal: 1, phase: "settled", outcome: "ok" },
        ] as WorkflowRunState["nodes"],
        reports: [
          { id: "r1", kind: "text", title: "Summary", text: "done" },
        ] as WorkflowRunState["reports"],
        artifacts: [
          { id: "book", kind: "file", title: "Audit report", version: 2 },
        ] as WorkflowRunState["artifacts"],
      }),
    });
    expect(view.getByTestId("workflow-card-kind").textContent).toBe("Workflow completed");
    expect(view.getByTestId("workflow-card-status").textContent).toBe("Completed");
    expect(view.getByTestId("workflow-timeline-rail").getAttribute("data-rail-ink")).toBe("strong");
    expect(view.getByTestId("workflow-timeline-arc").getAttribute("data-arc-ink")).toBe("faint");
    expect(view.getByTestId("workflow-card-header").querySelector(".animate-pulse")).toBeNull();
    expect(view.queryByTestId("workflow-card-footer")).toBeNull();
    expect(view.getByTestId("workflow-card-detail").textContent).toBe("2 phases · 2 agents");
    const card = view.getByTestId("workflow-card").textContent ?? "";
    expect(card).not.toContain("steps");
    expect(card).not.toContain("tokens");
    expect(card).not.toContain("artifact");
    expect(card).not.toContain("result");
    expect(card).not.toContain("working");
    const strip = view.getByTestId("workflow-card-artifacts");
    const pills = within(strip).getAllByTestId("workflow-card-artifact");
    expect(pills).toHaveLength(1);
    expect(pills[0]?.tagName).toBe("BUTTON");
    expect(pills[0]?.getAttribute("data-artifact-open")).toBe("true");
    expect(within(strip).getByTestId("workflow-run-artifact-version").textContent).toBe("v2");
    fireEvent.click(pills[0]!);
    expect(onOpenWorkflowArtifact).toHaveBeenCalledWith("book");
  });

  it("Pill is disabled when host does not inject artifact opening capability; artifact bar remains visible", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      workflowRun: joined({
        status: "completed",
        artifacts: [
          { id: "book", kind: "file", title: "Audit report", version: 1 },
        ] as WorkflowRunState["artifacts"],
      }),
    });
    const pill = view.getByTestId("workflow-card-artifact") as HTMLButtonElement;
    expect(pill.disabled).toBe(true);
    expect(pill.getAttribute("data-artifact-open")).toBeNull();
    expect(view.queryByTestId("workflow-run-artifact-version")).toBeNull();
  });

  it("⤢ Open details: present only when host provides a callback; request includes display name; clicking station header takes the same path", () => {
    const onOpenWorkflowRun = vi.fn();
    const view = renderBlockDom(LOOP_TOOL_CALL, { onOpenWorkflowRun, workflowRun: joined() });
    fireEvent.click(view.getByTestId("workflow-card-open-details"));
    expect(onOpenWorkflowRun).toHaveBeenCalledWith({ workflowName: "Research pipeline" });

    fireEvent.click(view.getAllByTestId("workflow-timeline-station")[1]!.querySelector("button")!);
    expect(onOpenWorkflowRun).toHaveBeenCalledTimes(2);

    cleanup();
    const gated = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() });
    expect(gated.queryByTestId("workflow-card-open-details")).toBeNull();
    const station = gated.getAllByTestId("workflow-timeline-station")[0]!;
    expect(station.querySelector("button")).toBeNull();
    expect(station.querySelector('[data-testid="workflow-timeline-station-head"]')).not.toBeNull();
  });

  it("Request omits workflowName when display name is absent", () => {
    const onOpenWorkflowRun = vi.fn();
    const view = renderBlockDom(
      { ...LOOP_TOOL_CALL, input: { script: "x" } },
      { onOpenWorkflowRun, workflowRun: joined() },
    );
    expect(view.getByTestId("workflow-card-name").textContent).toBe("Workflow script");
    fireEvent.click(view.getByTestId("workflow-card-open-details"));
    expect(onOpenWorkflowRun).toHaveBeenCalledWith({});
  });

  it("Collapsed while running: card body and footer both collapse; header light and details remain visible", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      forceOpen: false,
      canToggle: true,
      workflowRun: joined(),
    });
    expect(view.getByTestId("workflow-card-body")).toBeTruthy();
    fireEvent.click(view.getByTestId("workflow-card-toggle"));
    expect(view.queryByTestId("workflow-card-body")).toBeNull();
    expect(view.queryByTestId("workflow-card-footer")).toBeNull();
    expect(view.getByTestId("workflow-card-status").textContent).toBe("Running");
    expect(view.getByTestId("workflow-card-detail").textContent).toBe("2 phases · 1 agent working");
    fireEvent.click(view.getByTestId("workflow-card-toggle"));
    expect(view.getByTestId("workflow-card-body")).toBeTruthy();
  });

  it("forceOpen / canToggle=false 时没有折叠按钮", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() });
    expect(view.queryByTestId("workflow-card-toggle")).toBeNull();
    cleanup();
    const locked = renderBlockDom(LOOP_TOOL_CALL, {
      forceOpen: false,
      canToggle: false,
      workflowRun: joined(),
    });
    expect(locked.queryByTestId("workflow-card-toggle")).toBeNull();
    expect(locked.getByTestId("workflow-card-body")).toBeTruthy();
  });

  it("Once linked to a run, script collapses away from card: read raw script in Script section of details page", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() });
    expect(view.queryByTestId("workflow-card-script-toggle")).toBeNull();
    expect(view.queryByTestId("code-block")).toBeNull();
  });

  it("Snapshot field tooltip remains attached behind the card", () => {
    const view = renderBlockDom(
      {
        ...LOOP_TOOL_CALL,
        snapshotRefs: [{ field: "input", previewBytes: 100, fullBytes: 5_000 }],
      },
      { onLoadFullToolCallFields: () => {}, workflowRun: joined() },
    );
    expect(view.getByTestId("workflow-card")).toBeTruthy();
    expect(view.container.textContent).toContain("Load full tool data");
  });

  it("Card face fully localized under zh-CN", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() }, "zh-CN");
    const card = view.getByTestId("workflow-card");
    expect(view.getByTestId("workflow-card-kind").textContent).toBe("工作流运行中");
    expect(view.getByTestId("workflow-card-status").textContent).toBe("运行中");
    expect(card.textContent).toContain("2 stages · 1 subagent working");
    expect(card.textContent).toContain("1 subagent working");
    expect(card.textContent).not.toContain("Workflow running");
    expect(card.textContent).not.toContain("steps");
  });
});

describe("CreateWorkflowToolCallBlock 药丸点击", () => {
  it("Pill with session is a button: click to yield instance identity (run, session, station, index, runtime name)", () => {
    const onOpenWorkflowActor = vi.fn();
    const view = renderBlockDom(LOOP_TOOL_CALL, { onOpenWorkflowActor, workflowRun: joined() });

    const pills = view.getAllByTestId("workflow-agent-pill");
    expect(pills.map((pill) => pill.tagName)).toEqual(["BUTTON", "BUTTON"]);
    expect(pills[1]!.getAttribute("aria-label")).toBe("Open the transcript of Bob");
    expect(view.getAllByTestId("workflow-timeline-pill-open")).toHaveLength(2);

    fireEvent.click(pills[1]!);
    expect(onOpenWorkflowActor).toHaveBeenCalledWith({
      runId: "dwfrun-42",
      actorSessionId: "s-2",
      siteId: "actor#2",
      ordinal: 1,
      actorName: "Bob",
    });
  });

  it("Capability-gated: pill is not a button without callback or run; pill without session in an active run is still a button", () => {
    const noCallback = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: joined() });
    expect(
      noCallback.getAllByTestId("workflow-agent-pill").every((pill) => pill.tagName === "SPAN"),
    ).toBe(true);
    expect(noCallback.queryByTestId("workflow-timeline-pill-open")).toBeNull();
    cleanup();

    const onOpenWorkflowActor = vi.fn();
    const noSession = renderBlockDom(LOOP_TOOL_CALL, {
      onOpenWorkflowActor,
      workflowRun: joined({
        actors: [
          { siteId: "actor#1", ordinal: 1, name: "Ada", sessionId: "s-1", status: "completed" },
        ],
      }),
    });
    const pills = noSession.getAllByTestId("workflow-agent-pill");
    expect(pills.map((pill) => pill.tagName)).toEqual(["BUTTON", "BUTTON"]);
    expect(pills[1]!.getAttribute("aria-label")).toBe("Open the transcript of checker");
    fireEvent.click(pills[1]!);
    expect(onOpenWorkflowActor).toHaveBeenCalledWith({
      runId: "dwfrun-42",
      siteId: "actor#2",
      ordinal: 1,
      actorName: "checker",
    });
    cleanup();

    const static_ = renderBlockDom(LOOP_TOOL_CALL, { onOpenWorkflowActor });
    expect(
      static_.getAllByTestId("workflow-agent-pill").every((pill) => pill.tagName === "SPAN"),
    ).toBe(true);
    expect(static_.getAllByTestId("workflow-agent-pill")[0]!.getAttribute("title")).toBe("planner");
  });

  it("Clicking pill does not trigger station header (separate, non-interfering paths)", () => {
    const onOpenWorkflowActor = vi.fn();
    const onOpenWorkflowRun = vi.fn();
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      onOpenWorkflowActor,
      onOpenWorkflowRun,
      workflowRun: joined(),
    });
    fireEvent.click(view.getAllByTestId("workflow-agent-pill")[0]!);
    expect(onOpenWorkflowActor).toHaveBeenCalledTimes(1);
    expect(onOpenWorkflowRun).not.toHaveBeenCalled();
  });
});

describe("CreateWorkflowToolCallBlock 脚本药丸", () => {
  const WORKSPACE_GRAPH = {
    ...LOOP_GRAPH,
    steps: [
      ...LOOP_GRAPH.steps,
      {
        id: "world-read#1",
        kind: "world-read",
        label: "run tests",
        line: 6,
        column: 3,
        lane: "workspace",
        phase: "phase#b",
      },
    ],
    lanes: [...LOOP_GRAPH.lanes, { id: "workspace" }],
    participants: [
      ...LOOP_GRAPH.participants,
      { id: "phase#b:workspace", phase: "phase#b", lane: "workspace", steps: ["world-read#1"] },
    ],
  };
  const WORKSPACE_TOOL_CALL: ToolCallOverrides = {
    ...LOOP_TOOL_CALL,
    raw: { display: { ...OK_DISPLAY, causalityGraph: WORKSPACE_GRAPH } },
  };
  const workspacePill = (view: ReturnType<typeof renderBlockDom>) =>
    view
      .getAllByTestId("workflow-agent-pill")
      .find((pill) => pill.textContent?.includes("Script"))!;

  it("Script pill in an active run is a button: click to yield this station\'s stage ID and display name", () => {
    const onOpenWorkflowWorkspace = vi.fn();
    const onOpenWorkflowActor = vi.fn();
    const view = renderBlockDom(WORKSPACE_TOOL_CALL, {
      onOpenWorkflowWorkspace,
      onOpenWorkflowActor,
      workflowRun: joined(),
    });
    const pill = workspacePill(view);
    expect(pill.tagName).toBe("BUTTON");
    expect(pill.getAttribute("aria-label")).toBe("Open the script's steps at verify");
    expect(view.getAllByTestId("workflow-timeline-workspace-open")).toHaveLength(1);
    fireEvent.click(pill);
    expect(onOpenWorkflowWorkspace).toHaveBeenCalledWith({
      phaseId: "phase#b",
      workflowName: "Research pipeline",
    });
    expect(onOpenWorkflowActor).not.toHaveBeenCalled();
  });

  it("Capability-gated: script pill is a span without callback or run; does not borrow subagent callback even if present", () => {
    const noCallback = renderBlockDom(WORKSPACE_TOOL_CALL, {
      onOpenWorkflowActor: vi.fn(),
      workflowRun: joined(),
    });
    expect(workspacePill(noCallback).tagName).toBe("SPAN");
    expect(noCallback.queryByTestId("workflow-timeline-workspace-open")).toBeNull();
    cleanup();

    const noRun = renderBlockDom(WORKSPACE_TOOL_CALL, { onOpenWorkflowWorkspace: vi.fn() });
    expect(workspacePill(noRun).tagName).toBe("SPAN");
    expect(noRun.queryByTestId("workflow-timeline-workspace-open")).toBeNull();
  });
});

describe("CreateWorkflowToolCallBlock 失败态与 Resume", () => {
  const failed = () =>
    joined(
      {
        status: "errored",
        error: { code: "actor_failed", message: "boom" } as WorkflowRunState["error"],
        actors: [
          { siteId: "actor#1", ordinal: 1, name: "Ada", sessionId: "s-1", status: "completed" },
          { siteId: "actor#2", ordinal: 1, name: "Bob", sessionId: "s-2", status: "completed" },
        ],
        nodes: [
          { siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" },
          { siteId: "ask#2", ordinal: 1, phase: "settled", outcome: "failed" },
        ] as WorkflowRunState["nodes"],
      },
      { resumable: true },
    );

  it("Error: header shows \"Workflow errored\", failed stations and pills marked as failed, footer has Resume", () => {
    const onResumeWorkflowRun = vi.fn();
    const view = renderBlockDom(LOOP_TOOL_CALL, { onResumeWorkflowRun, workflowRun: failed() });
    expect(view.getByTestId("workflow-card-kind").textContent).toBe("Workflow errored");
    expect(view.getByTestId("workflow-card-status").textContent).toBe("Errored");
    expect(
      view.getAllByTestId("workflow-timeline-station")[1]!.getAttribute("data-station-status"),
    ).toBe("failed");
    expect(view.getAllByTestId("workflow-agent-pill")[1]!.getAttribute("data-agent-status")).toBe(
      "failed",
    );

    const resume = view.getByTestId("workflow-card-resume");
    expect(view.getByTestId("workflow-card-footer").contains(resume)).toBe(true);
    fireEvent.click(resume);
    expect(onResumeWorkflowRun).toHaveBeenCalledWith({ workflowName: "Research pipeline" });
  });

  it("Resume is capability-gated: no button if no callback or summary does not specify resumable", () => {
    const noCallback = renderBlockDom(LOOP_TOOL_CALL, { workflowRun: failed() });
    expect(noCallback.queryByTestId("workflow-card-resume")).toBeNull();
    cleanup();
    const { resumable: _off, ...notResumable } = failed();
    const notOffered = renderBlockDom(LOOP_TOOL_CALL, {
      onResumeWorkflowRun: vi.fn(),
      workflowRun: notResumable,
    });
    expect(notOffered.queryByTestId("workflow-card-resume")).toBeNull();
    cleanup();
    const running = renderBlockDom(LOOP_TOOL_CALL, {
      onResumeWorkflowRun: vi.fn(),
      workflowRun: joined(),
    });
    expect(running.queryByTestId("workflow-card-resume")).toBeNull();
  });

  it("Collapsed failed card still retains footer: Resume must stay accessible", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      canToggle: true,
      forceOpen: false,
      onResumeWorkflowRun: vi.fn(),
      workflowRun: failed(),
    });
    fireEvent.click(view.getByTestId("workflow-card-toggle"));
    expect(view.queryByTestId("workflow-card-body")).toBeNull();
    expect(view.getByTestId("workflow-card-resume")).toBeTruthy();
  });

  it("Stopped: kind word \"Workflow stopped\" + reason, Resume also present when linked summary marks resumable", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      onResumeWorkflowRun: vi.fn(),
      workflowRun: joined({ status: "stopped", stopReason: "user" }, { resumable: true }),
    });
    expect(view.getByTestId("workflow-card-kind").textContent).toBe("Workflow stopped");
    expect(view.getByTestId("workflow-card-status-reason").textContent).toContain("by you");
    expect(view.getByTestId("workflow-card-status-resumable").textContent).toContain("resumable");
    expect(view.getByTestId("workflow-card-resume")).toBeTruthy();
  });

  it("Status line has no third word when summary lacks resumable (UI never infers from status)", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL, {
      workflowRun: joined({ status: "stopped", stopReason: "user" }),
    });
    expect(view.getByTestId("workflow-card-status-reason").textContent).toContain("by you");
    expect(view.queryByTestId("workflow-card-status-resumable")).toBeNull();
  });
});

describe("readWorkflowKindMessageId", () => {
  it("Terminal state is always \"Workflow\", regardless of v4 status", () => {
    expect(readWorkflowKindMessageId({ v4Status: "success" }, false)).toBe(
      "chat.toolCall.workflow.ran",
    );
    expect(readWorkflowKindMessageId({ v4Status: "inputStreaming" }, false)).toBe(
      "chat.toolCall.workflow.ran",
    );
    expect(readWorkflowKindMessageId(undefined, false)).toBe("chat.toolCall.workflow.ran");
  });

  it("inputStreaming means \"Drafting\"—model is still writing script, no verification underway", () => {
    expect(readWorkflowKindMessageId({ v4Status: "inputStreaming" }, true)).toBe(
      "chat.toolCall.workflow.writing",
    );
  });

  it("pendingApproval means \"Pending approval\"—ball is in user's court", () => {
    expect(readWorkflowKindMessageId({ v4Status: "pendingApproval" }, true)).toBe(
      "chat.toolCall.workflow.awaitingConfirmation",
    );
  });

  it("Only the running phase is \"Validating\", semantic narrowed to this phase", () => {
    expect(readWorkflowKindMessageId({ v4Status: "running" }, true)).toBe(
      "chat.toolCall.workflow.running",
    );
  });

  it("Verbatim preserve current behavior when v4Status is absent (non-v4 host / legacy snapshot)", () => {
    expect(readWorkflowKindMessageId(undefined, true)).toBe("chat.toolCall.workflow.running");
    expect(readWorkflowKindMessageId({}, true)).toBe("chat.toolCall.workflow.running");
    expect(readWorkflowKindMessageId({ display: OK_DISPLAY }, true)).toBe(
      "chat.toolCall.workflow.running",
    );
    expect(readWorkflowKindMessageId([], true)).toBe("chat.toolCall.workflow.running");
    expect(readWorkflowKindMessageId("running", true)).toBe("chat.toolCall.workflow.running");
    expect(readWorkflowKindMessageId(null, true)).toBe("chat.toolCall.workflow.running");
    expect(readWorkflowKindMessageId({ v4Status: "queued" }, true)).toBe(
      "chat.toolCall.workflow.running",
    );
  });
});

describe("CreateWorkflowToolCallBlock kind text phased", () => {
  const IN_FLIGHT_INPUT = { name: "Fan-out review", script: "const x = 1;" };

  it("inputStreaming: card displays \"Drafting workflow\", not validating", () => {
    const html = renderBlock(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "inputStreaming" }, status: "running" },
      { isRunning: true },
    );

    expect(html).toContain("Writing workflow");
    expect(html).not.toContain("Validating workflow");
  });

  it("pendingApproval: card displays \"Workflow pending approval\"", () => {
    const html = renderBlock(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "pendingApproval" }, status: "running" },
      { isRunning: true },
    );

    expect(html).toContain("Awaiting workflow confirmation");
    expect(html).not.toContain("Validating workflow");
  });

  it("running: remains \"Validating workflow\"", () => {
    const html = renderBlock(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "running" }, status: "running" },
      { isRunning: true },
    );

    expect(html).toContain("Validating workflow");
    expect(html).not.toContain("Writing workflow");
  });

  it("Card verbatim preserves current behavior when v4Status is absent", () => {
    const html = renderBlock(
      { input: IN_FLIGHT_INPUT, raw: {}, status: "running" },
      { isRunning: true },
    );

    expect(html).toContain("Validating workflow");
    expect(html).not.toContain("Writing workflow");
    expect(html).not.toContain("Awaiting workflow confirmation");
  });

  it("Terminal state has no phase word: displays only \"Workflow\"", () => {
    const html = renderBlock({
      input: IN_FLIGHT_INPUT,
      raw: { display: OK_DISPLAY, v4Status: "success" },
    });

    expect(html).not.toContain("Writing workflow");
    expect(html).not.toContain("Awaiting workflow confirmation");
    expect(html).not.toContain("Validating workflow");
  });

  it("Phase text also localized under zh-CN", () => {
    const writing = renderBlock(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "inputStreaming" }, status: "running" },
      { isRunning: true },
      "zh-CN",
    );
    expect(writing).toContain("正在编写工作流");
    expect(writing).not.toContain("正在校验工作流");

    const awaiting = renderBlock(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "pendingApproval" }, status: "running" },
      { isRunning: true },
      "zh-CN",
    );
    expect(awaiting).toContain("工作流待确认");

    const validating = renderBlock(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "running" }, status: "running" },
      { isRunning: true },
      "zh-CN",
    );
    expect(validating).toContain("正在校验工作流");
  });

  it("From draft 2 onward, drafting kind word is \"Revising workflow\", detail slot includes draft number; draft 1 remains unnumbered", () => {
    const revising = renderBlockDom(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "inputStreaming" }, status: "running" },
      { isRunning: true, workflowDraft: { ordinal: 2, superseded: false } },
    );
    expect(revising.container.textContent).toContain("Revising workflow");
    expect(revising.container.textContent).not.toContain("Writing workflow");
    expect(revising.getByTestId("workflow-draft-ordinal").textContent).toBe("draft 2");
    expect(revising.queryByTestId("workflow-draft-lamp")).toBeNull();
    cleanup();

    const first = renderBlockDom(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "inputStreaming" }, status: "running" },
      { isRunning: true, workflowDraft: { ordinal: 1, superseded: false } },
    );
    expect(first.container.textContent).toContain("Writing workflow");
    expect(first.queryByTestId("workflow-draft-ordinal")).toBeNull();
  });

  it("Pending approval and validating: draft number also included from draft 2 onward, kind word unchanged", () => {
    const awaiting = renderBlockDom(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "pendingApproval" }, status: "running" },
      { isRunning: true, workflowDraft: { ordinal: 2, superseded: false } },
    );
    expect(awaiting.container.textContent).toContain("Awaiting workflow confirmation");
    expect(awaiting.getByTestId("workflow-draft-ordinal").textContent).toBe("draft 2");
    cleanup();

    const validating = renderBlockDom(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "running" }, status: "running" },
      { isRunning: true, workflowDraft: { ordinal: 3, superseded: false } },
    );
    expect(validating.getByTestId("workflow-card-kind").textContent).toBe("Validating workflow");
    expect(validating.getByTestId("workflow-card-detail").textContent).toBe("draft 3");
    cleanup();

    const settled = renderBlockDom(LOOP_TOOL_CALL, {
      workflowDraft: { ordinal: 2, superseded: false },
    });
    expect(settled.getByTestId("workflow-card-detail").textContent).not.toContain("draft");
  });

  it("zh-CN: displays \"Revising workflow\" and \"Draft 2\" from draft 2 onward", () => {
    const view = renderBlockDom(
      { input: IN_FLIGHT_INPUT, raw: { v4Status: "inputStreaming" }, status: "running" },
      { isRunning: true, workflowDraft: { ordinal: 2, superseded: false } },
      "zh-CN",
    );
    expect(view.container.textContent).toContain("正在修改工作流");
    expect(view.getByTestId("workflow-draft-ordinal").textContent).toBe("Draft 2");
  });
});

describe("CreateWorkflowToolCallBlock 名册站", () => {
  type FanStatus = "done" | "running" | "failed" | "pending";
  const FANOUT_GRAPH = {
    steps: [
      {
        id: "ask#1",
        kind: "ask",
        label: "review",
        line: 3,
        column: 21,
        lane: "actor#1",
        phase: "phase#a",
      },
    ],
    lanes: [{ id: "actor#1", namePattern: { head: "reviewer-" }, line: 2, column: 11 }],
    participants: [
      { id: "phase#a:actor#1", phase: "phase#a", lane: "actor#1", steps: ["ask#1"], many: true },
    ],
    handoffs: [],
    phases: [{ id: "phase#a", name: "review", line: 1 }],
    phaseEdges: [],
    exits: ["phase#a"],
  };
  function fanoutToolCall(_n: number): ToolCallOverrides {
    return {
      input: { name: "bug-scan", script: 'phase("review");' },
      raw: { display: { ...OK_DISPLAY, causalityGraph: FANOUT_GRAPH } },
    };
  }
  function fanoutRun(
    n: number,
    statusOf: (index: number) => FanStatus,
    unlistedByPhase?: WorkflowRunState["unlistedByPhase"],
  ) {
    const actors: WorkflowRunState["actors"] = [];
    const nodes: WorkflowRunState["nodes"] = [];
    for (let i = 1; i <= n; i += 1) {
      const status = statusOf(i);
      actors.push({
        siteId: "actor#1",
        ordinal: i,
        name: `reviewer-${i}`,
        sessionId: `s-${i}`,
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
    return joined({
      actors,
      nodes,
      usage: { spentTokens: 10, nodesUsed: nodes.length },
      ...(unlistedByPhase === undefined ? {} : { truncated: true, unlistedByPhase }),
    });
  }
  const mid = (i: number): FanStatus =>
    i === 4 ? "failed" : i === 6 ? "running" : i === 7 ? "pending" : "done";

  it("Pin five of seven participants by running, failed, and participation order; summarize remaining two", () => {
    const view = renderBlockDom(fanoutToolCall(7), { workflowRun: fanoutRun(7, mid) });
    const column = view.getByTestId("workflow-timeline-pills");
    expect(column.getAttribute("data-station-roster")).toBe("true");
    const pills = within(column).getAllByTestId("workflow-agent-pill");
    expect(pills.map((pill) => pill.textContent)).toEqual([
      "reviewer-6",
      "reviewer-4",
      "reviewer-1",
      "reviewer-2",
      "reviewer-3",
    ]);
    expect(pills.map((pill) => pill.getAttribute("data-agent-status"))).toEqual([
      "running",
      "failed",
      "done",
      "done",
      "done",
    ]);
    const row = within(column).getByTestId("workflow-roster-more-row");
    expect(row.getAttribute("data-more-count")).toBe("2");
    expect(row.textContent).toBe("2 more");
    expect(row.getAttribute("title")).toBe("2 more subagents · list everyone in the run pane");
    const faces = within(row)
      .getByTestId("workflow-more-deck")
      .querySelectorAll("[data-face-state]");
    expect([...faces].map((face) => face.getAttribute("data-face-state"))).toEqual([
      "waiting",
      "content",
    ]);
    expect(within(row).queryByTestId("workflow-more-failed")).toBeNull();
    expect(view.getByTestId("workflow-card-detail").textContent).toContain("1 agent working");
  });

  it("Four pills plus 300 eliminated forms a roster: four pills, row shows \"300 remaining\", red ✕ includes off-roster failures", () => {
    const view = renderBlockDom(fanoutToolCall(4), {
      workflowRun: fanoutRun(4, () => "running", [
        { phaseName: "review", actors: 300, actorsSettled: 100, actorsFailed: 2, settled: 300 },
      ]),
    });
    const column = view.getByTestId("workflow-timeline-pills");
    expect(column.getAttribute("data-station-roster")).toBe("true");
    expect(within(column).getAllByTestId("workflow-agent-pill")).toHaveLength(4);
    const row = within(column).getByTestId("workflow-roster-more-row");
    expect(row.getAttribute("data-more-count")).toBe("300");
    expect(row.textContent).toContain("300 more");
    expect(within(row).getByTestId("workflow-more-failed").textContent).toBe("2");
    expect(
      within(row).getByTestId("workflow-more-deck").querySelectorAll("[data-face-state]"),
    ).toHaveLength(0);
  });

  it("Six participants remain a pill list: no roster", () => {
    const view = renderBlockDom(fanoutToolCall(6), { workflowRun: fanoutRun(6, mid) });
    const column = view.getByTestId("workflow-timeline-pills");
    expect(column.getAttribute("data-station-roster")).toBeNull();
    expect(within(column).getAllByTestId("workflow-agent-pill")).toHaveLength(6);
    expect(view.queryByTestId("workflow-roster-more-row")).toBeNull();
  });

  it("More than five failures: row after five red pills shows how many failed are hidden", () => {
    const view = renderBlockDom(fanoutToolCall(9), {
      workflowRun: fanoutRun(9, (i) => (i <= 6 ? "failed" : "done")),
    });
    const column = view.getByTestId("workflow-timeline-pills");
    const pills = within(column).getAllByTestId("workflow-agent-pill");
    expect(pills.every((pill) => pill.getAttribute("data-agent-status") === "failed")).toBe(true);
    const row = within(column).getByTestId("workflow-roster-more-row");
    expect(row.getAttribute("data-more-count")).toBe("4");
    expect(within(row).getByTestId("workflow-more-failed").textContent).toBe("1");
    const faces = within(row)
      .getByTestId("workflow-more-deck")
      .querySelectorAll("[data-face-state]");
    expect([...faces].map((face) => face.getAttribute("data-face-state"))).toEqual([
      "sad",
      "content",
      "content",
    ]);
  });

  it("That row and station header yield station ID: open run details and focus on this station; row is static without callback", () => {
    const onOpenWorkflowRun = vi.fn();
    const view = renderBlockDom(fanoutToolCall(60), {
      onOpenWorkflowRun,
      workflowRun: fanoutRun(60, () => "done"),
    });
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.tagName).toBe("BUTTON");
    expect(row.getAttribute("data-more-count")).toBe("55");
    fireEvent.click(row);
    expect(onOpenWorkflowRun).toHaveBeenCalledWith({
      workflowName: "bug-scan",
      phaseId: "phase#a",
    });
    fireEvent.click(view.getByTitle("review"));
    expect(onOpenWorkflowRun).toHaveBeenCalledTimes(2);
    expect(onOpenWorkflowRun).toHaveBeenLastCalledWith({
      workflowName: "bug-scan",
      phaseId: "phase#a",
    });
    cleanup();
    const inert = renderBlockDom(fanoutToolCall(60), { workflowRun: fanoutRun(60, () => "done") });
    expect(inert.getByTestId("workflow-roster-more-row").tagName).toBe("SPAN");
  });

  it("Static card (no run): `many` card is still one pill; literal-cardinality member card exceeding threshold shows five pills + static \"3 remaining\"", () => {
    expect(renderBlock(fanoutToolCall(8))).not.toContain("data-station-roster");
    const members = {
      ...FANOUT_GRAPH,
      participants: Array.from({ length: 8 }, (_, i) => ({
        id: `phase#a:actor#1[${i}]`,
        phase: "phase#a",
        lane: "actor#1",
        steps: ["ask#1"],
        member: { index: i, of: 8 },
      })),
    };
    const html = renderBlock({
      input: { name: "bug-scan", script: 'phase("review");' },
      raw: { display: { ...OK_DISPLAY, causalityGraph: members } },
    });
    expect(html).toContain('data-station-roster="true"');
    expect(html).toContain('data-more-count="3"');
    expect(html).toContain('<span aria-label="3 more subagents · list everyone in the run pane"');
  });

  it("zh-CN: \"n remaining\" and full sentence title", () => {
    const view = renderBlockDom(
      fanoutToolCall(60),
      { workflowRun: fanoutRun(60, () => "done") },
      "zh-CN",
    );
    const row = view.getByTestId("workflow-roster-more-row");
    expect(row.textContent).toBe("55 remaining");
    expect(row.getAttribute("title")).toBe("55 subagents remaining · List all in run sidebar");
  });
});

describe("CreateWorkflowToolCallBlock as AmendWorkflow", () => {
  const DRAFT = 'phase("plan");\nconst planner = agent("planner");\nphase("ver';
  const AMEND_INPUT = { name: "Research pipeline", script: DRAFT, run_id: "dwfrun-prev" };

  it.each([
    ["en-US", "Amending workflow"],
    ["zh-CN", "正在调整工作流"],
  ] as const)("writing: %s", (locale, word) => {
    const view = renderBlockDom(
      {
        kind: "AmendWorkflow",
        input: AMEND_INPUT,
        raw: { v4Status: "inputStreaming" },
        status: "running",
      },
      { isRunning: true },
      locale,
    );
    expect(view.container.textContent).toContain(word);
    expect(view.container.textContent).not.toContain("Writing workflow");
    expect(view.getByTestId("workflow-draft-timeline")).toBeTruthy();
  });

  it.each([
    ["en-US", "Awaiting amendment confirmation"],
    ["zh-CN", "Pending adjustment approval"],
  ] as const)("awaiting confirmation: %s", (locale, word) => {
    const view = renderBlockDom(
      {
        kind: "AmendWorkflow",
        ...LOOP_TOOL_CALL,
        input: { ...(LOOP_TOOL_CALL.input as object), run_id: "dwfrun-prev" },
        raw: { ...(LOOP_TOOL_CALL.raw as object), v4Status: "pendingApproval" },
        status: "running",
      },
      { isRunning: true },
      locale,
    );
    expect(view.container.textContent).toContain(word);
  });

  it.each([
    ["en-US", "Workflow amendment", "Amends run"],
    ["zh-CN", "工作流调整", "调整 run"],
  ] as const)("static card: kind word and the lineage row: %s", (locale, word, amends) => {
    const view = renderBlockDom(
      {
        kind: "AmendWorkflow",
        ...LOOP_TOOL_CALL,
        input: { ...(LOOP_TOOL_CALL.input as object), run_id: "dwfrun-prev" },
      },
      {},
      locale,
    );
    expect(view.getByTestId("workflow-card-kind").textContent).toBe(word);
    const lineage = view.container.querySelector('[data-workflow-card-amends="true"]');
    expect(lineage?.textContent).toContain(amends);
    expect(lineage?.textContent).toContain("dwfrun-prev");
  });

  it("compile errors: the feedback row says「Amendment draft」, not the create word", () => {
    const view = renderBlockDom({
      kind: "AmendWorkflow",
      input: AMEND_INPUT,
      raw: {
        display: {
          kind: "create_workflow",
          ok: false,
          errorCount: 1,
          diagnostics: [{ line: 1, column: 1, code: 2322, message: "Type error" }],
        },
      },
      status: "failed",
    });
    expect(view.container.querySelector(".tool-summary-kind-label")?.textContent).toBe(
      "Amendment draft",
    );
    expect(view.container.textContent).not.toContain("Amending workflow");
    expect(view.container.textContent).not.toContain("Workflow draft");
  });

  it("from draft 2 on the streaming amend row says「Revising amendment」", () => {
    const view = renderBlockDom(
      {
        kind: "AmendWorkflow",
        input: AMEND_INPUT,
        raw: { v4Status: "inputStreaming" },
        status: "running",
      },
      { isRunning: true, workflowDraft: { ordinal: 2, superseded: false } },
    );
    expect(view.container.textContent).toContain("Revising amendment");
    expect(view.getByTestId("workflow-draft-ordinal").textContent).toBe("draft 2");
  });

  const SETTINGS_ONLY_INPUT = { run_id: "dwfrun-prev", max_concurrency: 2 };

  it.each([
    ["en-US", "Amends run", "script unchanged"],
    ["zh-CN", "调整 run", "脚本不变"],
  ] as const)("static card of an amend that kept the script: %s", (locale, amends, unchanged) => {
    const view = renderBlockDom(
      { kind: "AmendWorkflow", input: SETTINGS_ONLY_INPUT, raw: LOOP_TOOL_CALL.raw },
      {},
      locale,
    );
    const lineage = view.container.querySelector('[data-workflow-card-amends="true"]');
    expect(lineage?.textContent).toContain(amends);
    expect(lineage?.textContent).toContain("dwfrun-prev");
    expect(lineage?.textContent).toContain(unchanged);
    expect(lineage?.getAttribute("data-workflow-card-amends-script-inherited")).toBe("true");
    expect(view.getByTestId("workflow-timeline")).toBeTruthy();
    expect(view.queryByTestId("workflow-card-script-toggle")).toBeNull();
    expect(view.container.textContent).not.toContain("No workflow script provided.");
  });

  it("an amend that kept the script and has no display still shows no 'no script' notice", () => {
    const view = renderBlockDom({ kind: "AmendWorkflow", input: SETTINGS_ONLY_INPUT, raw: {} });
    expect(view.container.textContent).not.toContain("No workflow script provided.");
    const lineage = view.container.querySelector('[data-workflow-card-amends="true"]');
    expect(lineage?.textContent).toContain("script unchanged");
  });

  it("a static amend card that passed a script says nothing about the script", () => {
    const view = renderBlockDom({
      kind: "AmendWorkflow",
      ...LOOP_TOOL_CALL,
      input: { ...(LOOP_TOOL_CALL.input as object), run_id: "dwfrun-prev" },
    });
    const lineage = view.container.querySelector('[data-workflow-card-amends="true"]');
    expect(lineage?.textContent).not.toContain("script unchanged");
    expect(lineage?.getAttribute("data-workflow-card-amends-script-inherited")).toBeNull();
    expect(view.getByTestId("workflow-card-script-toggle")).toBeTruthy();
  });

  it("an input trimmed to a snapshot preview is not read as a kept script", () => {
    const view = renderBlockDom({
      kind: "AmendWorkflow",
      input: { run_id: "dwfrun-prev" },
      raw: LOOP_TOOL_CALL.raw,
      snapshotRefs: [{ field: "input", previewBytes: 64, fullBytes: 40_000 }],
    });
    const lineage = view.container.querySelector('[data-workflow-card-amends="true"]');
    expect(lineage?.textContent).toContain("dwfrun-prev");
    expect(lineage?.textContent).not.toContain("script unchanged");
  });

  it("while the input streams nothing is said: the script may still be on its way", () => {
    const view = renderBlockDom(
      {
        kind: "AmendWorkflow",
        input: { run_id: "dwfrun-prev" },
        raw: { v4Status: "inputStreaming" },
        status: "running",
      },
      { isRunning: true },
    );
    expect(view.container.textContent).toContain("Amending workflow");
    expect(view.container.textContent).not.toContain("script unchanged");
  });

  it("readWorkflowAmendScriptInherited: the resolved flag, or a finished input with neither script source", () => {
    expect(
      readWorkflowAmendScriptInherited({
        run_id: "r",
        script: "x",
        predecessor: { status: "completed", script_inherited: true },
      }),
    ).toBe(true);
    expect(readWorkflowAmendScriptInherited({ run_id: "r", max_concurrency: 2 })).toBe(true);
    expect(
      readWorkflowAmendScriptInherited({
        run_id: "r",
        script: "x",
        predecessor: { status: "completed" },
      }),
    ).toBe(false);
    expect(
      readWorkflowAmendScriptInherited({ run_id: "r", path: ".cf/workflow-drafts/x.dwf.ts" }),
    ).toBe(false);
    expect(
      readWorkflowAmendScriptInherited({
        run_id: "r",
        script: "x",
        path: "/abs/.cf/workflow-drafts/x.dwf.ts",
        predecessor: { status: "completed", script_inherited: true },
      }),
    ).toBe(true);
    expect(readWorkflowAmendScriptInherited(undefined)).toBe(false);
    expect(readWorkflowAmendScriptInherited("{}")).toBe(false);
  });

  it("a CreateWorkflow row never grows a lineage row", () => {
    const view = renderBlockDom(LOOP_TOOL_CALL);
    expect(view.container.querySelector('[data-workflow-card-amends="true"]')).toBeNull();
  });

  it("readWorkflowKindMessageId switches to the amend vocabulary", () => {
    expect(readWorkflowKindMessageId({ v4Status: "inputStreaming" }, true, true)).toBe(
      "chat.toolCall.workflow.amend.writing",
    );
    expect(readWorkflowKindMessageId({ v4Status: "pendingApproval" }, true, true)).toBe(
      "chat.toolCall.workflow.amend.awaitingConfirmation",
    );
    expect(readWorkflowKindMessageId({ v4Status: "running" }, true, true)).toBe(
      "chat.toolCall.workflow.running",
    );
    expect(readWorkflowKindMessageId(undefined, false, true)).toBe(
      "chat.toolCall.workflow.amend.ran",
    );
  });

  it("In-flight calls only modifying concurrency limit display \"Adjusting workflow\" throughout instead of \"Validating\"", () => {
    expect(readWorkflowKindMessageId({ v4Status: "running" }, true, true, true)).toBe(
      "chat.toolCall.workflow.amend.writing",
    );
    expect(readWorkflowKindMessageId({ v4Status: "inputStreaming" }, true, true, true)).toBe(
      "chat.toolCall.workflow.amend.writing",
    );
    expect(readWorkflowKindMessageId({ v4Status: "running" }, true, true, false)).toBe(
      "chat.toolCall.workflow.running",
    );
  });

  it.each([
    [
      { run_id: "r", max_concurrency: 4 },
      { runId: "r", requested: 4 },
    ],
    [
      { run_id: "r", max_concurrency: null },
      { runId: "r", requested: null },
    ],
    [{ run_id: "r", max_concurrency: 4, script: "phase('a')" }, undefined],
    [{ run_id: "r", max_concurrency: 4, path: ".cf/workflow-drafts/x.dwf.ts" }, undefined],
    [{ run_id: "r", max_concurrency: 4, subagent_model: "zhipu/glm-5.3" }, undefined],
    [{ run_id: "r", max_concurrency: 4, name: "Research pipeline" }, undefined],
    [{ run_id: "r" }, undefined],
    [{ max_concurrency: 4 }, undefined],
    ["{}", undefined],
  ])("readWorkflowRetuneCall %#", (input, expected) => {
    expect(readWorkflowRetuneCall(input)).toEqual(expected);
  });

  it("In-flight call modifying concurrency limit only: row displays \"Adjusting workflow\", not validating", () => {
    const view = renderBlockDom(
      {
        kind: "AmendWorkflow",
        input: { run_id: "dwfrun-prev", max_concurrency: 4 },
        raw: { v4Status: "running" },
        status: "running",
      },
      { isRunning: true },
    );
    expect(view.container.textContent).toContain("Amending workflow");
    expect(view.container.textContent).not.toContain("Validating workflow");
  });
});

describe("ConversationRowView turns tool card artifact pill into an open request", () => {
  const RUN = {
    runId: "run-7",
    toolCallId: "tool-5",
    status: "completed",
    usage: { spentTokens: 12, nodesUsed: 1 },
    actors: [{ siteId: "actor#1", ordinal: 1, name: "Ada", sessionId: "s-1", status: "completed" }],
    nodes: [{ siteId: "ask#1", ordinal: 1, phase: "settled", outcome: "ok" }],
    artifacts: [
      { id: "book", kind: "file", title: "Audit report", version: 2, contentType: "text/html" },
      { id: "perf", kind: "chart", title: "Round timings", version: 1 },
    ],
    lastEventSequence: 3,
  } as unknown as WorkflowRunState;

  function renderRow(onOpenWorkflowArtifact: (request: unknown) => void) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    return render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          PlatformProvider,
          { platform: {} as any },
          createElement(ConversationRowView, {
            row: {
              rowId: 5,
              turnId: "turn-1",
              createdAt: 1_700_000_000_005,
              createdAtSeq: 5,
              kind: "toolCall",
              toolCallId: "tool-5",
              toolName: "CreateWorkflow",
              status: "error",
              input: { name: "implement-verify", script: "phase('a')" },
              inputText: "{}",
              output: {
                text: "ok",
                display: {
                  kind: "create_workflow",
                  ok: true,
                  errorCount: 0,
                  diagnostics: [],
                  causalityGraph: {
                    steps: [
                      {
                        id: "ask#1",
                        kind: "ask",
                        label: "plan",
                        line: 2,
                        column: 21,
                        lane: "actor#1",
                      },
                    ],
                    lanes: [{ id: "actor#1", name: "planner", line: 1, column: 11 }],
                    participants: [
                      {
                        id: "unphased:actor#1",
                        phase: "unphased",
                        lane: "actor#1",
                        steps: ["ask#1"],
                      },
                    ],
                    handoffs: [],
                  },
                },
              },
            } as any,
            context: {
              workspacePath: "/workspace",
              theme: "system",
              sessionId: "parent-a",
              onOpenWorkflowArtifact,
              workflowRunByToolCallId: new Map([
                [
                  "tool-5",
                  {
                    runId: "run-7",
                    toolCallId: "tool-5",
                    status: "completed",
                    nodesSettled: 1,
                    nodesTotal: 1,
                    run: RUN,
                  },
                ],
              ]),
            } as any,
          }),
        ),
      ),
    );
  }

  it("Include display name and contentType (host uses it to open html artifact directly as browser tab)", () => {
    const spy = vi.fn();
    const view = renderRow(spy);

    fireEvent.click(view.getAllByTestId("workflow-card-artifact")[0]!);
    expect(spy).toHaveBeenCalledWith({
      parentSessionId: "parent-a",
      runId: "run-7",
      artifactId: "book",
      title: "Audit report",
      contentType: "text/html",
    });
  });

  function renderRetuneRow(
    input: unknown,
    options: {
      ceiling?: number;
      onOpenWorkflowRun?: (request: unknown) => void;
      
      display?: unknown;
      
      joinedByToolCallId?: boolean;
      status?: string;
    } = {},
  ) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    return render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          PlatformProvider,
          { platform: {} as any },
          createElement(ConversationRowView, {
            row: {
              rowId: 9,
              turnId: "turn-1",
              createdAt: 1_700_000_000_009,
              createdAtSeq: 9,
              kind: "toolCall",
              toolCallId: "tool-9",
              toolName: "AmendWorkflow",
              status: options.status ?? "success",
              input,
              inputText: "{}",
              output: {
                text: "Applied to the running run run-7; at most 4 subagents run at once.",
                ...(options.display === undefined ? {} : { display: options.display }),
              },
            } as any,
            context: {
              workspacePath: "/workspace",
              theme: "system",
              sessionId: "parent-a",
              onOpenWorkflowRun: options.onOpenWorkflowRun,
              workflowRunByToolCallId: options.joinedByToolCallId
                ? new Map([
                    [
                      "tool-9",
                      {
                        runId: "run-8",
                        toolCallId: "tool-9",
                        status: "running",
                        nodesSettled: 0,
                        nodesTotal: 1,
                      },
                    ],
                  ])
                : new Map(),
              workflowRunByRunId: new Map([
                [
                  "run-7",
                  {
                    runId: "run-7",
                    toolCallId: "tool-5",
                    status: "running",
                    nodesSettled: 0,
                    nodesTotal: 1,
                    ...(options.ceiling === undefined
                      ? {}
                      : { run: { runId: "run-7", concurrencyCeiling: options.ceiling } }),
                  },
                ],
              ]),
            } as any,
          }),
        ),
      ),
    );
  }

  it("Revision row taking effect in place demoted to settings row: click to open that run with initiating row\'s toolCallId", () => {
    const onOpenWorkflowRun = vi.fn();
    const view = renderRetuneRow(
      { run_id: "run-7", max_concurrency: 4 },
      { ceiling: 13, onOpenWorkflowRun },
    );
    expect(view.queryByTestId("workflow-card")).toBeNull();
    const row = view.getByTestId("workflow-retune-row");
    expect(row.textContent).toContain("Settings changed");
    expect(row.textContent).toContain("at most 4 at once");
    for (const gone of ["compiled", "Amends run", "script unchanged"]) {
      expect(view.container.textContent).not.toContain(gone);
    }
    fireEvent.click(row);
    expect(onOpenWorkflowRun).toHaveBeenCalledWith({
      parentSessionId: "parent-a",
      toolCallId: "tool-5",
      runId: "run-7",
    });
  });

  it.each([
    ["Request higher than default", { run_id: "run-7", max_concurrency: 40 }, 13, "at most 40 at once"],
    ["Request exactly default", { run_id: "run-7", max_concurrency: 13 }, 13, "limit back to the default"],
    [
      "解除上限（null）",
      { run_id: "run-7", max_concurrency: null },
      13,
      "limit back to the default",
    ],
    ["Request lower than default", { run_id: "run-7", max_concurrency: 4 }, 13, "at most 4 at once"],
    ["默认未知", { run_id: "run-7", max_concurrency: 4 }, undefined, "at most 4 at once"],
  ])("%s", (_case, input, ceiling, text) => {
    const view = renderRetuneRow(input, ceiling === undefined ? {} : { ceiling });
    expect(view.getByTestId("workflow-retune-row").textContent).toContain(text);
  });

  it("Host provides no open callback (read-only): same row, just unclickable", () => {
    const view = renderRetuneRow({ run_id: "run-7", max_concurrency: 4 }, { ceiling: 13 });
    expect(view.getByTestId("workflow-retune-row").tagName).not.toBe("BUTTON");
  });

  it("Falls back to genuine revision (has display, has run linked by toolCallId): proceeds with run summary as usual, not demoted to settings row", () => {
    const view = renderRetuneRow(
      { run_id: "run-7", max_concurrency: 4 },
      {
        ceiling: 13,
        joinedByToolCallId: true,
        display: { kind: "create_workflow", ok: true, errorCount: 0, diagnostics: [] },
      },
    );
    expect(view.queryByTestId("workflow-retune-row")).toBeNull();
  });

  it("Having only display (not yet linked to run) also does not demote to settings row: compiled means not taking effect in place", () => {
    const view = renderRetuneRow(
      { run_id: "run-7", max_concurrency: 4 },
      {
        ceiling: 13,
        display: { kind: "create_workflow", ok: true, errorCount: 0, diagnostics: [] },
      },
    );
    expect(view.queryByTestId("workflow-retune-row")).toBeNull();
    expect(view.queryByTestId("workflow-card")).not.toBeNull();
  });

  it("Tool error (rejection is also tool error): renders error as usual", () => {
    const view = renderRetuneRow({ run_id: "run-7", max_concurrency: 4 }, { status: "error" });
    expect(view.queryByTestId("workflow-retune-row")).toBeNull();
  });

  it("Do not fabricate one if that item in live projection summary lacks contentType (it never carries sourcePath either)", () => {
    const spy = vi.fn();
    const view = renderRow(spy);

    fireEvent.click(view.getAllByTestId("workflow-card-artifact")[1]!);
    expect(spy).toHaveBeenCalledWith({
      parentSessionId: "parent-a",
      runId: "run-7",
      artifactId: "perf",
      title: "Round timings",
    });
  });
});

describe("ConversationRowView passes draft number to compilation feedback row", () => {
  function renderFeedbackRow(context: Record<string, unknown>) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    });
    return render(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(
          PlatformProvider,
          { platform: {} as any },
          createElement(ConversationRowView, {
            row: {
              rowId: 9,
              turnId: "turn-1",
              createdAt: 1_700_000_000_009,
              createdAtSeq: 9,
              kind: "toolCall",
              toolCallId: "tool-9",
              toolName: "CreateWorkflow",
              status: "success",
              input: { name: "Release notes digest", script: "const x: number = 'nope';" },
              inputText: "{}",
              output: {
                text: "The workflow script has errors:",
                display: {
                  kind: "create_workflow",
                  ok: false,
                  errorCount: 1,
                  diagnostics: [{ line: 1, column: 7, code: 2322, message: "Type error" }],
                },
              },
            } as any,
            context: {
              workspacePath: "/workspace",
              theme: "system",
              sessionId: "parent-a",
              ...context,
            } as any,
          }),
        ),
      ),
    );
  }

  it("When this row exists in link table: draft number and replaced light reach card with row context", () => {
    const view = renderFeedbackRow({
      workflowDraftByToolCallId: new Map([["tool-9", { ordinal: 3, superseded: true }]]),
    });
    expect(view.getByTestId("workflow-draft-ordinal").textContent).toBe("draft 3");
    expect(view.getByTestId("workflow-draft-lamp").getAttribute("data-draft-lamp")).toBe("settled");
  });

  it("When link table is absent (read-only share hosts, etc.): unnumbered, light remains warning color", () => {
    const view = renderFeedbackRow({});
    expect(view.queryByTestId("workflow-draft-ordinal")).toBeNull();
    expect(view.getByTestId("workflow-draft-lamp").getAttribute("data-draft-lamp")).toBe("open");
  });
});
