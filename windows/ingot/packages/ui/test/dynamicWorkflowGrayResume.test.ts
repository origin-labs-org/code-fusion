// @vitest-environment jsdom
//
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowRunCardSummary } from "@/ToolCallBlocks/shared.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { resolveWorkflowResumeHandler } from "@/v4/workflowResumeGate.js";

vi.mock("@/components/ai-elements/code-block.js", () => ({
  CodeBlockHeader: () => null,
  CodeBlock: ({ code }: { code: string; children?: ReactNode }) =>
    createElement("pre", { "data-testid": "code-block" }, code),
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children?: ReactNode }) => children,
}));

import { CreateWorkflowToolCallBlock } from "@/ToolCallBlocks/renderers/create-workflow.js";
import {
  WorkflowRunDigest,
  type WorkflowRunDigestProps,
} from "@/components/workflow-timeline/WorkflowRunDigest.js";

function resumeHandlerFor(dynamicWorkflowEnabled: boolean) {
  return resolveWorkflowResumeHandler({
    readOnly: false,
    dynamicWorkflowEnabled,
    handler: vi.fn(),
  });
}

const GRAPH = {
  steps: [{ id: "ask#1", kind: "ask", label: "plan", line: 2, column: 21, lane: "actor#1" }],
  lanes: [{ id: "actor#1", name: "planner", line: 1, column: 11 }],
  participants: [{ id: "unphased:actor#1", phase: "unphased", lane: "actor#1", steps: ["ask#1"] }],
  handoffs: [],
} as const;

function stoppedResumableRun(): WorkflowRunState {
  return {
    runId: "dwfrun-42",
    toolCallId: "tool-create-workflow",
    status: "stopped",
    stopReason: "interrupted",
    usage: { spentTokens: 1_234, nodesUsed: 1 },
    actors: [],
    nodes: [],
    lastEventSequence: 7,
  } as unknown as WorkflowRunState;
}

function resumableSummary(): WorkflowRunCardSummary {
  const run = stoppedResumableRun();
  return {
    runId: run.runId,
    toolCallId: run.toolCallId,
    status: run.status,
    nodesSettled: 0,
    nodesTotal: 1,
    resumable: true,
    run,
  } as WorkflowRunCardSummary;
}

function renderCard(
  onResumeWorkflowRun: ((request: { workflowName?: string }) => void) | undefined,
) {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(CreateWorkflowToolCallBlock, {
        toolCallNode: {
          toolCall: {
            toolId: "tool-create-workflow",
            kind: "CreateWorkflow",
            title: "CreateWorkflow",
            output: "",
            status: "completed",
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
        isRunning: false,
        statusLabel: "已停止",
        childToolList: null,
        forceOpen: true,
        canToggle: true,
        showIcon: true,
        onResumeWorkflowRun,
        workflowRun: resumableSummary(),
      }),
    ),
  );
}

function renderDigest(onResume: (() => void) | undefined) {
  return render(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(WorkflowRunDigest, {
        graph: GRAPH as unknown as WorkflowRunDigestProps["graph"],
        name: "implement-verify",
        runId: "dwfrun-42",
        testIdKey: "t",
        summary: resumableSummary(),
        ...(onResume === undefined ? {} : { onResume }),
      }),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe("resolveWorkflowResumeHandler", () => {
  it("灰度命中且可写 → 回调照常供给", () => {
    const handler = vi.fn();
    expect(
      resolveWorkflowResumeHandler({ readOnly: false, dynamicWorkflowEnabled: true, handler }),
    ).toBe(handler);
    expect(
      resolveWorkflowResumeHandler({ readOnly: undefined, dynamicWorkflowEnabled: true, handler }),
    ).toBe(handler);
  });

  it("Rollout missed → not provided; read-only sessions remain not provided; not provided when both hold", () => {
    const handler = vi.fn();
    expect(
      resolveWorkflowResumeHandler({ readOnly: false, dynamicWorkflowEnabled: false, handler }),
    ).toBeUndefined();
    expect(
      resolveWorkflowResumeHandler({ readOnly: true, dynamicWorkflowEnabled: true, handler }),
    ).toBeUndefined();
    expect(
      resolveWorkflowResumeHandler({ readOnly: true, dynamicWorkflowEnabled: false, handler }),
    ).toBeUndefined();
  });
});

describe("Resume on tool card footer and summary card when rollout is disabled", () => {
  it("Tool card footer: rollout off → no Resume; rollout on → yes", () => {
    expect(renderCard(resumeHandlerFor(false))).not.toContain("workflow-card-resume");
    expect(renderCard(resumeHandlerFor(true))).toContain("workflow-card-resume");
  });

  it("End-of-round summary card: rollout off → no Resume; rollout on → yes", () => {
    expect(
      renderDigest(resumeHandlerFor(false)).queryByTestId("workflow-digest-resume"),
    ).toBeNull();
    cleanup();
    expect(
      renderDigest(resumeHandlerFor(true)).queryByTestId("workflow-digest-resume"),
    ).not.toBeNull();
  });

  it("灰度关只收走 Resume：卡与摘要本身照常渲染", () => {
    expect(renderCard(resumeHandlerFor(false))).toContain("workflow-card-kind");
    expect(
      renderDigest(resumeHandlerFor(false)).queryByTestId("workflow-card-kind"),
    ).not.toBeNull();
  });
});
